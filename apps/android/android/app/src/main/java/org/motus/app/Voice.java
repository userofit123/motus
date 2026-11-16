package org.motus.app;

import android.content.Context;
import android.content.Intent;
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
 * music plays on quieter under it rather than over it. All on the main thread. A cue asked for on screen hears back
 * whether it was said (Heard), so the app can say why when it wasn't, instead of staying silent.
 */
final class Voice {
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static final AudioAttributes ATTRS = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
    // a failed start waits this long before the next try, doubled each time up to MAX_WAIT_MS, so a phone without a
    // working engine isn't bound to it again on every cue
    private static final long FIRST_WAIT_MS = 2_000, MAX_WAIT_MS = 5 * 60_000;
    // an engine not started within START_MS, or a cue not begun within BEGIN_MS or not finished within SAY_MAX_MS, is
    // stuck (bound but never answering): it is let go so the next cue gets a fresh one rather than waiting on it for
    // good. Timed by elapsedRealtime, which runs on while the phone sleeps, and also checked as each cue comes in, so a
    // cue with the screen locked (RestCues) never waits on an engine that got stuck at an earlier one.
    private static final long START_MS = 6_000, BEGIN_MS = 5_000, SAY_MAX_MS = 15_000;
    private static Context app;
    private static TextToSpeech tts;
    private static boolean ready;
    private static int failures;
    private static long retryAt, madeAt, spokeAt;
    // the engine has an English voice (pickLanguage): without one a cue isn't said in another language's voice
    private static boolean english;
    // why there is no engine to use: "none" (no speech engine on the phone) or "engine" (it failed to start)
    private static String down = "engine";
    // the one cue waiting for the engine to start (a newer one replaces it: only the latest is still worth saying)
    private static String pendingText;
    private static float pendingLevel;
    // the cue being said: its id, and whether the engine has begun saying it (back on screen it is then left to finish)
    private static int utterances;
    private static String current;
    private static boolean started;
    private static AudioFocusRequest focus;
    // a call coming in (or another app taking the sound for a while, or for good): the cue stops rather than talking over
    // it, and is answered "busy", as it wasn't heard whole; a short duck (a notification sound) lets it carry on
    private static final AudioManager.OnAudioFocusChangeListener ON_FOCUS = change -> {
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT)
            main.post(() -> { pendingText = null; answer(true, "busy"); if (tts != null && ready && current != null) { tts.stop(); answer(false, "busy"); release(); } });
    };

    private Voice() {}

    /** What became of a cue, once it was said to its end: `problem` null when it was (or a newer cue took its place),
     *  else why not: "none" (no speech engine on the phone), "engine" (there is one, but it won't start or work),
     *  "timeout" (it didn't answer), "language" (it has no English voice), "voice" (its voice isn't downloaded yet),
     *  "network" (the voice needs the internet), "busy" (the sound was taken, as by a call), "error" (anything else).
     *  Answered once. */
    interface Heard { void done(String problem); }
    private static final Heard NOBODY = problem -> {};
    // who hears back about the cue waiting for the engine, and about the one being said
    private static Heard pendingHeard = NOBODY, currentHeard = NOBODY;
    private static void answer(boolean pending, String problem) {
        Heard h = pending ? pendingHeard : currentHeard;
        if (pending) pendingHeard = NOBODY; else currentHeard = NOBODY;
        h.done(problem);
    }

    /** Starts the engine ahead of a cue, so the cue isn't held up by it. */
    static void warm(Context ctx) {
        Context a = ctx.getApplicationContext();
        main.post(() -> { app = a; unstick(); engine(); });
    }

    /** Says `text` at `level` (0-1), in place of anything still being said. */
    static void say(Context ctx, String text, float level) { say(ctx, text, level, false, NOBODY); }

    /** The same, telling `heard` what became of it. `retry`: try the engine now even if it failed a moment ago (a cue
     *  asked for by hand, such as turning Voice cues on, so the answer is about now). */
    static void say(Context ctx, String text, float level, boolean retry, Heard heard) {
        if (text == null || text.isEmpty()) { heard.done(null); return; }
        Context a = ctx.getApplicationContext();
        main.post(() -> {
            app = a;
            unstick();
            if (retry && tts == null) retryAt = 0;
            if (engine() == null) { heard.done(down); return; }
            if (ready) { answer(false, null); currentHeard = heard; speak(text, level, false); }
            else { answer(true, null); pendingText = text; pendingLevel = level; pendingHeard = heard; }
        });
    }

    /** The app came back to the screen (it speaks its own cues from there): a cue not yet begun is dropped, one already
     *  being said is left to finish, so a rest that ends as the phone is unlocked is still heard once, whole. */
    static void stop() {
        main.post(() -> {
            pendingText = null;
            answer(true, null);
            if (tts != null && ready && current != null && !started) { tts.stop(); answer(false, null); release(); }
        });
    }

    private static TextToSpeech engine() {
        if (tts != null) return tts;
        if (app == null) { down = "engine"; return null; }
        if (!installed()) { down = "none"; return null; }
        if (SystemClock.uptimeMillis() < retryAt) { down = "engine"; return null; }
        final TextToSpeech[] made = new TextToSpeech[1];
        try {
            made[0] = new TextToSpeech(app, status -> main.post(() -> {
                if (made[0] != tts) return; // given up meanwhile (drop shut it down)
                if (status != TextToSpeech.SUCCESS) { failed(); return; }
                ready = true;
                english = pickLanguage();
                tts.setSpeechRate(1.05f);
                tts.setAudioAttributes(ATTRS);
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    // begun: back on screen it is left to finish (stop); answered only at its end, so a cue cut off
                    // part way (a call) is told as not heard
                    @Override public void onStart(String id) { main.post(() -> { if (id.equals(current)) started = true; }); }
                    // a cue said to its end: the engine works, so the wait after failures starts over (not when it
                    // merely started: one that starts and then can't speak would otherwise retry at once every time)
                    @Override public void onDone(String id) { main.post(() -> { failures = 0; ended(id); }); }
                    @Override @SuppressWarnings("deprecation") public void onError(String id) { main.post(() -> { if (id.equals(current)) answer(false, "error"); ended(id); }); }
                    @Override public void onError(String id, int code) { main.post(() -> { if (id.equals(current)) answer(false, problemOf(code)); ended(id); }); }
                    @Override public void onStop(String id, boolean interrupted) { main.post(() -> ended(id)); }
                });
                if (pendingText != null) { String t = pendingText; pendingText = null; currentHeard = pendingHeard; pendingHeard = NOBODY; speak(t, pendingLevel, true); }
            }));
            tts = made[0];
            madeAt = SystemClock.elapsedRealtime();
            english = false;
            main.postDelayed(Voice::unstick, START_MS + 50);
        } catch (RuntimeException e) {
            tts = made[0]; // shut down by failed() if it got as far as binding
            failed();
        }
        return tts;
    }

    /** A speech engine is on the phone at all (the manifest's TTS_SERVICE query lets the app see one). */
    @SuppressWarnings("deprecation")
    private static boolean installed() {
        try { return !app.getPackageManager().queryIntentServices(new Intent(TextToSpeech.Engine.INTENT_ACTION_TTS_SERVICE), 0).isEmpty(); }
        catch (RuntimeException e) { return true; } // can't tell: the engine's own start says
    }

    /** The cues are English, as the app is: the phone's own English, else British, American, any English. False when the
     *  engine has none of them, or has them without their voice (LANG_MISSING_DATA). */
    private static boolean pickLanguage() {
        Locale own = Locale.getDefault();
        for (Locale l : new Locale[] { own.getLanguage().equals("en") ? own : null, Locale.UK, Locale.US, Locale.ENGLISH }) {
            if (l == null) continue;
            try { if (tts.setLanguage(l) >= TextToSpeech.LANG_AVAILABLE) return true; }
            catch (RuntimeException ignored) { /* the engine went away: speaking finds that out */ }
        }
        return false;
    }

    /** The engine didn't start or stopped working: let it go (unbinding it) and wait longer before the next try. */
    private static void failed() {
        pendingText = null;
        answer(true, "engine");
        answer(false, "engine");
        drop();
        down = "engine";
        failures++;
        retryAt = SystemClock.uptimeMillis() + Math.min(MAX_WAIT_MS, FIRST_WAIT_MS << Math.min(failures - 1, 16));
    }

    /** Lets go of a stuck engine (START_MS, BEGIN_MS, SAY_MAX_MS): whoever waits on it hears "timeout", and the next cue
     *  starts a fresh one at once (it is let go only after the wait, so it isn't bound anew on every cue either). */
    private static void unstick() {
        if (tts == null) return;
        long now = SystemClock.elapsedRealtime();
        boolean stuck = !ready ? now - madeAt > START_MS : current != null && now - spokeAt > (started ? SAY_MAX_MS : BEGIN_MS);
        if (!stuck) return;
        pendingText = null;
        answer(true, "timeout");
        answer(false, "timeout");
        drop();
    }

    private static void drop() {
        if (tts != null) { try { tts.shutdown(); } catch (RuntimeException ignored) { /* already gone */ } }
        tts = null;
        ready = false;
        release();
    }

    /** `again`: the engine was just made anew for this cue, so a second failure isn't tried a third time. */
    private static void speak(String text, float level, boolean again) {
        // no English voice: said in no voice rather than read out by another language's; looked for again at each cue,
        // so one downloaded meanwhile is used
        if (!english) english = pickLanguage();
        if (!english) { answer(false, "language"); return; }
        Bundle p = new Bundle();
        p.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, Math.max(0f, Math.min(1f, level)));
        String id = "motus-cue-" + (++utterances);
        current = id;
        started = false;
        // refused (a phone call going on): not said, rather than over the call
        if (!hold()) { release(); answer(false, "busy"); return; }
        spokeAt = SystemClock.elapsedRealtime();
        if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, p, id) == TextToSpeech.SUCCESS) {
            main.postDelayed(Voice::unstick, BEGIN_MS + 50);
            main.postDelayed(Voice::unstick, SAY_MAX_MS + 50);
            return;
        }
        // the engine died under us (updated or killed by Android): a fresh one says it, once
        if (again) { failed(); return; }
        Heard h = currentHeard;
        currentHeard = NOBODY;
        drop();
        pendingText = text; pendingLevel = level; pendingHeard = h;
        if (engine() == null) { pendingText = null; answer(true, down); }
    }

    private static void ended(String id) {
        if (!id.equals(current)) return;
        answer(false, null); // said, or stopped before it began (a newer cue took over): not a fault
        release();
    }

    private static String problemOf(int code) {
        // also "no voice installed for this language" on some engines: the app's message covers both
        if (code == TextToSpeech.ERROR_NOT_INSTALLED_YET) return "voice";
        if (code == TextToSpeech.ERROR_NETWORK || code == TextToSpeech.ERROR_NETWORK_TIMEOUT) return "network";
        if (code == TextToSpeech.ERROR_OUTPUT) return "busy";
        if (code == TextToSpeech.ERROR_SERVICE || code == TextToSpeech.ERROR_SYNTHESIS) return "engine";
        return "error";
    }

    /** Asks for the sound (music ducks under the cue); false only when refused outright, as during a call. */
    private static boolean hold() {
        AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focus == null) focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(ATTRS).setOnAudioFocusChangeListener(ON_FOCUS).build();
            return am.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_FAILED;
        }
        return requestLegacy(am);
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
    private static boolean requestLegacy(AudioManager am) {
        return am.requestAudioFocus(ON_FOCUS, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK) != AudioManager.AUDIOFOCUS_REQUEST_FAILED;
    }

    @SuppressWarnings("deprecation")
    private static void abandonLegacy(AudioManager am) {
        am.abandonAudioFocus(ON_FOCUS);
    }
}
