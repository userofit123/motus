package org.motus.app;

import android.Manifest;
import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * Keeps a route being recorded with the screen off: a foreground service of type location, which lets the app go on
 * getting the location plugin's fixes in the background. Android needs a notification for it, and that is the
 * recording's own (MotusWorkoutPlugin's REC_ID, with the clock, distance and Pause), so a walk shows one notification
 * rather than the location plugin's next to ours (that plugin is asked for no notification, so it never starts its own
 * foreground service).
 */
public class RecordingService extends Service {
    static final int REC_ID = 7004;
    // the notification to show, kept for onStartCommand, which runs a moment after start()
    private static volatile Notification notice;
    private static volatile boolean wanted = false;
    private static volatile RecordingService running;

    static boolean isRunning() { return running != null; }

    /** Runs the service with `n` as its notification, or, already running, puts `n` in its place. False when it can't
     *  start (location not allowed yet, or the app is in the background, where Android won't let one start). */
    static boolean start(Context ctx, Notification n) {
        notice = n;
        wanted = true;
        if (running != null) {
            try { NotificationManagerCompat.from(ctx).notify(REC_ID, n); } catch (SecurityException e) { /* notifications not allowed */ }
            return true;
        }
        // Android 14 refuses a location service without the location permission; it's asked for when the route starts
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
            && ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) return false;
        try {
            ContextCompat.startForegroundService(ctx, new Intent(ctx, RecordingService.class));
            return true;
        } catch (Exception e) {
            return false; // started from the background (Android 12+)
        }
    }

    /** Stops it. `keepNotice`: its notification stays as an ordinary one (the recording goes on without a route). */
    static void stop(Context ctx, boolean keepNotice) {
        wanted = false;
        RecordingService s = running;
        if (s != null) {
            ServiceCompat.stopForeground(s, keepNotice ? ServiceCompat.STOP_FOREGROUND_DETACH : ServiceCompat.STOP_FOREGROUND_REMOVE);
            s.stopSelf();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = notice;
        // a service started this way must go to the foreground even when it was stopped in the meantime, or Android ends the app
        try {
            if (n != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(REC_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
                else startForeground(REC_ID, n);
                running = this;
            }
        } catch (Exception e) { /* not allowed now: the route records while the app is open */ }
        if (n == null || !wanted || running == null) stop(this, false);
        if (running == null) stopSelf();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (running == this) running = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
