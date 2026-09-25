package app.slusaonica;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Background logging: Spotify only remembers the last 50 plays, so this job asks for them
 * about once an hour, even while the app is closed, and queues them in a file. The page
 * drains the queue on start ({@link #drain}) and merges the plays into its own database.
 */
public class RecentJob extends JobService {

    private static final int JOB_ID = 7001;
    private static final long PERIOD = 60 * 60 * 1000L;
    private static final long MAX_QUEUE_BYTES = 4 * 1024 * 1024;
    private static final Object QUEUE_LOCK = new Object();

    /** Turns the hourly job on or off. */
    static void schedule(Context c, boolean enabled) {
        JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null) return;
        if (!enabled) {
            js.cancel(JOB_ID);
            return;
        }
        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(c, RecentJob.class))
                .setPeriodic(PERIOD, 20 * 60 * 1000L)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .build();
        js.schedule(job);
    }

    static boolean isScheduled(Context c) {
        JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        return js != null && js.getPendingJob(JOB_ID) != null;
    }

    @Override
    public boolean onStartJob(final JobParameters params) {
        new Thread(() -> {
            boolean ok = fetchOnce(getApplicationContext());
            jobFinished(params, !ok);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }

    /** Fetches the last 50 plays and queues them if anything is new. Returns false on a network error. */
    static boolean fetchOnce(Context c) {
        try {
            JSONObject t = new JSONObject(Tokens.accessToken(c));
            if (!t.has("token")) return !"offline".equals(t.optString("error"));
            HttpURLConnection conn = (HttpURLConnection) new URL(
                    "https://api.spotify.com/v1/me/player/recently-played?limit=50").openConnection();
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(20000);
            conn.setRequestProperty("Authorization", "Bearer " + t.getString("token"));
            if (conn.getResponseCode() != 200) return false;
            JSONObject body;
            try (InputStream in = conn.getInputStream()) {
                body = new JSONObject(Tokens.read(in));
            }
            JSONArray items = body.optJSONArray("items");
            if (items == null || items.length() == 0) return true;
            // Only the fields the page needs, to keep the queue small.
            JSONArray slim = new JSONArray();
            String newest = "";
            for (int i = 0; i < items.length(); i++) {
                JSONObject it = items.getJSONObject(i);
                JSONObject tr = it.optJSONObject("track");
                if (tr == null) continue;
                String at = it.optString("played_at");
                if (at.compareTo(newest) > 0) newest = at;
                JSONObject album = tr.optJSONObject("album");
                JSONArray artists = tr.optJSONArray("artists");
                JSONObject s = new JSONObject()
                        .put("played_at", at)
                        .put("uri", tr.optString("uri"))
                        .put("name", tr.optString("name"))
                        .put("duration_ms", tr.optLong("duration_ms"))
                        .put("artist", artists != null && artists.length() > 0
                                ? artists.getJSONObject(0).optString("name") : "")
                        .put("album", album != null ? album.optString("name") : "");
                if (album != null) {
                    JSONArray imgs = album.optJSONArray("images");
                    if (imgs != null && imgs.length() > 0) {
                        s.put("img", imgs.getJSONObject(imgs.length() > 1 ? 1 : 0).optString("url"));
                    }
                }
                slim.put(s);
            }
            SharedPreferences p = c.getSharedPreferences("recent", Context.MODE_PRIVATE);
            p.edit().putLong("lastRun", System.currentTimeMillis()).apply();
            if (newest.equals(p.getString("newest", ""))) return true;
            synchronized (QUEUE_LOCK) {
                File f = queueFile(c);
                if (f.length() > MAX_QUEUE_BYTES) return true;
                try (FileOutputStream out = new FileOutputStream(f, true)) {
                    out.write((slim.toString() + "\n").getBytes(StandardCharsets.UTF_8));
                }
            }
            p.edit().putString("newest", newest).apply();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Returns every queued batch as one JSON array of arrays and empties the queue. */
    static String drain(Context c) {
        synchronized (QUEUE_LOCK) {
            File f = queueFile(c);
            if (!f.isFile()) return "[]";
            StringBuilder sb = new StringBuilder("[");
            try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), StandardCharsets.UTF_8))) {
                String line;
                boolean first = true;
                while ((line = r.readLine()) != null) {
                    if (line.trim().isEmpty()) continue;
                    if (!first) sb.append(',');
                    sb.append(line);
                    first = false;
                }
            } catch (Exception e) {
                return "[]";
            }
            f.delete();
            return sb.append(']').toString();
        }
    }

    static long lastRun(Context c) {
        return c.getSharedPreferences("recent", Context.MODE_PRIVATE).getLong("lastRun", 0);
    }

    private static File queueFile(Context c) {
        return new File(c.getFilesDir(), "recent-queue.jsonl");
    }
}
