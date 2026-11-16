package org.motus.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.SoundPool;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.util.HashMap;
import java.util.HashSet;

/**
 * The rest timer's sounds while the app is in the background, where the WebView's own timers and sound are stopped
 * (workout/runtime.ts plays them on screen): the 10 seconds warning and 3-2-1 in the chosen countdown sound, cut off at
 * the same length as on screen, and the end in the rest over sound, whole. Each is an exact alarm, so it comes with the
 * screen off, and plays from the same library as the web app (res/raw, the web app's src/sounds as .ogg) at the same
 * level, so a cue sounds the same in the background as on screen. The end is played here and not by the "Rest over"
 * notification (which is silent): a notification's sound is the phone's notification sound, which a phone on vibrate
 * or silent doesn't play, while these are on the media stream like the sound on screen. A note whose moment passed
 * more than LATE_MS ago is dropped. Android 5-7 have no notification channels, where the plugin that shows the web
 * app's "Rest over" gives it the phone's sound and vibration whatever the settings: there the web app leaves it out and
 * the end's alarm shows it itself (OWN_NOTICE), silent and vibrating only when that is on. With Voice cues on, the
 * 10 seconds and the end are also spoken (Voice), SAY_AFTER_MS after their sound as on screen.
 */
public class RestCues extends BroadcastReceiver {
    private static final String ACTION = "org.motus.app.REST_CUE";
    private static final int WARN = 200, COUNT = 201, END = 202; // the alarms' request codes
    private static final long LATE_MS = 1000;
    private static final boolean OWN_NOTICE = Build.VERSION.SDK_INT < Build.VERSION_CODES.O;
    // REST_ALARM in workout/native.ts, so the web app's taking the "Rest over" off takes this one off too
    private static final int NOTICE_ID = 7001;
    // a countdown note is cut off after this long, so it is over before the next second's (COUNT_MAX_S in runtime.ts)
    private static final long CUT_MS = 800;
    // the longest a rest over sound plays (Level up, the longest in the library, is 0.73 s), with room to spare
    private static final long END_MS = 2000;
    private static final int FADE_MS = 80, FADE_STEPS = 4;
    // a voice cue starts this long after its sound (SAY_AFTER_MS in runtime.ts), and the broadcast is kept open for
    // SAY_MS more so the phone stays awake while it is said ("Rest over. Bench Press, set 3, 8 reps at 80 kilos")
    private static final long SAY_AFTER_MS = 700, SAY_MS = 6000;
    // the notes waiting to play, so taking the cues off (the app came back) also stops a 3-2-1 already under way
    private static final Object NOTES = new Object();
    private static final Handler main = new Handler(Looper.getMainLooper());
    // the sounds are loaded and played on one background thread, not the main one
    private static final HandlerThread worker = new HandlerThread("motus-restcues");
    static { worker.start(); }
    private static final Handler audio = new Handler(worker.getLooper());

    private static Intent intent(Context ctx) {
        return new Intent(ctx, RestCues.class).setAction(ACTION);
    }

    /** The cues for a rest ending at `endAt`, in place of any scheduled before. `countdown`: the 3-2-1 (only the
     *  seconds still to come). `sound`: the countdown sound; `endSound`: the rest over sound (null: none at the end). `body`, `vibrate`: the "Rest over" shown on Android 5-7. `say10`, `sayEnd`: spoken after the 10 seconds' sound and the
     *  end's (null: nothing); only with the sounds, as Voice cues sit under Play sounds. */
    static void schedule(Context ctx, long endAt, boolean warn10, boolean countdown, String sound, String endSound, int volume, String body, boolean vibrate, String say10, String sayEnd) {
        cancel(ctx);
        if (say10 != null || sayEnd != null) Voice.warm(ctx);
        // loaded now, so each is ready when its first cue comes
        Context app = ctx.getApplicationContext();
        if (warn10 || countdown) audio.post(() -> load(app, sound));
        if (endSound != null) audio.post(() -> load(app, endSound));
        long now = System.currentTimeMillis();
        if (warn10 && endAt - 10_000 > now) set(ctx, WARN, endAt - 10_000, endAt, sound, volume, body, vibrate, say10);
        if (countdown && endAt - 1000 > now) set(ctx, COUNT, Math.max(endAt - 3000, now), endAt, sound, volume, body, vibrate, null);
        if ((endSound != null || OWN_NOTICE) && endAt > now) set(ctx, END, endAt, endAt, endSound, volume, body, vibrate, endSound != null ? sayEnd : null);
    }

