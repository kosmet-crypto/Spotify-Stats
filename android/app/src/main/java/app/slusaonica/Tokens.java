package app.slusaonica;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * Spotify tokens, shared by the page (through the bridge) and RecentJob.
 *
 * Spotify may hand out a new refresh token on every refresh and retire the old one, so only
 * one refresh may run at a time: every access token goes through {@link #accessToken}, which
 * is synchronized across the whole process.
 */
final class Tokens {

    private static final String PREFS = "spotify";

    private Tokens() {
    }

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Stores the result of the login done by the page: {clientId, access, refresh, expiresIn}. */
    static synchronized void set(Context c, String json) throws Exception {
        JSONObject o = new JSONObject(json);
        prefs(c).edit()
                .putString("clientId", o.getString("clientId"))
                .putString("access", o.getString("access"))
                .putString("refresh", o.getString("refresh"))
                .putLong("exp", System.currentTimeMillis() + o.getLong("expiresIn") * 1000L)
                .apply();
    }

    static synchronized void clear(Context c) {
        prefs(c).edit().clear().apply();
    }

    static synchronized boolean loggedIn(Context c) {
        return !prefs(c).getString("refresh", "").isEmpty();
    }

    /**
     * A valid access token as JSON: {"token": "..."} or {"error": "logged_out" | "offline"}.
     * Refreshes when the stored token is (almost) expired. Blocks; never call on the UI thread.
     */
    static synchronized String accessToken(Context c) {
        SharedPreferences p = prefs(c);
        String refresh = p.getString("refresh", "");
        if (refresh.isEmpty()) return error("logged_out");
        String access = p.getString("access", "");
        if (!access.isEmpty() && p.getLong("exp", 0) - 60000 > System.currentTimeMillis()) {
            return token(access);
        }
        try {
            String body = "grant_type=refresh_token"
                    + "&refresh_token=" + URLEncoder.encode(refresh, "UTF-8")
                    + "&client_id=" + URLEncoder.encode(p.getString("clientId", ""), "UTF-8");
            HttpURLConnection conn = (HttpURLConnection) new URL("https://accounts.spotify.com/api/token").openConnection();
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(15000);
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
            try (OutputStream out = conn.getOutputStream()) {
                out.write(body.getBytes(StandardCharsets.UTF_8));
            }
            int code = conn.getResponseCode();
            if (code == 400 || code == 401) {
                // invalid_grant: the refresh token was revoked; the user has to log in again.
                clear(c);
                return error("logged_out");
            }
            if (code != 200) return error("offline");
            JSONObject o;
            try (InputStream in = conn.getInputStream()) {
                o = new JSONObject(read(in));
            }
            String newAccess = o.getString("access_token");
            SharedPreferences.Editor e = p.edit()
                    .putString("access", newAccess)
                    .putLong("exp", System.currentTimeMillis() + o.optLong("expires_in", 3600) * 1000L);
            String newRefresh = o.optString("refresh_token", "");
            if (!newRefresh.isEmpty()) e.putString("refresh", newRefresh);
            e.commit();
            return token(newAccess);
        } catch (Exception e) {
            return error("offline");
        }
    }

    static String read(InputStream in) throws Exception {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] b = new byte[8192];
        for (int n; (n = in.read(b)) > 0; ) buf.write(b, 0, n);
        return buf.toString("UTF-8");
    }

    private static String token(String t) {
        try {
            return new JSONObject().put("token", t).toString();
        } catch (Exception e) {
            return error("offline");
        }
    }

    private static String error(String what) {
        return "{\"error\":\"" + what + "\"}";
    }
}
