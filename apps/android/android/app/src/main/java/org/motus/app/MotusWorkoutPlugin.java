package org.motus.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.List;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The rest timer in the notification shade and on the lock screen: a live countdown while a rest runs.
 * The interval timer the same way, as its own notification, so it can sit beside a running workout's, and an activity
 * being recorded as one more. Each can carry buttons (Pause, Skip, +30s…): a tap is sent to the web app as an "action"
 * event with the button's id, without opening the app, so it works from the lock screen.
 * Also the phone's step counter while a walk is recorded: the hardware counter keeps counting with the screen off,
 * and the recording reads the running total (steps since the phone started) and subtracts where it began.
 */
@CapacitorPlugin(name = "MotusWorkout", permissions = { @Permission(alias = "steps", strings = { "android.permission.ACTIVITY_RECOGNITION" }) })
public class MotusWorkoutPlugin extends Plugin implements SensorEventListener {
    // Default importance (without sound or vibration) rather than low: phones hide "silent" notifications from the lock
    // screen. A channel's importance can't be raised once made, hence a new channel in place of the old "workout" one.
    private static final String CHANNEL = "running";
    private static final String OLD_CHANNEL = "workout";
    private static final int ID = 7002;
    private static final int TIMER_ID = 7003;
    private static final int REC_ID = 7004;
    // a button's tap, as a broadcast only this app can send and receive
    private static final String ACTION = "org.motus.app.NOTICE_ACTION";
    private static final String EXTRA_ACTION = "motusAction";
    private BroadcastReceiver receiver;
    // the page a tap on a notification opens, handed to the web app as an "open" event
    private static final String EXTRA_PATH = "motusPath";

