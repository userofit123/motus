package org.motus.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * In-app updates from GitHub Releases: downloads the new APK into the app's cache, checks its SHA-256 against the
 * release's android-latest.json, and hands it to Android's installer (which always asks the person to confirm).
 * While it downloads, a notification shows how far it is (so leaving the app doesn't hide it), then that it's ready or
 * that it failed; a tap opens Settings, App & Versions, where Install is.
 */
@CapacitorPlugin(name = "MotusUpdater")
public class MotusUpdaterPlugin extends Plugin {
    // its own channel, so updates can be silenced in the phone's settings without touching the workout ones; low
    // importance: a progress bar that changes every second must not sound or pop up
    private static final String CHANNEL = "updates";
    private static final int ID = 7005;

    private void channel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "App updates", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("A new version of Motus while it downloads");
            ch.setShowBadge(false);
            ((NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE)).createNotificationChannel(ch);
        }
    }

    /** The download's notification. `pct` 0-100, or -1 while the size is unknown (a moving bar); `busy` false when done
     *  or failed (no bar, and it can be swiped away). */
    private void notice(String title, String text, int pct, boolean busy) {
        Intent open = new Intent(getContext(), MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        open.putExtra(MotusWorkoutPlugin.EXTRA_PATH, "/settings/versions");
        // its own request code, so this intent's page never ends up on another notification's tap
        PendingIntent pi = PendingIntent.getActivity(getContext(), 3, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(getContext(), CHANNEL)
            .setSmallIcon(busy ? android.R.drawable.stat_sys_download : R.drawable.ic_stat_motus)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(busy)
            .setAutoCancel(!busy)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setContentIntent(pi);
        if (busy) b.setProgress(100, Math.max(0, pct), pct < 0);
        try { NotificationManagerCompat.from(getContext()).notify(ID, b.build()); } catch (SecurityException e) { /* notifications not allowed */ }
    }

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        String sha = call.getString("sha256");
        if (url == null) { call.reject("No download address"); return; }
        channel();
        String title = "Downloading Motus " + call.getString("version", "");
        notice(title.trim(), "Starting", -1, true);
        new Thread(() -> {
            try {
                File out = new File(getContext().getCacheDir(), "motus-update.apk");
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                try (InputStream in = c.getInputStream(); FileOutputStream fo = new FileOutputStream(out)) {
                    byte[] buf = new byte[65536];
                    int n;
                    long total = c.getContentLengthLong(), done = 0, last = 0, lastNotice = 0;
                    while ((n = in.read(buf)) > 0) {
                        fo.write(buf, 0, n); md.update(buf, 0, n); done += n;
                        // tell the page how far it is, at most four times a second
                        long now = System.currentTimeMillis();
                        if (now - last >= 250) {
                            last = now;
                            JSObject p = new JSObject();
                            p.put("loaded", done); p.put("total", total);
                            notifyListeners("progress", p);
                        }
                        // the notification once a second: Android drops updates that come faster
                        if (now - lastNotice >= 1000) {
                            lastNotice = now;
                            if (total > 0) { int pct = (int) (done * 100 / total); notice(title.trim(), pct + "%", pct, true); }
                            else notice(title.trim(), String.format(java.util.Locale.ROOT, "%.1f MB", done / 1e6), -1, true);
                        }
                    }
                }
                StringBuilder hex = new StringBuilder();
                for (byte b : md.digest()) hex.append(String.format("%02x", b));
                if (sha != null && !sha.isEmpty() && !sha.equalsIgnoreCase(hex.toString())) {
                    out.delete();
                    notice("Update failed", "The download was damaged. Tap to try again.", 0, false);
                    call.reject("The download was damaged. Try again.");
                    return;
                }
                JSObject r = new JSObject();
                r.put("path", out.getAbsolutePath());
                notice("Update ready to install", "Tap to open App & Versions, then Install", 0, false);
                call.resolve(r);
            } catch (Exception e) {
                notice("Update failed", "The download didn't finish. Tap to try again.", 0, false);
                call.reject("Download failed: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        if (path == null) { call.reject("Nothing downloaded"); return; }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            // first time: Android needs "Install unknown apps" allowed for Motus
            Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(s);
            call.reject("Allow Motus to install updates, then tap Install again");
            return;
        }
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", new File(path));
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        NotificationManagerCompat.from(getContext()).cancel(ID); // done with: Android's installer takes over
        call.resolve();
    }
}
