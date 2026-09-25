package app.slusaonica;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Hosts the web app (bundled in assets/www) in a full-screen WebView.
 * Pages are served from https://appassets.androidplatform.net so IndexedDB and
 * localStorage behave like on a normal https site.
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/assets/www/index.html";
    private static final String AUTH_SCHEME = "slusaonica";
    private static final int REQ_PICK_FILE = 1;
    private static final int REQ_SAVE_FILE = 2;

    /** How long a downloaded page gets to report it started before the bundled page is used again. */
    private static final long PAGE_START_TIMEOUT = 15000;
    /** A page update downloaded in the background is applied when returning after this long. */
    private static final long RELOAD_AFTER_AWAY = 10 * 60 * 1000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView webView;
    private WebUpdater web;
    private ValueCallback<Uri[]> pendingPick;
    private byte[] pendingSave;
    private volatile String pendingAuth = "";
    private boolean pageReady;
    private boolean pageUpdatePending;
    private boolean installAfterPermission;
    private long pausedAt;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebUpdater(this);
        // A downloaded page (see WebUpdater) is served at the same URL as the bundled one.
        final WebViewAssetLoader.AssetsPathHandler assets = new WebViewAssetLoader.AssetsPathHandler(this);
        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", path -> {
                    WebResourceResponse page = web.intercept(path);
                    return page != null ? page : assets.handle(path);
                })
                .build();

        webView = new WebView(this);
        webView.setBackgroundColor(0xFF111214);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);

        webView.addJavascriptInterface(new Bridge(), "AppAndroid");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (HOST.equals(url.getHost())) return false;
                // Anything outside the app (Spotify links, login) opens in the browser or the Spotify app.
                openExternal(url);
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (pendingPick != null) pendingPick.onReceiveValue(null);
                pendingPick = callback;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                // Spotify exports are .zip or .json; MIME types vary by file manager, so allow
                // any file and let the page validate it.
                i.setType("*/*");
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                    i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                try {
                    startActivityForResult(i, REQ_PICK_FILE);
                } catch (ActivityNotFoundException e) {
                    pendingPick = null;
                    return false;
                }
                return true;
            }
        });

        takeAuthIntent(getIntent());
        if (savedInstanceState != null) webView.restoreState(savedInstanceState);
        else webView.loadUrl(START_URL);
        watchPageStart();

        ApkInstaller.handleStatus(this, getIntent(), this::toast);
        if (savedInstanceState == null) checkForUpdate(false);
    }

    private void openExternal(Uri url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (ActivityNotFoundException e) {
            toast("Нема апликације која отвара овај линк");
        }
    }

    /** Spotify login returns as slusaonica://callback?code=…; keep it until the page asks. */
    private boolean takeAuthIntent(Intent intent) {
        Uri data = intent != null ? intent.getData() : null;
        if (data == null || !AUTH_SCHEME.equals(data.getScheme())) return false;
        pendingAuth = data.toString();
        return true;
    }

    /** If a downloaded page never reports that it started, fall back to the bundled page. */
    private void watchPageStart() {
        pageReady = false;
        handler.removeCallbacks(pageStartCheck);
        if (web.isActive()) handler.postDelayed(pageStartCheck, PAGE_START_TIMEOUT);
    }

    private final Runnable pageStartCheck = () -> {
        if (pageReady || !web.isActive()) return;
        web.rollBack();
        webView.loadUrl(START_URL);
        pageReady = false;
    };

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (takeAuthIntent(intent)) {
            webView.evaluateJavascript("window.onNativeAuth && window.onNativeAuth()", null);
            return;
        }
        ApkInstaller.handleStatus(this, intent, this::toast);
    }

    @Override
    protected void onPause() {
        super.onPause();
        pausedAt = System.currentTimeMillis();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (installAfterPermission && getPackageManager().canRequestPackageInstalls()) {
            installAfterPermission = false;
            startApkInstall();
        } else if (pageUpdatePending && pausedAt > 0
                && System.currentTimeMillis() - pausedAt > RELOAD_AFTER_AWAY) {
            pageUpdatePending = false;
            webView.loadUrl(START_URL);
            watchPageStart();
        } else if (pausedAt > 0) {
            webView.evaluateJavascript("window.onNativeResume && window.onNativeResume()", null);
        }
    }

    /* ---------- update check ---------- */

    private static final long UPDATE_CHECK_INTERVAL = 12 * 60 * 60 * 1000L;

    /**
     * Two kinds of updates:
     * 1. The web page (WebUpdater): downloaded silently and used from the next start.
     * 2. The APK: the latest GitHub Release (tagged v1.0.<versionCode>); offered in a dialog
     *    and installed from inside the app (ApkInstaller).
     * On launch the page is checked every time and the APK at most every 12 hours, silently;
     * the "Провери ажурирања" button checks both right away and reports the result.
     */
    private void checkForUpdate(final boolean manual) {
        final SharedPreferences prefs = getSharedPreferences("update", MODE_PRIVATE);
        long now = System.currentTimeMillis();
        final boolean checkApk = manual || now - prefs.getLong("lastCheck", 0) >= UPDATE_CHECK_INTERVAL;
        if (checkApk) prefs.edit().putLong("lastCheck", now).apply();
        if (manual) toast("Проверавам ажурирања…");

        new Thread(() -> {
            boolean newPage = false, pageChecked = false;
            try {
                newPage = web.check();
                pageChecked = true;
            } catch (Exception ignored) {
                // Offline or GitHub unreachable: keep the current page.
            }
            final boolean pageUpdated = newPage;
            if (pageUpdated && !manual) runOnUiThread(() -> pageUpdatePending = true);
            if (!checkApk) return;
            try {
                URL api = new URL("https://api.github.com/repos/" + BuildConfig.UPDATE_REPO + "/releases/latest");
                HttpURLConnection c = (HttpURLConnection) api.openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                c.setRequestProperty("Accept", "application/vnd.github+json");
                if (c.getResponseCode() != 200) throw new IllegalStateException("HTTP " + c.getResponseCode());
                String body;
                try (InputStream in = c.getInputStream()) {
                    body = Tokens.read(in);
                }
                String tag = new JSONObject(body).optString("tag_name", "");
                final long latest = Long.parseLong(tag.substring(tag.lastIndexOf('.') + 1));
                final String name = tag.startsWith("v") ? tag.substring(1) : tag;
                if (latest > installedVersionCode()) runOnUiThread(() -> showUpdateDialog(name));
                else if (manual && pageUpdated) runOnUiThread(this::showPageUpdatedDialog);
                else if (manual) toast("Имаш најновију верзију");
            } catch (Exception e) {
                // No network, rate limit or unexpected response: the automatic check tries again later.
                if (manual && pageUpdated) runOnUiThread(this::showPageUpdatedDialog);
                else if (manual && pageChecked) toast("Имаш најновију верзију");
                else if (manual) toast("Провера није успела. Да ли си на интернету?");
            }
        }).start();
    }

    private void showPageUpdatedDialog() {
        if (isFinishing()) return;
        new AlertDialog.Builder(this)
                .setTitle("Ажурирање је преузето")
                .setMessage("Нова верзија је спремна. Поново покренути сада? Подаци остају.")
                .setPositiveButton("Покрени", (d, w) -> {
                    pageUpdatePending = false;
                    webView.loadUrl(START_URL);
                    watchPageStart();
                })
                .setNegativeButton("Касније", (d, w) -> pageUpdatePending = true)
                .show();
    }

    private void startApkInstall() {
        if (!ApkInstaller.ensureAllowed(this)) {
            installAfterPermission = true;
            Toast.makeText(this, "Дозволи инсталирање ажурирања, па се врати назад", Toast.LENGTH_LONG).show();
            return;
        }
        toast("Преузимам ажурирање…");
        new Thread(() -> ApkInstaller.downloadAndInstall(this, this::toast)).start();
    }

    private void toast(final String msg) {
        runOnUiThread(() -> Toast.makeText(this, msg, Toast.LENGTH_SHORT).show());
    }

    private long installedVersionCode() throws Exception {
        PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    private void showUpdateDialog(String version) {
        if (isFinishing()) return;
        new AlertDialog.Builder(this)
                .setTitle("Нова верзија")
                .setMessage("Верзија " + version + " је спремна. Инсталирати сада? Подаци остају.")
                .setPositiveButton("Инсталирај", (d, w) -> startApkInstall())
                .setNegativeButton("Касније", null)
                // Fallback if the in-app install does not work on this phone.
                .setNeutralButton("Прегледач", (d, w) -> openExternal(Uri.parse(ApkInstaller.latestApkUrl())))
                .show();
    }

    /** Methods index.html can call as window.AppAndroid.*. */
    private class Bridge {
        @JavascriptInterface
        public String getVersion() {
            String page = web.activeId();
            return page.isEmpty() ? BuildConfig.VERSION_NAME : BuildConfig.VERSION_NAME + " · page " + page;
        }

        /** Called by index.html once it has rendered; proves a downloaded page works. */
        @JavascriptInterface
        public void ready() {
            runOnUiThread(() -> pageReady = true);
        }

        @JavascriptInterface
        public void checkForUpdate() {
            runOnUiThread(() -> MainActivity.this.checkForUpdate(true));
        }

        @JavascriptInterface
        public void openExternal(final String url) {
            runOnUiThread(() -> MainActivity.this.openExternal(Uri.parse(url)));
        }

        /** Returns the pending slusaonica://callback URL (once), or "". */
        @JavascriptInterface
        public String takeAuthRedirect() {
            String url = pendingAuth;
            pendingAuth = "";
            return url;
        }

        @JavascriptInterface
        public boolean setTokens(String json) {
            try {
                Tokens.set(MainActivity.this, json);
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public void clearTokens() {
            Tokens.clear(MainActivity.this);
            RecentJob.schedule(MainActivity.this, false);
        }

        @JavascriptInterface
        public boolean loggedIn() {
            return Tokens.loggedIn(MainActivity.this);
        }

        /** {"token": …} or {"error": "logged_out"|"offline"}; may block for a refresh. */
        @JavascriptInterface
        public String accessToken() {
            return Tokens.accessToken(MainActivity.this);
        }

        @JavascriptInterface
        public void setBackgroundSync(boolean enabled) {
            RecentJob.schedule(MainActivity.this, enabled);
        }

        @JavascriptInterface
        public String backgroundSyncInfo() {
            try {
                return new JSONObject()
                        .put("enabled", RecentJob.isScheduled(MainActivity.this))
                        .put("lastRun", RecentJob.lastRun(MainActivity.this))
                        .toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        /** Plays queued by RecentJob since the last call, as a JSON array of batches. */
        @JavascriptInterface
        public String drainRecent() {
            return RecentJob.drain(MainActivity.this);
        }

        /** Saves a file the page built (backup, export); WebView cannot download blob: URLs. */
        @JavascriptInterface
        public void saveFile(final String name, final String mime, final String base64) {
            final byte[] bytes;
            try {
                bytes = Base64.decode(base64, Base64.DEFAULT);
            } catch (Exception e) {
                toast("Фајл није могао да се сачува");
                return;
            }
            runOnUiThread(() -> {
                pendingSave = bytes;
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType(mime);
                i.putExtra(Intent.EXTRA_TITLE, name);
                try {
                    startActivityForResult(i, REQ_SAVE_FILE);
                } catch (ActivityNotFoundException e) {
                    pendingSave = null;
                    Toast.makeText(MainActivity.this, "Нема апликације за чување фајлова", Toast.LENGTH_LONG).show();
                }
            });
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        boolean ok = resultCode == RESULT_OK && data != null;

        if (requestCode == REQ_PICK_FILE && pendingPick != null) {
            Uri[] picked = null;
            if (ok) {
                ClipData clip = data.getClipData();
                if (clip != null && clip.getItemCount() > 0) {
                    picked = new Uri[clip.getItemCount()];
                    for (int i = 0; i < picked.length; i++) picked[i] = clip.getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    picked = new Uri[]{data.getData()};
                }
            }
            pendingPick.onReceiveValue(picked);
            pendingPick = null;
        } else if (requestCode == REQ_SAVE_FILE) {
            byte[] bytes = pendingSave;
            pendingSave = null;
            Uri uri = ok ? data.getData() : null;
            if (uri == null || bytes == null) return;
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                out.write(bytes);
                Toast.makeText(this, "Сачувано", Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, "Чување није успело", Toast.LENGTH_LONG).show();
            }
        }
    }

    @Override
    public void onBackPressed() {
        // The page handles its own back stack (detail views, dialogs) first.
        webView.evaluateJavascript("window.onNativeBack ? window.onNativeBack() : false", value -> {
            if ("true".equals(value)) return;
            if (webView.canGoBack()) webView.goBack();
            else MainActivity.super.onBackPressed();
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }
}
