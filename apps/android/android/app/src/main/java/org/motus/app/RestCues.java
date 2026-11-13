package org.motus.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;

/**
 * The rest timer's 10 seconds warning and 3-2-1 while the app is in the background, where the WebView's own timers and
 * sound are stopped (workout/runtime.ts plays them on screen). Each is an exact alarm, so it comes with the screen off,
 * and the notes are made here the way the web app makes them (workout/runtime.ts CUE_NOTE): the same partials,
 * envelope, pitch and level for each cue sound, so a cue sounds the same in the background as on screen. The rest's end
 * is the web app's "Rest over" alarm, not this. A note whose moment passed more than LATE_MS ago is dropped.
 */
public class RestCues extends BroadcastReceiver {
    private static final String ACTION = "org.motus.app.REST_CUE";
    private static final int WARN = 200, COUNT = 201; // the alarms' request codes
    private static final long LATE_MS = 1000;
    private static final int RATE = 44100;
    // the notes waiting to play, so taking the cues off (the app came back) also stops a 3-2-1 already under way
    private static final Object NOTES = new Object();
    private static final Handler main = new Handler(Looper.getMainLooper());
    // the notes are built (a few thousand samples each) and played on one background thread, not the main one
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
        // as on screen: the 10 seconds is one long note at 1320 Hz (beep(1, 660)), the 3-2-1 short ones at 1318.5 Hz (tick)
        long[] due = warn ? new long[] { endAt - 10_000 } : new long[] { endAt - 3000, endAt - 2000, endAt - 1000 };
        float freq = warn ? 1320f : 1318.5f;
        long now = System.currentTimeMillis(), last = now;
        for (long d : due) {
            if (d < from - 50 || now - d > LATE_MS) continue; // played on screen before the app went away, or long gone
            long wait = Math.max(0, d - now);
            audio.postAtTime(() -> play(sound, freq, warn, volume), NOTES, SystemClock.uptimeMillis() + wait);
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
        }, last - now + 800);
    }

    // [frequency ratio, loudness, how long it rings as a share of the note], as in workout/runtime.ts
    private static final double[][] CUE = { { 1, 1, 1 }, { 2, 0.5, 1 }, { 3, 0.3, 1 }, { 4, 0.15, 1 } };
    private static final double[][] BELL = { { 1, 1, 1 }, { 2, 0.32, 0.6 }, { 2.76, 0.16, 0.4 }, { 5.4, 0.05, 0.2 } };
    private static final double[][] SOFT = { { 1, 1, 1 }, { 2, 0.18, 0.5 } };
    private static final double[][] PURE = { { 1, 1, 1 } };
    private static final double[][] WOOD = { { 1, 1, 1 }, { 4, 0.22, 0.12 }, { 10, 0.04, 0.05 } };
    private static final double LOUDER = 2.2;

    /** One note of a cue in the chosen sound (CUE_NOTE in workout/runtime.ts); `lng`: a "now" note, held a little longer. */
    private static void play(String sound, double f, boolean lng, int volume) {
        double level = Math.pow(Math.max(10, Math.min(100, volume)) / 100.0, 2);
        if ("bell".equals(sound)) note(f, lng ? 0.7 : 0.45, 0.4, BELL, 0.005, 0, level);
        else if ("soft".equals(sound)) note(f, lng ? 0.2 : 0.14, 0.4, SOFT, 0.02, lng ? 0.16 : 0.1, level);
        else if ("digital".equals(sound)) note(f, 0.03, 0.45, PURE, 0.003, lng ? 0.12 : 0.07, level);
        else if ("wood".equals(sound)) note(f / 2, lng ? 0.35 : 0.22, 0.45, WOOD, 0.002, 0, level);
        else note(f, lng ? 0.12 : 0.08, 0.23, CUE, 0.005, lng ? 0.2 : 0.14, level);
    }

    /** The web app's tone(): each partial rises exponentially to its peak in `attack`, stays there `hold`, then falls
     *  exponentially to near silence; peaks above the web app's limiter are scaled down to it. */
    private static void note(double freq, double dur, double vol, double[][] partials, double attack, double hold, double level) {
        double len = 0;
        for (double[] p : partials) len = Math.max(len, hold + Math.max(attack + 0.05, dur * p[2]));
        int n = (int) ((len + 0.02) * RATE);
        double[] sum = new double[n];
        for (double[] p : partials) {
            double f = freq * p[0];
            if (f > 16000) continue;
            double peak = Math.max(0.0002, vol * p[1] * LOUDER * level), fall = attack + hold, end = hold + Math.max(attack + 0.05, dur * p[2]);
            for (int i = 0; i < n; i++) {
                double t = (double) i / RATE, g;
                if (t >= end) break;
                if (t < attack) g = 0.0001 * Math.pow(peak / 0.0001, t / attack);
                else if (t < fall) g = peak;
                else g = peak * Math.pow(0.0001 / peak, (t - fall) / (end - fall));
                sum[i] += g * Math.sin(2 * Math.PI * f * t);
            }
        }
        double max = 0;
        for (double v : sum) max = Math.max(max, Math.abs(v));
        double scale = max > 0.89 ? 0.89 / max : 1; // the limiter's ceiling (-1 dB)
        short[] pcm = new short[n];
        for (int i = 0; i < n; i++) pcm[i] = (short) Math.round(sum[i] * scale * Short.MAX_VALUE);
        AudioTrack track = null;
        try {
            // the media stream and its volume, like the WebView's sound on screen
            AudioAttributes attrs = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
            AudioFormat fmt = new AudioFormat.Builder().setSampleRate(RATE).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build();
            track = new AudioTrack(attrs, fmt, n * 2, AudioTrack.MODE_STATIC, AudioManager.AUDIO_SESSION_ID_GENERATE);
            track.write(pcm, 0, n);
            track.play();
            final AudioTrack t = track;
            track = null; // released later, once it has rung out
            main.postDelayed(t::release, (long) (len * 1000) + 300);
        } catch (RuntimeException e) { /* no sound */ }
        finally { if (track != null) track.release(); }
    }
}