    private static void set(Context ctx, int code, long at, long endAt, String sound, int volume, String body, boolean vibrate, String say) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Intent it = intent(ctx).putExtra("warn", code == WARN).putExtra("end", code == END).putExtra("from", at).putExtra("endAt", endAt)
            .putExtra("sound", sound).putExtra("volume", volume).putExtra("body", body).putExtra("vibrate", vibrate).putExtra("say", say);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, code, it, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        // without the exact-alarm permission (Android 12+ can take it away) the alarm may come late; its notes are then dropped
        boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) am.setExact(AlarmManager.RTC_WAKEUP, at, pi);
        else if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
    }

    static void cancel(Context ctx) {
        audio.removeCallbacksAndMessages(NOTES);
        audio.post(waiting::clear);
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        for (int code : new int[] { WARN, COUNT, END }) {
            PendingIntent pi = PendingIntent.getBroadcast(ctx, code, intent(ctx), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_NO_CREATE);
            if (pi == null) continue;
            if (am != null) am.cancel(pi);
            pi.cancel();
        }
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        boolean warn = intent.getBooleanExtra("warn", false), end = intent.getBooleanExtra("end", false);
        // also when the app is gone (swiped away, or closed by Android): the developer wants the 10 seconds, the 3-2-1
        // and the end alike in every case, and a rest's "Rest over" still comes then (its alarm outlives the app)
        long endAt = intent.getLongExtra("endAt", 0), from = intent.getLongExtra("from", 0);
        String sound = intent.getStringExtra("sound");
        Context app = ctx.getApplicationContext();
        if (end && OWN_NOTICE) showRestOver(app, intent.getStringExtra("body"), intent.getBooleanExtra("vibrate", false), sound != null);
        if (sound == null) return; // the workout sounds are off: the end has only its notification
        int volume = intent.getIntExtra("volume", 100);
        // as on screen: the 10 seconds and each of the 3-2-1 are one play of the countdown sound, all alike (beep()),
        // cut off; the end is the rest over sound, played whole (restOver())
        long[] due = end ? new long[] { endAt } : warn ? new long[] { endAt - 10_000 } : new long[] { endAt - 3000, endAt - 2000, endAt - 1000 };
        long now = System.currentTimeMillis(), last = now;
        boolean played = false;
        for (long d : due) {
            if (d < from - 50 || now - d > LATE_MS) continue; // played on screen before the app went away, or long gone
            long wait = Math.max(0, d - now);
            audio.postAtTime(() -> play(app, sound, volume, d, !end), NOTES, SystemClock.uptimeMillis() + wait);
            last = Math.max(last, now + wait);
            played = true;
        }
        // the voice after the sound (the WARN and END alarms have one note each), dropped with it when it is too late,
        // and taken off with the notes when the app comes back (cancel; MotusWorkoutPlugin.cancelRestCues also stops one being said);
        // an engine stuck since an earlier cue is let go as this one comes in (Voice.unstick), so it is said by a fresh one
        String say = intent.getStringExtra("say");
        float level = (float) Math.pow(Math.max(10, Math.min(100, volume)) / 100.0, 2);
        boolean speaks = played && say != null;
        if (speaks) audio.postAtTime(() -> Voice.say(app, say, level), NOTES, SystemClock.uptimeMillis() + (last - now) + SAY_AFTER_MS);
        // the 3-2-1 takes up to 3 seconds: kept awake (and the broadcast open) until its last note has played (the
        // rest over sound, uncut, is shorter than END_MS)
        PendingResult pending = goAsync();
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        PowerManager.WakeLock wl = pm == null ? null : pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "motus:restcue");
        if (wl != null) wl.acquire(speaks ? 5000 + SAY_AFTER_MS + SAY_MS : 5000);
        main.postDelayed(() -> {
            if (wl != null && wl.isHeld()) wl.release();
            pending.finish();
        }, last - now + (speaks ? SAY_AFTER_MS + SAY_MS : end ? END_MS : CUT_MS) + 400);
    }

    /** "Rest over" on Android 5-7 (OWN_NOTICE), like the web app's elsewhere: silent (its sound is the rest over sound
     *  played here), vibrating when that is on, heads-up only when it sounds or vibrates (the quiet "running" channel
     *  when neither, workout/native.ts). A tap opens the app. */
    private static void showRestOver(Context ctx, String body, boolean vibrate, boolean sound) {
        Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, NOTICE_ID, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, "running")
            .setSmallIcon(R.drawable.ic_stat_motus)
            .setContentTitle("Rest over")
            .setContentText(body == null || body.isEmpty() ? "Time for the next set" : body)
            .setPriority(vibrate || sound ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(pi);
        // no defaults: no sound; the vibration as in the app (vibrate([300, 150, 300]) in workout/runtime.ts)
        if (vibrate) b.setVibrate(new long[] { 0, 300, 150, 300 });
        try { NotificationManagerCompat.from(ctx).notify(NOTICE_ID, b.build()); } catch (SecurityException e) { /* notifications not allowed */ }
    }

    // The sounds, loaded once and kept: all of this is used only on the audio thread.
    private static SoundPool pool;
    private static final HashMap<Integer, Integer> loaded = new HashMap<>(); // raw resource -> the pool's sound id
    private static final HashSet<Integer> ready = new HashSet<>(); // the pool's sound ids that have finished loading
    // a note asked for while its sound was still loading, played once it has (if still on time)
    private static final HashMap<Integer, Runnable> waiting = new HashMap<>();

    /** The file of each sound in the library (SOUND_IDS in packages/shared sounds.ts, the files named in snake_case);
     *  an id this version doesn't know plays the usual countdown sound (the web app cleans the choice before). */
    private static int rawOf(String sound) {
        if (sound == null) return R.raw.progress_step;
        switch (sound) {
            case "hover": return R.raw.hover;
            case "soft": return R.raw.soft;
            case "check": return R.raw.check;
            case "marimba": return R.raw.marimba;
            case "bell": return R.raw.bell;
            case "high": return R.raw.high;
            case "info": return R.raw.info;
            case "checkpoint": return R.raw.checkpoint;
            case "notification": return R.raw.notification;
            case "success": return R.raw.success;
            case "levelUp": return R.raw.level_up;
            default: return R.raw.progress_step; // "progressStep"
        }
    }

    /** The pool's id of a sound, loading it the first time (0: it can't be played). */
    private static int load(Context ctx, String sound) {
        try {
            if (pool == null) {
                // the media stream and its volume, like the WebView's sound on screen
                AudioAttributes attrs = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
                pool = new SoundPool.Builder().setMaxStreams(2).setAudioAttributes(attrs).build();
                // may be called on another thread: handed to the audio thread, which alone touches these
                pool.setOnLoadCompleteListener((sp, sampleId, status) -> audio.post(() -> {
                    if (status != 0) {
                        // a failed load must not stay "loaded": a later schedule retries it, and a note waiting for it is dropped
                        loaded.values().remove(sampleId);
                        waiting.remove(sampleId);
                        return;
                    }
                    ready.add(sampleId);
                    Runnable r = waiting.remove(sampleId);
                    if (r != null) r.run();
                }));
            }
            int res = rawOf(sound);
            Integer id = loaded.get(res);
            if (id == null) {
                id = pool.load(ctx, res, 1);
                if (id == 0) return 0;
                loaded.put(res, id);
            }
            return id;
        } catch (RuntimeException e) { return 0; } // no sound
    }

    /** One note, due at `due` (ms): the sound at the chosen level (10-100 %, squared as levelOf in workout/runtime.ts),
     *  a countdown note (`cut`) cut off after CUT_MS. */
    private static void play(Context ctx, String sound, int volume, long due, boolean cut) {
        int id = load(ctx, sound);
        if (id == 0) return;
        float level = (float) Math.pow(Math.max(10, Math.min(100, volume)) / 100.0, 2);
        if (ready.contains(id)) start(id, level, cut);
        else waiting.put(id, () -> { if (System.currentTimeMillis() - due <= LATE_MS) start(id, level, cut); });
    }

    private static void start(int id, float level, boolean cut) {
        int stream = pool.play(id, level, level, 1, 0, 1f);
        if (stream == 0 || !cut) return;
        // fades out over the last FADE_MS in FADE_STEPS steps (like the web's 80 ms ramp), then stops; all on the audio thread
        for (int i = 1; i <= FADE_STEPS; i++) {
            final float v = level * (1f - (float) i / FADE_STEPS);
            audio.postDelayed(() -> pool.setVolume(stream, v, v), CUT_MS - FADE_MS + (long) FADE_MS * i / FADE_STEPS);
        }
        audio.postDelayed(() -> pool.stop(stream), CUT_MS + 10);
    }
}
