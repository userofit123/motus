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
import java.util.HashMap;
import java.util.HashSet;

/**
 * The rest timer's 10 seconds warning and 3-2-1 while the app is in the background, where the WebView's own timers and
 * sound are stopped (workout/runtime.ts plays them on screen). Each is an exact alarm, so it comes with the screen off,
 * and plays the chosen countdown sound from the same library as the web app (res/raw, the web app's src/sounds as
 * .ogg), at the same level and cut off at the same length, so a cue sounds the same in the background as on screen.
 * The rest's end is the web app's "Rest over" alarm, not this. A note whose moment passed more than LATE_MS ago is
 * dropped.
 */
public class RestCues extends BroadcastReceiver {
    private static final String ACTION = "org.motus.app.REST_CUE";
    private static final int WARN = 200, COUNT = 201; // the alarms' request codes
    private static final long LATE_MS = 1000;
    // a countdown note is cut off after this long, so it is over before the next second's (COUNT_MAX_S in runtime.ts)
    private static final long CUT_MS = 800;
    private static final int FADE_MS = 80, FADE_STEPS = 4;
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
     *  seconds still to come). */
    static void schedule(Context ctx, long endAt, boolean warn10, boolean countdown, String sound, int volume) {
        cancel(ctx);
        // loaded now, so it is ready when the first cue comes
        if (warn10 || countdown) { Context app = ctx.getApplicationContext(); audio.post(() -> load(app, sound)); }
        long now = System.currentTimeMillis();
        if (warn10 && endAt - 10_000 > now) set(ctx, WARN, endAt - 10_000, endAt, sound, volume);
        if (countdown && endAt - 1000 > now) set(ctx, COUNT, Math.max(endAt - 3000, now), endAt, sound, volume);
    }

    private static void set(Context ctx, int code, long at, long endAt, String sound, int volume) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Intent it = intent(ctx).putExtra("warn", code == WARN).putExtra("from", at).putExtra("endAt", endAt)
            .putExtra("sound", sound).putExtra("volume", volume);
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
        for (int code : new int[] { WARN, COUNT }) {
            PendingIntent pi = PendingIntent.getBroadcast(ctx, code, intent(ctx), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_NO_CREATE);
            if (pi == null) continue;
            if (am != null) am.cancel(pi);
            pi.cancel();
        }
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        // the app is gone (swiped away): no cues for a rest nothing shows any more
        if (!MotusWorkoutPlugin.live) return;
        boolean warn = intent.getBooleanExtra("warn", false);
        long endAt = intent.getLongExtra("endAt", 0), from = intent.getLongExtra("from", 0);
        String sound = intent.getStringExtra("sound");
        int volume = intent.getIntExtra("volume", 100);
        // as on screen: the 10 seconds and each of the 3-2-1 are one play of the countdown sound, all alike (beep()):
        // the rest over sound is the "now", so the "1" gets no different note of its own
        long[] due = warn ? new long[] { endAt - 10_000 } : new long[] { endAt - 3000, endAt - 2000, endAt - 1000 };
        long now = System.currentTimeMillis(), last = now;
        Context app = ctx.getApplicationContext();
        for (long d : due) {
            if (d < from - 50 || now - d > LATE_MS) continue; // played on screen before the app went away, or long gone
            long wait = Math.max(0, d - now);
            audio.postAtTime(() -> play(app, sound, volume, d), NOTES, SystemClock.uptimeMillis() + wait);
            last = Math.max(last, now + wait);
        }
        // the 3-2-1 takes up to 3 seconds: kept awake (and the broadcast open) until its last note has played
        PendingResult pending = goAsync();
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        PowerManager.WakeLock wl = pm == null ? null : pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "motus:restcue");
        if (wl != null) wl.acquire(5000);
        main.postDelayed(() -> {
            if (wl != null && wl.isHeld()) wl.release();
            pending.finish();
        }, last - now + CUT_MS + 400);
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

    /** One countdown note, due at `due` (ms): the sound at the chosen level (10-100 %, squared as levelOf in
     *  workout/runtime.ts), cut off after CUT_MS. */
    private static void play(Context ctx, String sound, int volume, long due) {
        int id = load(ctx, sound);
        if (id == 0) return;
        float level = (float) Math.pow(Math.max(10, Math.min(100, volume)) / 100.0, 2);
        if (ready.contains(id)) start(id, level);
        else waiting.put(id, () -> { if (System.currentTimeMillis() - due <= LATE_MS) start(id, level); });
    }

    private static void start(int id, float level) {
        int stream = pool.play(id, level, level, 1, 0, 1f);
        if (stream == 0) return;
        // fades out over the last FADE_MS in FADE_STEPS steps (like the web's 80 ms ramp), then stops; all on the audio thread
        for (int i = 1; i <= FADE_STEPS; i++) {
            final float v = level * (1f - (float) i / FADE_STEPS);
            audio.postDelayed(() -> pool.setVolume(stream, v, v), CUT_MS - FADE_MS + (long) FADE_MS * i / FADE_STEPS);
        }
        audio.postDelayed(() -> pool.stop(stream), CUT_MS + 10);
    }
}
