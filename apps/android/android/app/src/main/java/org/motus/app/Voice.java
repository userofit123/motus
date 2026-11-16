package org.motus.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import java.util.Locale;

/**
 * Voice cues ("Rest over. Bench Press, set 3, 8 reps at 80 kilos", "10 seconds") through the phone's own speech engine:
 * Android's WebView has no speechSynthesis, so the web app speaks through here on screen (MotusWorkoutPlugin.speak) and
 * RestCues speaks the scheduled ones with the screen off. One engine, kept once started (starting takes up to a second,
 * so a rest with voice on warms it first); a cue asked for while it is still starting is spoken once it has. Spoken as
 * navigation guidance (the media stream on phones, at the cue level), holding a "may duck" audio focus for each cue so
 * music plays on quieter under it rather than over it. All on the main thread.
 */
final class Voice {
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static final AudioAttributes ATTRS = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
    // a failed start waits this long before the next try, doubled each time up to MAX_WAIT_MS, so a phone without a
    // working engine isn't bound to it again on every cue
    private static final long FIRST_WAIT_MS = 2_000, MAX_WAIT_MS = 5 * 60_000;
    private static Context app;
    private static TextToSpeech tts;
    private static boolean ready;
    private static int failures;
    private static long retryAt;
    // the one cue waiting for the engine to start (a newer one replaces it: only the latest is still worth saying)
    private static String pendingText;
    private static float pendingLevel;
    // the cue being said: its id, and whether the engine has begun saying it (back on screen it is then left to finish)
    private static int utterances;
    private static String current;
    private static boolean started;
    private static AudioFocusRequest focus;
    private static final AudioManager.OnAudioFocusChangeListener IGNORE = change -> {};

    private Voice() {}

    /** Starts the engine ahead of a cue, so the cue isn't held up by it. */
    static void warm(Context ctx) {
        Context a = ctx.getApplicationContext();
        main.post(() -> { app = a; engine(); });
    }

    /** Says `text` at `level` (0-1), in place of anything still being said. */
    static void say(Context ctx, String text, float level) {
        if (text == null || text.isEmpty()) return;
        Context a = ctx.getApplicationContext();
        main.post(() -> {
            app = a;
            if (engine() == null) return;
            if (ready) speak(text, level, false);
            else { pendingText = text; pendingLevel = level; }
        });
    }

    /** The app came back to the screen (it speaks its own cues from there): a cue not yet begun is dropped, one already
     *  being said is left to finish, so a rest that ends as the phone is unlocked is still heard once, whole. */
    static void stop() {
        main.post(() -> {
            pendingText = null;
            if (tts != null && ready && current != null && !started) { tts.stop(); release(); }
        });
    }

    private static TextToSpeech engine() {
        if (tts != null) return tts;
        if (app == null || SystemClock.uptimeMillis() < retryAt) return null;
        final TextToSpeech[] made = new TextToSpeech[1];
        try {
            made[0] = new TextToSpeech(app, status -> main.post(() -> {
                if (made[0] != tts) return; // given up meanwhile (drop shut it down)
                if (status != TextToSpeech.SUCCESS) { failed(); return; }
                failures = 0;
                ready = true;
                // the cues are English, as the app is: the phone's own English, else British, American, any English
                Locale own = Locale.getDefault();
                for (Locale l : new Locale[] { own.getLanguage().equals("en") ? own : null, Locale.UK, Locale.US, Locale.ENGLISH }) {
                    if (l != null && tts.isLanguageAvailable(l) >= TextToSpeech.LANG_AVAILABLE) { tts.setLanguage(l); break; }
                }
                tts.setSpeechRate(1.05f);
                tts.setAudioAttributes(ATTRS);
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) { main.post(() -> { if (id.equals(current)) started = true; }); }
                    @Override public void onDone(String id) { main.post(() -> ended(id)); }
                    @Override @SuppressWarnings("deprecation") public void onError(String id) { main.post(() -> ended(id)); }
                    @Override public void onError(String id, int code) { main.post(() -> ended(id)); }
                    @Override public void onStop(String id, boolean interrupted) { main.post(() -> ended(id)); }
                });
                if (pendingText != null) { String t = pendingText; pendingText = null; speak(t, pendingLevel, true); }
            }));
            tts = made[0];
        } catch (RuntimeException e) {
            tts = made[0]; // shut down by failed() if it got as far as binding
            failed();
        }
        return tts;
    }

    /** The engine didn't start or stopped working: let it go (unbinding it) and wait longer before the next try. */
    private static void failed() {
        drop();
        failures++;
        retryAt = SystemClock.uptimeMillis() + Math.min(MAX_WAIT_MS, FIRST_WAIT_MS << Math.min(failures - 1, 16));
    }

    private static void drop() {
        if (tts != null) { try { tts.shutdown(); } catch (RuntimeException ignored) { /* already gone */ } }
        tts = null;
        ready = false;
        release();
    }

    /** `again`: the engine was just made anew for this cue, so a second failure isn't tried a third time. */
    private static void speak(String text, float level, boolean again) {
        Bundle p = new Bundle();
        p.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, Math.max(0f, Math.min(1f, level)));
        String id = "motus-cue-" + (++utterances);
        current = id;
        started = false;
        hold();
        if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, p, id) == TextToSpeech.SUCCESS) return;
        // the engine died under us (updated or killed by Android): a fresh one says it, once
        if (again) { failed(); return; }
        drop();
        pendingText = text; pendingLevel = level;
        engine();
    }

    private static void ended(String id) {
        if (id.equals(current)) release();
    }

    private static void hold() {
        AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focus == null) focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(ATTRS).setOnAudioFocusChangeListener(IGNORE).build();
            am.requestAudioFocus(focus);
        } else requestLegacy(am);
    }

    private static void release() {
        current = null;
        started = false;
        if (app == null) return;
        AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) { if (focus != null) am.abandonAudioFocusRequest(focus); }
        else abandonLegacy(am);
    }

    @SuppressWarnings("deprecation")
    private static void requestLegacy(AudioManager am) {
        am.requestAudioFocus(IGNORE, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
    }

    @SuppressWarnings("deprecation")
    private static void abandonLegacy(AudioManager am) {
        am.abandonAudioFocus(IGNORE);
    }
}
