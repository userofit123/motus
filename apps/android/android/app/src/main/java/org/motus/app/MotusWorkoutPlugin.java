package org.motus.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener2;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
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
import java.util.ArrayList;
import java.util.List;

/**
 * The rest timer in the notification shade and on the lock screen: a live countdown while a rest runs.
 * The interval timer the same way, as its own notification, so it can sit beside a running workout's, and an activity
 * being recorded as one more (with a route, the notification of the location service that keeps it going: RecordingService). The interval timer's coming changes are alarms that, with the app in the background, put
 * the timer's notification as it then is in place of the one shown, with a sound (TimerCue), so a run keeps one
 * notification however many rounds it has. Each can carry buttons (Pause, Skip, +30s…): a tap is sent to the web app as an "action"
 * event with the button's id, without opening the app, so it works from the lock screen.
 * Also the phone's step counter while a walk is recorded (see "steps" below).
 */
@CapacitorPlugin(name = "MotusWorkout", permissions = { @Permission(alias = "steps", strings = { "android.permission.ACTIVITY_RECOGNITION" }) })
public class MotusWorkoutPlugin extends Plugin implements SensorEventListener2 {
    // Default importance (without sound or vibration) rather than low: phones hide "silent" notifications from the lock
    // screen. A channel's importance can't be raised once made, hence a new channel in place of the old "workout" one.
    private static final String CHANNEL = "running";
    private static final String OLD_CHANNEL = "workout";
    private static final int ID = 7002;
    private static final int TIMER_ID = 7003;
    private static final int REC_ID = RecordingService.REC_ID;
    // the recording's notification while a route is recorded, so the location service can be started again if it
    // couldn't be when asked (location not yet allowed, the permission question still on screen)
    private static volatile Notification recNotice;
    // the recording's notification as last shown (with or without the service), put back when it's swiped away
    private static volatile Notification recShown;
    // Held around "read recShown, then post" (RecordingSwiped, main thread) and "clear recShown, then cancel"
    // (stopRecordingService, plugin thread), so a re-post can never land after the cancel and linger after the walk.
    private static final Object REC_LOCK = new Object();
    // a button's tap, as a broadcast only this app can send and receive
    private static final String ACTION = "org.motus.app.NOTICE_ACTION";
    private static final String EXTRA_ACTION = "motusAction";
    private BroadcastReceiver receiver;
    // the page a tap on a notification opens, handed to the web app as an "open" event (also the updater's, MotusUpdaterPlugin)
    static final String EXTRA_PATH = "motusPath";

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
     *  far, and Pause or Resume; tapping it opens the recording. `keepAlive` (a route or steps are recorded): it is the
     *  notification of the service that keeps them going with the screen off (RecordingService), not one beside it. */
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
            .setContentIntent(pi)
            .setDeleteIntent(PendingIntent.getBroadcast(getContext(), 0, new Intent(getContext(), RecordingSwiped.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        if (since != null) b.setWhen(since).setUsesChronometer(true).setShowWhen(true);
        else b.setShowWhen(false);
        addActions(b, call, 40);
        Notification n = b.build();
        recShown = n;
        if (call.getBoolean("keepAlive", false)) {
            recNotice = n;
            if (RecordingService.start(getContext(), n)) { call.resolve(); return; }
        } else if (recNotice != null) {
            recNotice = null;
            RecordingService.stop(getContext(), true);
        }
        try { NotificationManagerCompat.from(getContext()).notify(REC_ID, n); } catch (SecurityException e) { /* notifications not allowed */ }
        call.resolve();
    }

    @PluginMethod
    public void clearRecording(PluginCall call) {
        stopRecordingService();
        call.resolve();
    }

    private void stopRecordingService() {
        synchronized (REC_LOCK) {
            recNotice = null;
            recShown = null;
            RecordingService.stop(getContext(), false);
            NotificationManagerCompat.from(getContext()).cancel(REC_ID);
        }
    }

    /** The recording's notification swiped away. Since Android 13 a foreground service's notification can be swiped
     *  away, and Android 14 extended that to other ongoing notifications (here: a non-GPS recording with no service)
     *  (not on the lock screen, not with "Clear all"); the service and the recording go on regardless, but
     *  without it there'd be no way back to the walk or its Pause from the shade, so it is put straight back. Not once the
     *  recording has ended (recShown cleared; the app's own cancel doesn't come here anyway) or the app is gone. */
    public static class RecordingSwiped extends BroadcastReceiver {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            synchronized (REC_LOCK) {
                Notification n = recShown;
                if (!live || n == null) return;
                // with the service running, the same id is its notification again (posting it doesn't start anything)
                try { NotificationManagerCompat.from(ctx).notify(REC_ID, n); } catch (SecurityException e) { /* notifications not allowed */ }
            }
        }
    }

    // The location service couldn't start when the route did (the permission question was on screen): on coming back to
    // the app, and on leaving it (still allowed then), it's started now, so the route goes on with the screen off.
    private void keepRecording() {
        Notification n = recNotice;
        if (n != null && !RecordingService.isRunning()) RecordingService.start(getContext(), n);
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        keepRecording();
        // the Record screen is still open: listen again (the counter reports its total on registering)
        if (previewWanted && !previewing) previewing = counterSensor() != null && stepsAllowed() && register();
    }

    @Override
    protected void handleOnPause() {
        keepRecording();
        // in the background the preview is no use (no walk can start from there): it stops listening, the walk's
        // listener (if any) goes on; the walk's count is saved now, as Android may close the app from here
        if (previewing) { previewing = false; unregisterIfIdle(); }
        if (listening) saveSteps();
        super.handleOnPause();
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
        stopRecordingService();
        cancelCues(getContext()); // or they would show the timer again, with buttons nothing answers
        stopListening();
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
    // The phone's step counter (Sensor.TYPE_STEP_COUNTER), as Android's docs recommend for counting steps: the phone's
    // own pedometer, worked out in its sensor hardware, which only counts once it's sure you're walking (shaking or
    // tapping the phone adds nothing) and keeps counting with the screen off. It reports late (up to ten seconds by
    // Android's rules; many phones hold back the first ten or so steps of each walk, then send them in bunches), but each
    // report has every step since the last, so none is lost. Counted here, not in the web app: the counter's reports reach
    // this side even while the web app is held up (screen off, or reloaded by Android), and the web app reads the count
    // as it is whenever it gets to it. The count is since `session` (when counting started), so a reading that comes
    // late or twice changes nothing.
    private boolean listening = false;
    private long session = 0;
    /** the counter's total (since the phone started) when counting started, and its latest; -1 before its first report */
    private long counterBase = -1, counterNow = -1;
    /** The Record screen is open, before the walk starts: the counter is listened to already, and as it reports its
     *  total on registering, that total is known before the walk's first step. Registering only at Start would leave the
     *  start to the first report after it, which on many phones comes only once you're walking, with the first ten or
     *  so steps already in it, so they would be taken as the start and lost. `previewWanted`: the Record screen asked
     *  for it, so it listens again when the app comes back from the background. */
    private boolean previewing = false, previewWanted = false, registered = false;
    /** the counter's latest total while it's listened to (preview or walk), -1 when not known: the start of a new walk */
    private long lastTotal = -1;
    /** Kept on the phone, so that when Android closes the whole app mid-walk the reopened app goes on from the same start
     *  and the steps taken while it was closed still count (the counter kept counting). Cleared when the walk ends. */
    private static final String STEP_PREFS = "motus.steps";
    private final Handler main = new Handler(Looper.getMainLooper());
    /** getLastSteps calls waiting for the counter to hand over the steps it hasn't reported yet, oldest first, each with
     *  its own two-second limit */
    private final List<PluginCall> flushing = new ArrayList<>();
    private final List<Runnable> flushLimits = new ArrayList<>();
    /** Saving the walk's count on every report would write to storage with every bunch of steps; at most this often (ms)
     *  or every SAVE_STEPS steps instead, and always at the start, on going to the background and when the app closes. A
     *  count a little behind on reopening only means the next report brings those steps. */
    private static final long SAVE_MS = 5000, SAVE_STEPS = 50;
    private long savedAt = 0, savedNow = -1;
    /** flushes asked for by calls that were answered by their limit instead: their completion answers nobody */
    private int staleFlushes = 0;

    private Sensor counterSensor() {
        SensorManager sm = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        if (sm == null) return null;
        Sensor s = sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
        // some phones only have the wake-up kind, which the plain lookup doesn't return
        return s != null ? s : sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER, true);
    }

    private boolean stepsAllowed() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || getPermissionState("steps") == PermissionState.GRANTED;
    }

