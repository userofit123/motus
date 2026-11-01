package org.motus.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** The rest timer in the notification shade and on the lock screen: a live countdown while a rest runs. */
@CapacitorPlugin(name = "MotusWorkout")
public class MotusWorkoutPlugin extends Plugin {
    private static final String CHANNEL = "workout";
    private static final int ID = 7002;

    private void channel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Workout in progress", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            ((NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE)).createNotificationChannel(ch);
        }
    }

    @PluginMethod
    public void showRest(PluginCall call) {
        channel();
        long endAt = call.getLong("endAt", System.currentTimeMillis());
        String body = call.getString("body", "");
        Intent open = new Intent(getContext(), MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(getContext(), 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(getContext(), CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_motus)
            .setContentTitle("Rest")
            .setContentText(body)
            .setWhen(endAt)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setTimeoutAfter(Math.max(1000, endAt - System.currentTimeMillis() + 2000))
            .setContentIntent(pi);
        try { NotificationManagerCompat.from(getContext()).notify(ID, b.build()); } catch (SecurityException e) { /* notifications not allowed */ }
        call.resolve();
    }

    @PluginMethod
    public void clearRest(PluginCall call) {
        NotificationManagerCompat.from(getContext()).cancel(ID);
        call.resolve();
    }
}
