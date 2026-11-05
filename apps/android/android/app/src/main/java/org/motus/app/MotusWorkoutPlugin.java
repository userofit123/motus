package org.motus.app;

import android.app.AlarmManager;
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
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The rest timer in the notification shade and on the lock screen: a live countdown while a rest runs.
 * The interval timer the same way, as its own notification, so it can sit beside a running workout's, and an activity
 * being recorded as one more. The interval timer's coming changes are alarms that, with the app in the background, put
 * the timer's notification as it then is in place of the one shown, with a sound (TimerCue), so a run keeps one
 * notification however many rounds it has. Each can carry buttons (Pause, Skip, +30s…): a tap is sent to the web app as an "action"
 * event with the button's id, without opening the app, so it works from the lock screen.
 * Also the phone's step sensors while a walk is recorded; both keep counting with the screen off. The step counter gives
 * the running total (steps since the phone started), which the recording subtracts where it began; it holds back the
 * first steps after standing still until it's sure you're walking. The step detector reports each step as it happens,
 * so the count moves straight away, and the counter later fills in any the detector missed.
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
        addActions(getContext(), b, call.getArray("actions"), base);
    }

    private static void addActions(Context ctx, NotificationCompat.Builder b, JSONArray list, int base) {
        if (list == null) return;
        try {
            for (int i = 0; i < list.length() && i < 3; i++) {
                JSONObject a = list.optJSONObject(i);
                if (a == null) continue;
                Intent tap = new Intent(ACTION).setPackage(ctx.getPackageName()).putExtra(EXTRA_ACTION, a.getString("id"));
                PendingIntent pi = PendingIntent.getBroadcast(ctx, base + i, tap, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                b.addAction(0, a.getString("title"), pi);
            }
        } catch (JSONException e) { /* shown without buttons */ }
    }

    // a tap on the timer's notification opens the timer; its own request code, so this intent's extra never ends up on
    // the workout notification's
    private static PendingIntent openTimer(Context ctx) {
        Intent open = new Intent(ctx, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        open.putExtra(EXTRA_PATH, "/timer");
        return PendingIntent.getActivity(ctx, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
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
        PendingIntent pi = openTimer(getContext());
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

    // ---- the interval timer's coming changes ----
    // At most CUE_MAX alarms at a time (the web app passes only the next ones); request codes CUE_BASE+ keep them apart.
    private static final int CUE_MAX = 60;
    private static final int CUE_BASE = 100;
    private static final String CUE_ACTION = "org.motus.app.TIMER_CUE";
    // the sound channel the web app makes for the rest alarm (workout/native.ts), so a change sounds like it always did
    private static final String CUE_CHANNEL = "rest";

    // True while this process has the web app loaded (load() until handleOnDestroy()). Swiping the app away usually kills
    // the process without handleOnDestroy, so its alarms then fire into a fresh process where this is false: nothing
    // would answer the notification's buttons there, so the cue takes everything off instead of showing it.
    private static volatile boolean live = false;

    private static Intent cueIntent(Context ctx) {
        return new Intent(ctx, TimerCue.class).setAction(CUE_ACTION);
    }

    private static void cancelCues(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        for (int i = 0; i < CUE_MAX; i++) {
            PendingIntent pi = PendingIntent.getBroadcast(ctx, CUE_BASE + i, cueIntent(ctx), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_NO_CREATE);
            if (pi == null) continue;
            if (am != null) am.cancel(pi);
            pi.cancel();
        }
    }

    /** The timer's coming changes (`cues`: [{ at, title, body, endAt, actions, done }]), in place of any scheduled before;
     *  none takes them all off. Each, at its time, shows the timer's notification as it then is (TimerCue). */
    @PluginMethod
    public void scheduleTimer(PluginCall call) {
        Context ctx = getContext();
        cancelCues(ctx);
        JSArray cues = call.getArray("cues");
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (cues == null || am == null) { call.resolve(); return; }
        // without the exact-alarm permission (Android 12+ can take it away) the change may come a little late, never not at all
        boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
        for (int i = 0; i < cues.length() && i < CUE_MAX; i++) {
            JSONObject c = cues.optJSONObject(i);
            if (c == null) continue;
            JSONArray actions = c.optJSONArray("actions");
            Intent it = cueIntent(ctx)
                .putExtra("title", c.optString("title", "Interval timer"))
                .putExtra("body", c.optString("body", ""))
                .putExtra("endAt", c.isNull("endAt") ? -1L : c.optLong("endAt", -1L))
                .putExtra("done", c.optBoolean("done", false))
                .putExtra("actions", actions == null ? "[]" : actions.toString());
            PendingIntent pi = PendingIntent.getBroadcast(ctx, CUE_BASE + i, it, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            long at = c.optLong("at", System.currentTimeMillis());
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) am.setExact(AlarmManager.RTC_WAKEUP, at, pi);
            else if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
        call.resolve();
    }

    /** One of the timer's changes, come while the app is in the background: the timer's own notification (TIMER_ID),
     *  updated in place, on the sound channel and without "alert once", so this update sounds while the app's quiet
     *  updates (showTimer) don't. The last one ("done") is no longer ongoing and goes when tapped. */
    public static class TimerCue extends BroadcastReceiver {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            // the app is gone: leave nothing behind, like handleOnDestroy (it shows the timer again when opened mid-run)
            if (!live) {
                cancelCues(ctx);
                NotificationManagerCompat.from(ctx).cancel(TIMER_ID);
                return;
            }
            boolean done = intent.getBooleanExtra("done", false);
            long endAt = intent.getLongExtra("endAt", -1L);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
                // made by the web app; only if it is somehow missing, the same one here
                if (nm != null && nm.getNotificationChannel(CUE_CHANNEL) == null) {
                    NotificationChannel ch = new NotificationChannel(CUE_CHANNEL, "Rest timer", NotificationManager.IMPORTANCE_HIGH);
                    ch.enableVibration(true);
                    nm.createNotificationChannel(ch);
                }
            }
            NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CUE_CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_motus)
                .setContentTitle(intent.getStringExtra("title"))
                .setContentText(intent.getStringExtra("body"))
                .setOngoing(!done)
                .setAutoCancel(done)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setDefaults(NotificationCompat.DEFAULT_ALL) // the sound and vibration before Android 8, which has no channels
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
                .setContentIntent(openTimer(ctx));
            if (endAt > 0) b.setWhen(endAt).setUsesChronometer(true).setChronometerCountDown(true).setShowWhen(true);
            else b.setShowWhen(false);
            try { addActions(ctx, b, new JSONArray(intent.getStringExtra("actions")), 30); } catch (JSONException | NullPointerException e) { /* shown without buttons */ }
            try { NotificationManagerCompat.from(ctx).notify(TIMER_ID, b.build()); } catch (SecurityException e) { /* notifications not allowed */ }
        }
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
        live = true;
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

    // The app is closed (swiped away): its ongoing notifications would stay with buttons nothing answers any more, so
    // they go too. The app shows them again when it opens with something still running.
    @Override
    protected void handleOnDestroy() {
        live = false;
        if (receiver != null) {
            try { getContext().unregisterReceiver(receiver); } catch (IllegalArgumentException e) { /* not registered */ }
            receiver = null;
        }
        NotificationManagerCompat nm = NotificationManagerCompat.from(getContext());
        nm.cancel(ID);
        nm.cancel(TIMER_ID);
        nm.cancel(REC_ID);
        cancelCues(getContext()); // or they would show the timer again, with buttons nothing answers
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

    private Sensor sensor(int type) {
        SensorManager sm = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        return sm == null ? null : sm.getDefaultSensor(type);
    }

    private boolean hasStepSensor() {
        return sensor(Sensor.TYPE_STEP_COUNTER) != null || sensor(Sensor.TYPE_STEP_DETECTOR) != null;
    }

    @PluginMethod
    public void startSteps(PluginCall call) {
        if (!hasStepSensor()) { JSObject r = new JSObject(); r.put("available", false); call.resolve(r); return; }
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
        // no batching (latency 0): each reading is sent as soon as the sensor has it, not held for a later batch
        Sensor counter = sensor(Sensor.TYPE_STEP_COUNTER), detector = sensor(Sensor.TYPE_STEP_DETECTOR);
        if (counter != null) sm.registerListener(this, counter, SensorManager.SENSOR_DELAY_FASTEST, 0);
        if (detector != null) sm.registerListener(this, detector, SensorManager.SENSOR_DELAY_FASTEST, 0);
        JSObject r = new JSObject();
        r.put("available", true);
        r.put("counter", counter != null);
        r.put("total", stepTotal);
        call.resolve(r);
    }

    @PluginMethod
    public void getSteps(PluginCall call) {
        JSObject r = new JSObject();
        r.put("available", hasStepSensor());
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
        // one event per step, sent on its own so the web app counts it at once
        if (e.sensor.getType() == Sensor.TYPE_STEP_DETECTOR) { notifyListeners("step", new JSObject()); return; }
        if (e.sensor.getType() != Sensor.TYPE_STEP_COUNTER) return;
        stepTotal = (long) e.values[0];
        JSObject r = new JSObject();
        r.put("total", stepTotal);
        notifyListeners("steps", r);
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) { }
}