    /** Listens to the counter (once, for both the preview and the walk). No extra batching on top of the phone's own
     *  (latency 0): each report as soon as it has one. The counter reports its total on registering (what the preview
     *  relies on), then again with each bunch of steps. */
    private boolean register() {
        if (registered) return true;
        SensorManager sm = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        Sensor c = counterSensor();
        registered = sm != null && c != null && sm.registerListener(this, c, SensorManager.SENSOR_DELAY_NORMAL, 0);
        return registered;
    }

    /** stops listening when neither the preview nor a walk needs it; the last total is then no longer current */
    private void unregisterIfIdle() {
        if (listening || previewing || !registered) return;
        SensorManager sm = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        if (sm != null) sm.unregisterListener(this);
        registered = false;
        lastTotal = -1;
    }

    /** The Record screen opened (`on`) or closed: listens to the counter before the walk starts (see `previewing`). Never
     *  asks for the permission; without it the walk's start asks, and the counter starts from its first report then. */
    @PluginMethod
    public void previewSteps(PluginCall call) {
        boolean on = call.getBoolean("on", false);
        main.post(() -> {
            previewWanted = on;
            previewing = on && counterSensor() != null && stepsAllowed() && register();
            unregisterIfIdle();
        });
        call.resolve();
    }

    /** Starts counting. `fresh` (a new recording): from zero. Otherwise (the web app reloaded mid-recording, or Android
     *  closed the whole app and it reopened) it goes on with the count it has, so the steps in between aren't lost.
     *  Without a step counter `available` is false and the web app estimates steps from the motion sensor instead. */
    @PluginMethod
    public void startSteps(PluginCall call) {
        if (counterSensor() == null) { JSObject r = new JSObject(); r.put("available", false); call.resolve(r); return; }
        // Android 10+ asks for "physical activity" before the step counter reports anything
        if (!stepsAllowed()) {
            requestPermissionForAlias("steps", call, "stepsPermission");
            return;
        }
        main.post(() -> listen(call));
    }