    private void channel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Running now", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("A workout, rest, activity or interval timer while it runs");
            ch.setShowBadge(false);
            ch.setSound(null, null);
            ch.enableVibration(false);
            ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            nm.createNotificationChannel(ch);
            nm.deleteNotificationChannel(OLD_CHANNEL);
        }
    }

    /** The buttons the web app passes as `actions` ([{ id, title }], at most three, Android's limit). `base` keeps each
     *  notification's request codes apart, so one's buttons never take another's ids. */
    private void addActions(NotificationCompat.Builder b, PluginCall call, int base) {
        JSArray list = call.getArray("actions");
        if (list == null) return;
        try {
            List<Object> items = list.toList();
            for (int i = 0; i < items.size() && i < 3; i++) {
                if (!(items.get(i) instanceof JSONObject)) continue;
                JSONObject a = (JSONObject) items.get(i);
                Intent tap = new Intent(ACTION).setPackage(getContext().getPackageName()).putExtra(EXTRA_ACTION, a.getString("id"));
                PendingIntent pi = PendingIntent.getBroadcast(getContext(), base + i, tap, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                b.addAction(0, a.getString("title"), pi);
            }
        } catch (JSONException e) { /* shown without buttons */ }
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
        addActions(b, call, 20);
        try { NotificationManagerCompat.from(getContext()).notify(ID, b.build()); } catch (SecurityException e) { /* notifications not allowed */ }
        call.resolve();
    }

    /** The workout in progress (same place as the rest countdown, which replaces it while a rest runs): the exercise and
     *  set you're on, and the workout's clock counting up from `since` (none while paused). */
    @PluginMethod
    public void showSession(PluginCall call) {
        channel();
        Long since = call.getLong("since");
        Intent open = new Intent(getContext(), MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(getContext(), 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String body = call.getString("body", "");
        NotificationCompat.Builder b = new NotificationCompat.Builder(getContext(), CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_motus)
            .setContentTitle(call.getString("title", "Workout in progress"))
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setContentIntent(pi);
        if (since != null) b.setWhen(since).setUsesChronometer(true).setShowWhen(true);
        else b.setShowWhen(false);
        addActions(b, call, 10);
        try { NotificationManagerCompat.from(getContext()).notify(ID, b.build()); } catch (SecurityException e) { /* notifications not allowed */ }
        call.resolve();
    }

    @PluginMethod
    public void clearSession(PluginCall call) {
        NotificationManagerCompat.from(getContext()).cancel(ID);
        call.resolve();
    }

    @PluginMethod
    public void clearRest(PluginCall call) {
        NotificationManagerCompat.from(getContext()).cancel(ID);
        call.resolve();
    }

    /** The running interval timer: the part and round, and a countdown to the end of the part (`endAt`; none while
     *  paused). Shown again by the app at each change of part; tapping it opens the timer. */
    @PluginMethod
    public void showTimer(PluginCall call) {
        channel();
        Long endAt = call.getLong("endAt");
        Intent open = new Intent(getContext(), MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        open.putExtra(EXTRA_PATH, "/timer");
        // its own request code, so this intent's extra never ends up on the workout notification's
        PendingIntent pi = PendingIntent.getActivity(getContext(), 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String body = call.getString("body", "");
        NotificationCompat.Builder b = new NotificationCompat.Builder(getContext(), CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_motus)
            .setContentTitle(call.getString("title", "Interval timer"))
            .setContentText(body)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setContentIntent(pi);
        if (endAt != null) b.setWhen(endAt).setUsesChronometer(true).setChronometerCountDown(true).setShowWhen(true);
        else b.setShowWhen(false);
        addActions(b, call, 30);
        try { NotificationManagerCompat.from(getContext()).notify(TIMER_ID, b.build()); } catch (SecurityException e) { /* notifications not allowed */ }
        call.resolve();
    }

    @PluginMethod
    public void clearTimer(PluginCall call) {
        NotificationManagerCompat.from(getContext()).cancel(TIMER_ID);
        call.resolve();
    }

    /** An activity being recorded: its clock counting up from `since` (none while paused), the distance and steps so
     *  far, and Pause or Resume; tapping it opens the recording. */
    @PluginMethod
    public void showRecording(PluginCall call) {
        channel();
        Long since = call.getLong("since");
        Intent open = new Intent(getContext(), MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        open.putExtra(EXTRA_PATH, "/activities/record");
        PendingIntent pi = PendingIntent.getActivity(getContext(), 2, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(getContext(), CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_motus)
            .setContentTitle(call.getString("title", "Recording"))
            .setContentText(call.getString("body", ""))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setContentIntent(pi);
        if (since != null) b.setWhen(since).setUsesChronometer(true).setShowWhen(true);
        else b.setShowWhen(false);
        addActions(b, call, 40);
        try { NotificationManagerCompat.from(getContext()).notify(REC_ID, b.build()); } catch (SecurityException e) { /* notifications not allowed */ }
        call.resolve();
    }

    @PluginMethod
    public void clearRecording(PluginCall call) {
        NotificationManagerCompat.from(getContext()).cancel(REC_ID);
        call.resolve();
    }

    // A tap on the timer's notification: with the app open it arrives here; with the app started by the tap it is on the
    // starting intent. Kept until the web app listens, since it may not have loaded yet.
    @Override
    public void load() {
        if (getActivity() != null) openFrom(getActivity().getIntent());
        // a button's tap: kept until the web app listens, like "open"
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String id = intent.getStringExtra(EXTRA_ACTION);
                if (id == null) return;
                JSObject r = new JSObject();
                r.put("action", id);
                notifyListeners("action", r, true);
            }
        };
        ContextCompat.registerReceiver(getContext(), receiver, new IntentFilter(ACTION), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    protected void handleOnDestroy() {
        if (receiver != null) {
            try { getContext().unregisterReceiver(receiver); } catch (IllegalArgumentException e) { /* not registered */ }
            receiver = null;
        }
        super.handleOnDestroy();
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        openFrom(intent);
    }

    private void openFrom(Intent intent) {
        String path = intent == null ? null : intent.getStringExtra(EXTRA_PATH);
        if (path == null) return;
        intent.removeExtra(EXTRA_PATH); // once only, not again after a rotation
        JSObject r = new JSObject();
        r.put("path", path);
        notifyListeners("open", r, true);
    }

    // ---- steps ----
    private long stepTotal = -1;

    private Sensor stepSensor() {
        SensorManager sm = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        return sm == null ? null : sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
    }

    @PluginMethod
    public void startSteps(PluginCall call) {
        if (stepSensor() == null) { JSObject r = new JSObject(); r.put("available", false); call.resolve(r); return; }
        // Android 10+ asks for "physical activity" before the step counter reports anything
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && getPermissionState("steps") != PermissionState.GRANTED) {
            requestPermissionForAlias("steps", call, "stepsPermission");
            return;
        }
        listen(call);
    }

    @PermissionCallback
    private void stepsPermission(PluginCall call) {
        if (getPermissionState("steps") == PermissionState.GRANTED) listen(call);
        else { JSObject r = new JSObject(); r.put("available", false); r.put("denied", true); call.resolve(r); }
    }

    private void listen(PluginCall call) {
        SensorManager sm = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        sm.unregisterListener(this);
        sm.registerListener(this, stepSensor(), SensorManager.SENSOR_DELAY_NORMAL, 0);
        JSObject r = new JSObject();
        r.put("available", true);
        r.put("total", stepTotal);
        call.resolve(r);
    }

    @PluginMethod
    public void getSteps(PluginCall call) {
        JSObject r = new JSObject();
        r.put("available", stepSensor() != null);
        r.put("total", stepTotal);
        call.resolve(r);
    }

    @PluginMethod
    public void stopSteps(PluginCall call) {
        SensorManager sm = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        if (sm != null) sm.unregisterListener(this);
        call.resolve();
    }

    @Override
    public void onSensorChanged(SensorEvent e) {
        if (e.sensor.getType() != Sensor.TYPE_STEP_COUNTER) return;
        stepTotal = (long) e.values[0];
        JSObject r = new JSObject();
        r.put("total", stepTotal);
        notifyListeners("steps", r);
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) { }
}