    @PermissionCallback
    private void stepsPermission(PluginCall call) {
        if (getPermissionState("steps") == PermissionState.GRANTED) main.post(() -> listen(call));
        else { JSObject r = new JSObject(); r.put("available", false); r.put("denied", true); call.resolve(r); }
    }

    // on the main thread, where the counter's reports arrive too
    private void listen(PluginCall call) {
        boolean fresh = call.getBoolean("fresh", false);
        if (fresh || !listening) {
            SharedPreferences sp = getContext().getSharedPreferences(STEP_PREFS, Context.MODE_PRIVATE);
            if (!fresh && sp.getLong("session", 0) > 0) {
                // the app was closed mid-walk: the same count, from the same start; the counter's next report has every
                // step since (a counter lower than before means the phone restarted, handled where reports arrive)
                session = sp.getLong("session", 0);
                counterBase = sp.getLong("base", -1);
                counterNow = sp.getLong("now", -1);
            } else {
                session = System.currentTimeMillis();
                // the total from the preview, so the walk's first steps count even when the counter holds them back
                counterBase = lastTotal; counterNow = lastTotal;
            }
            listening = register();
            if (listening) saveSteps(); else unregisterIfIdle();
        }
        JSObject r = reading();
        r.put("available", listening);
        call.resolve(r);
    }

    private void saveSteps() {
        savedAt = System.currentTimeMillis(); savedNow = counterNow;
        getContext().getSharedPreferences(STEP_PREFS, Context.MODE_PRIVATE).edit()
            .putLong("session", session).putLong("base", counterBase).putLong("now", counterNow).apply();
    }

    /** the count so far: `counter` is -1 until the step counter's first report */
    private JSObject reading() {
        JSObject r = new JSObject();
        r.put("session", session);
        r.put("counter", counterBase < 0 ? -1 : counterNow - counterBase);
        return r;
    }

    @PluginMethod
    public void getSteps(PluginCall call) {
        JSObject r = reading();
        r.put("available", listening);
        call.resolve(r);
    }

    /** The count with the steps the counter is still holding back (it reports up to ten seconds late): asks it to hand
     *  them over now (flush) and answers once it has, or after two seconds at most. For Pause and Finish, so the last
     *  steps before them count. */
    @PluginMethod
    public void getLastSteps(PluginCall call) {
        main.post(() -> {
            SensorManager sm = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
            if (!listening || sm == null || !sm.flush(this)) { answer(call); return; }
            // its own limit: an earlier call's can't answer this one before its flush is done
            Runnable limit = () -> { int i = flushing.indexOf(call); if (i >= 0) { flushing.remove(i); flushLimits.remove(i); staleFlushes++; answer(call); } };
            flushing.add(call);
            flushLimits.add(limit);
            main.postDelayed(limit, 2000);
        });
    }

    /** a flush is done: answers the oldest call waiting (flushes finish in the order asked) */
    @Override
    public void onFlushCompleted(Sensor sensor) {
        main.post(() -> {
            if (staleFlushes > 0) { staleFlushes--; return; }
            if (flushing.isEmpty()) return;
            main.removeCallbacks(flushLimits.remove(0));
            answer(flushing.remove(0));
        });
    }

    /** answers every call still waiting (counting stopped), each once */
    private void endFlush() {
        List<PluginCall> calls = new ArrayList<>(flushing);
        for (Runnable r : flushLimits) main.removeCallbacks(r);
        flushing.clear();
        flushLimits.clear();
        staleFlushes = 0; // no longer listening: no flush to wait for
        for (PluginCall c : calls) answer(c);
    }

    private void answer(PluginCall c) {
        JSObject r = reading();
        r.put("available", listening);
        c.resolve(r);
    }

    /** the walk ended: the count is no longer needed, here or kept on the phone */
    @PluginMethod
    public void stopSteps(PluginCall call) {
        main.post(() -> {
            listening = false;
            unregisterIfIdle();
            getContext().getSharedPreferences(STEP_PREFS, Context.MODE_PRIVATE).edit().clear().apply();
            endFlush();
        });
        call.resolve();
    }

    /** the app is closing: stops listening, but keeps the walk's count on the phone for when it opens again */
    private void stopListening() {
        if (listening) saveSteps();
        listening = false; previewing = false; previewWanted = false;
        unregisterIfIdle();
        endFlush();
    }

    @Override
    public void onSensorChanged(SensorEvent e) {
        if (e.sensor.getType() != Sensor.TYPE_STEP_COUNTER) return;
        long total = (long) e.values[0];
        lastTotal = total;
        if (!listening) return; // the preview: only the start of the walk to come
        // Smaller than before means the counter restarted (the phone did): go on from here with the count so far.
        if (counterBase < 0) counterBase = total;
        else if (total < counterNow) counterBase = total - (counterNow - counterBase);
        counterNow = total;
        if (savedNow < 0 || total - savedNow >= SAVE_STEPS || total < savedNow || System.currentTimeMillis() - savedAt >= SAVE_MS) saveSteps();
        notifyListeners("steps", reading());
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) { }
}
