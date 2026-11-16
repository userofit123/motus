package org.motus.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;

/**
 * Voice cues ("Rest over. Bench Press, set 3, 8 reps at 80 kilos", "10 seconds") through the phone's own speech engine:
 * Android's WebView has no speechSynthesis, so the web app speaks through here on screen (MotusWorkoutPlugin.speak) and
 * RestCues speaks the scheduled ones with the screen off. One engine, kept once started (starting takes up to a second,
 * so a rest with voice on warms it first); a cue asked for while it is still starting is spoken once it has. Spoken as
 * navigation guidance (the media stream on phones, at the cue level), holding a "may duck" audio focus for each cue so
 * music plays on quieter under it rather than over it. All on the main thread. A cue asked for on screen hears back
 * whether it was said (Heard), so the app can say why when it wasn't, instead of staying silent.
 *
 * An engine that won't start or speak isn't given up on at once: the next installed engine is tried (the one chosen in
 * Settings first, then the phone's default, Google's, any other), and a cue an engine can't synthesise is tried once more
 * with plain settings (no volume, the plain media stream, a downloaded voice), as some makers' engines refuse those.
 * Only when every engine failed is the cue answered "engine". Each failure is logged under MotusVoice, so a phone where
 * it still fails can send a logcat.
 */
final class Voice {
    private static final String TAG = "MotusVoice";
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static final AudioAttributes ATTRS = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
    // what an engine that refuses the above gets: the media stream, which is where TextToSpeech speaks by default
    private static final AudioAttributes PLAIN = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
    // after every engine failed, the next try waits this long, doubled each time up to MAX_WAIT_MS, so a phone without a
    // working engine isn't bound to it again on every cue; short, as one bad moment (an engine being updated) shouldn't
    // silence a whole workout. Timed by elapsedRealtime, as the watchdog below, so the wait also runs out while the
    // phone sleeps. Coming back to the app (resumed) and a cue asked for by hand (retry) skip it.
    private static final long FIRST_WAIT_MS = 2_000, MAX_WAIT_MS = 60_000;
    // an engine not started within START_MS (FIRST_START_MS for the first one since the app started: a cold Google
    // engine on a slow phone can take several seconds), or a cue not begun within BEGIN_MS or not finished within
    // SAY_MAX_MS, is stuck (bound but never answering): it is let go so the next cue gets a fresh one rather than
    // waiting on it for good. Timed by elapsedRealtime, which runs on while the phone sleeps, and also checked as each
    // cue comes in, so a cue with the screen locked (RestCues) never waits on an engine that got stuck at an earlier one.
    private static final long FIRST_START_MS = 15_000, START_MS = 8_000, BEGIN_MS = 5_000, SAY_MAX_MS = 15_000;
    // a cue still waiting after this long while engines are tried one after another is answered "engine", so the app
    // says it in its own voice (and under MotusWorkoutPlugin's SPEAK_ANSWER_MS, which would answer "timeout")
    private static final long PENDING_MAX_MS = 20_000;
    // the choice made in Settings on this phone (setChoice): the engine's package and the voice's name, null for the
    // phone's default; a voice name only means something in the engine that listed it (VOICE_ENGINE)
    private static final String PREFS = "motus_voice", ENGINE = "engine", VOICE = "voice", VOICE_ENGINE = "voiceEngine";
    private static Context app;
    private static TextToSpeech tts;
    private static boolean ready, everReady;
    private static int failures;
    private static long retryAt, madeAt, spokeAt;
    // the engines to try, in order (null: the phone's default), and which of them the current one is; null between rounds
    private static String[] order;
    private static int tried;
    // the current engine's package (null: the phone's default), and whether it is spoken to with plain settings
    private static String using;
    // the phone's default engine when the current one was bound as "the phone's default" (using null)
    private static String boundDefault;
    private static boolean plain;
    // a new choice came while a cue was being said: the engine is let go once it ends
    private static boolean rebuild;
    // the engine has an English voice (pickLanguage): without one a cue isn't said in another language's voice
    private static boolean english;
    // the engine's own voice for the English picked (before the chosen one is applied), so Settings names voices against it
    private static String defaultVoice;
    // why there is no engine to use: "none" (no speech engine on the phone) or "engine" (it failed to start)
    private static String down = "engine";
    // what became of the latest cue (null: said, or not yet asked) and when one was last said to its end, for Settings
    private static String lastProblem;
    private static long saidAt;
    // the one cue waiting for the engine to start (a newer one replaces it: only the latest is still worth saying)
    private static String pendingText;
    private static float pendingLevel;
    private static long pendingAt;
    // the cue being said: its id, words and level, whether the engine has begun saying it (back on screen it is then
    // left to finish), and whether it was tried with plain settings
    private static int utterances;
    private static String current, currentText;
    private static float currentLevel;
    private static boolean started, currentPlain;
    private static AudioFocusRequest focus;
    // a call coming in (or another app taking the sound for a while, or for good): the cue stops rather than talking over
    // it, and is answered "busy", as it wasn't heard whole; a short duck (a notification sound) lets it carry on
    private static final AudioManager.OnAudioFocusChangeListener ON_FOCUS = change -> {
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT)
            main.post(() -> { pendingText = null; answer(true, "busy"); if (tts != null && ready && current != null) { tts.stop(); answer(false, "busy"); release(); } });
    };

    private Voice() {}

    /** What became of a cue, once it was said to its end: `problem` null when it was (or a newer cue took its place),
     *  else why not: "none" (no speech engine on the phone), "engine" (there is one, but none of them would start or
     *  work), "timeout" (it didn't answer), "language" (it has no English voice), "voice" (its voice isn't downloaded
     *  yet), "network" (the voice needs the internet), "busy" (the sound was taken, as by a call), "output" (the phone's
     *  sound output failed), "error" (anything else).
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

    /** The same, telling `heard` what became of it. `retry`: try the engines now even if they failed a moment ago (a
     *  cue asked for by hand, such as turning Voice cues on, so the answer is about now). */
    static void say(Context ctx, String text, float level, boolean retry, Heard heard) {
        if (text == null || text.isEmpty()) { heard.done(null); return; }
        Context a = ctx.getApplicationContext();
        // the latest answer is kept for Settings (info), whoever asked
        Heard noted = problem -> { lastProblem = problem; heard.done(problem); };
        main.post(() -> {
            app = a;
            endPreview(null);
            unstick();
            // a new choice came while a cue was being said: this newer cue takes over, said by the chosen engine
            if (rebuild && tts != null) { if (current != null) { try { tts.stop(); } catch (RuntimeException ignored) { /* gone */ } answer(false, null); } drop(); }
            if (retry && tts == null) { retryAt = 0; order = null; }
            if (engine() == null) { noted.done(down); return; }
            if (ready) { answer(false, null); currentHeard = noted; speak(text, level, false); }
            else { answer(true, null); pendingText = text; pendingLevel = level; pendingHeard = noted; pendingAt = SystemClock.elapsedRealtime(); }
        });
    }

    // the one preview being said (Settings' play buttons), who hears back about it, and its own audio focus (never the
    // cues' shared one, so ending a preview can't take the sound from a cue)
    private static TextToSpeech previewTts;
    private static Heard previewHeard = NOBODY;
    private static AudioFocusRequest previewFocus;
    private static final AudioManager.OnAudioFocusChangeListener ON_PREVIEW_FOCUS = change -> {
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) main.post(() -> endPreview("busy"));
    };

    /** Says `text` once in an engine and voice picked in Settings to hear them (null: the phone's default, the
     *  language's default), without making them the choice: an engine of its own, let go after, so the one the cues use
     *  stays as it is. A newer preview, a cue or stop() ends it; it ends the cue being said. `heard` as for say. */
    static void preview(Context ctx, String text, float level, String engine, String voice, Heard heard) {
        Context a = ctx.getApplicationContext();
        main.post(() -> {
            app = a;
            endPreview(null);
            // the cue being said gives way to what was asked for by hand
            if (tts != null && ready && current != null) { try { tts.stop(); } catch (RuntimeException ignored) { /* gone */ } answer(false, null); release(); }
            pendingText = null;
            answer(true, null);
            previewHeard = heard;
            final TextToSpeech[] t = new TextToSpeech[1];
            final boolean[] plainTried = { false };
            Runnable say = () -> {
                if (t[0] != previewTts) return;
                if (!holdPreview()) { endPreview("busy"); return; }
                Bundle p = new Bundle();
                if (!plainTried[0]) p.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, Math.max(0f, Math.min(1f, level)));
                int r;
                try { t[0].setAudioAttributes(plainTried[0] ? PLAIN : ATTRS); r = t[0].speak(text, TextToSpeech.QUEUE_FLUSH, p, "motus-preview"); }
                catch (RuntimeException e) { r = TextToSpeech.ERROR; }
                if (r != TextToSpeech.SUCCESS) endPreview("engine");
            };
            TextToSpeech.OnInitListener started = status -> main.post(() -> {
                if (t[0] != previewTts) return; // ended meanwhile
                if (status != TextToSpeech.SUCCESS) { endPreview("engine"); return; }
                TextToSpeech x = t[0];
                boolean en = false;
                try {
                    Set<android.speech.tts.Voice> vs = voice == null ? null : x.getVoices();
                    if (vs != null) for (android.speech.tts.Voice v : vs) if (v.getName().equals(voice)) { en = x.setVoice(v) == TextToSpeech.SUCCESS; break; }
                    if (!en) for (Locale l : new Locale[] { Locale.UK, Locale.US, Locale.ENGLISH }) if (x.setLanguage(l) >= TextToSpeech.LANG_AVAILABLE) { en = true; break; }
                } catch (RuntimeException e) { endPreview("engine"); return; }
                if (!en) { endPreview("language"); return; }
                x.setSpeechRate(1.05f);
                x.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) {}
                    @Override public void onDone(String id) { main.post(() -> { if (t[0] == previewTts) endPreview(null); }); }
                    @Override @SuppressWarnings("deprecation") public void onError(String id) { main.post(() -> { if (t[0] == previewTts) endPreview("error"); }); }
                    @Override public void onError(String id, int code) {
                        // as for the cues: one it couldn't synthesise is tried once more with plain settings
                        main.post(() -> {
                            if (t[0] != previewTts) return;
                            if (code == TextToSpeech.ERROR_SYNTHESIS && !plainTried[0]) { plainTried[0] = true; say.run(); }
                            else endPreview(problemOf(code));
                        });
                    }
                });
                say.run();
            });
            try { t[0] = engine == null ? new TextToSpeech(app, started) : new TextToSpeech(app, started, engine); }
            catch (RuntimeException e) { Log.w(TAG, "preview couldn't start " + engine + ": " + e); previewHeard = NOBODY; heard.done("engine"); return; }
            previewTts = t[0];
            main.postDelayed(() -> { if (t[0] == previewTts) endPreview("timeout"); }, FIRST_START_MS + SAY_MAX_MS);
        });
    }

    /** Ends the preview being said (if any): its engine is let go, its sound given back, and it is answered `problem`. */
    private static void endPreview(String problem) {
        TextToSpeech t = previewTts;
        Heard h = previewHeard;
        previewTts = null;
        previewHeard = NOBODY;
        if (t == null) return;
        try { t.stop(); t.shutdown(); } catch (RuntimeException ignored) { /* already gone */ }
        releasePreview();
        if (problem != null) Log.w(TAG, "preview: " + problem);
        h.done(problem);
    }

    private static boolean holdPreview() {
        AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (previewFocus == null) previewFocus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(ATTRS).setOnAudioFocusChangeListener(ON_PREVIEW_FOCUS).build();
            return am.requestAudioFocus(previewFocus) != AudioManager.AUDIOFOCUS_REQUEST_FAILED;
        }
        return requestLegacyPreview(am);
    }

    private static void releasePreview() {
        if (app == null) return;
        AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) { if (previewFocus != null) am.abandonAudioFocusRequest(previewFocus); }
        else abandonLegacyPreview(am);
    }

    @SuppressWarnings("deprecation")
    private static boolean requestLegacyPreview(AudioManager am) {
        return am.requestAudioFocus(ON_PREVIEW_FOCUS, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK) != AudioManager.AUDIOFOCUS_REQUEST_FAILED;
    }

    @SuppressWarnings("deprecation")
    private static void abandonLegacyPreview(AudioManager am) {
        am.abandonAudioFocus(ON_PREVIEW_FOCUS);
    }

    /** The app came back to the screen (it speaks its own cues from there): a cue not yet begun is dropped, one already
     *  being said is left to finish, so a rest that ends as the phone is unlocked is still heard once, whole. */
    static void stop() {
        main.post(() -> {
            endPreview(null);
            pendingText = null;
            answer(true, null);
            if (tts != null && ready && current != null && !started) { tts.stop(); answer(false, null); release(); }
        });
    }

    /** The app is in front again: the wait after failures starts over, so the next cue tries the engines at once (the
     *  person may just have fixed the phone's speech settings). */
    static void resumed() {
        main.post(() -> {
            failures = 0; retryAt = 0;
            // a fallback engine at rest: let go, so the next cue tries the chosen one (or the phone's default) first again
            boolean idle = tts != null && current == null && pendingText == null;
            if (idle && tried > 0) { Log.i(TAG, "back in Motus: trying the first engine again"); drop(); }
            // the phone's default engine was changed in its settings meanwhile: the next cue binds the new one
            else if (idle && using == null && !Objects.equals(boundDefault, defaultSynth())) { Log.i(TAG, "the phone's default engine changed to " + defaultSynth()); drop(); }
            if (tts == null) order = null;
        });
    }

    /** The engine and voice chosen in Settings on this phone (null: the phone's default; `voiceEngine`: the engine whose
     *  voice `voice` is). Kept here as well as in the web app, so the cues with the screen off use them too. The current
     *  engine is let go (after the cue being said, if any), so the next cue starts the chosen one. */
    static void setChoice(Context ctx, String engine, String voice, String voiceEngine) {
        Context a = ctx.getApplicationContext();
        SharedPreferences p = a.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        // the same choice again (the app gives it on every start): the engine in use stays
        if (Objects.equals(p.getString(ENGINE, null), engine) && Objects.equals(p.getString(VOICE, null), voice)
            && Objects.equals(p.getString(VOICE_ENGINE, null), voiceEngine)) return;
        p.edit().putString(ENGINE, engine).putString(VOICE, voice).putString(VOICE_ENGINE, voiceEngine).apply();
        main.post(() -> {
            app = a;
            order = null; failures = 0; retryAt = 0; lastProblem = null;
            if (tts == null) return;
            // still starting: the cue waiting for it (if any) waits on for the chosen engine instead
            if (!ready) { drop(); if (pendingText != null && engine() == null) { pendingText = null; answer(true, down); } }
            else if (current == null) drop();
            else rebuild = true;
        });
    }

    /** What Settings shows about the phone's speech: the installed engines, the default, the choice, the engine in use
     *  and its English voices, and the latest problem. Starts the engine first (at once, even after failures: opening
     *  Settings is asked for by hand) and answers once it has started or failed, or after FIRST_START_MS. */
    static void info(Context ctx, Info reply) {
        Context a = ctx.getApplicationContext();
        main.post(() -> {
            app = a;
            unstick();
            if (tts == null) { retryAt = 0; order = null; }
            engine();
            long until = SystemClock.elapsedRealtime() + FIRST_START_MS + 500;
            Runnable[] check = new Runnable[1];
            check[0] = () -> {
                if (tts != null && !ready && SystemClock.elapsedRealtime() < until) { main.postDelayed(check[0], 250); return; }
                // an English voice downloaded since the engine started (back from the phone's settings): used from now on
                if (tts != null && ready && !english && current == null) { setUpVoice(); if (english) lastProblem = null; }
                reply.done(describe());
            };
            check[0].run();
        });
    }

    /** Who hears back from info (java.util.function needs Android 7). */
    interface Info { void done(JSObject o); }

    private static JSObject describe() {
        JSObject o = new JSObject();
        JSArray engines = new JSArray();
        List<String[]> all = installedEngines();
        if (all != null) for (String[] e : all) { JSObject x = new JSObject(); x.put("name", e[0]); x.put("label", e[1]); engines.put(x); }
        o.put("engines", engines);
        o.put("defaultEngine", defaultSynth());
        SharedPreferences p = prefs();
        o.put("chosenEngine", p.getString(ENGINE, null));
        o.put("chosenVoice", p.getString(VOICE, null));
        o.put("ready", tts != null && ready);
        o.put("starting", tts != null && !ready);
        o.put("said", saidAt > 0);
        // without an engine, why there is none ("timeout" from an earlier cue is older news than that)
        String problem = tts == null ? (lastProblem == null || "timeout".equals(lastProblem) ? down : lastProblem) : lastProblem;
        // a started engine answers for itself: an earlier failure to start or answer is over, as is a missing English
        // voice once it has one
        boolean on = tts != null && ready;
        if (on && ("engine".equals(problem) || "timeout".equals(problem) || "none".equals(problem) || "app".equals(problem))) problem = null;
        // "voice" and "network" stay: the engine has English, but the voice it uses may still not speak
        if (on && english && "language".equals(problem)) problem = null;
        if (problem != null) o.put("problem", problem);
        if (tts != null && ready) {
            o.put("engine", actualEngine());
            o.put("english", english);
            if (defaultVoice != null) o.put("defaultVoice", defaultVoice);
            try {
                android.speech.tts.Voice v = tts.getVoice();
                if (v != null) o.put("voice", v.getName());
                JSArray voices = new JSArray();
                Set<android.speech.tts.Voice> vs = tts.getVoices();
                if (vs != null) for (android.speech.tts.Voice x : vs) {
                    if (x.getLocale() == null || !"en".equals(x.getLocale().getLanguage())) continue;
                    JSObject j = new JSObject();
                    j.put("name", x.getName());
                    j.put("lang", x.getLocale().toLanguageTag());
                    j.put("network", x.isNetworkConnectionRequired());
                    j.put("missing", x.getFeatures() != null && x.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED));
                    voices.put(j);
                }
                o.put("voices", voices);
            } catch (RuntimeException e) { log("couldn't list its voices: " + e); }
        }
        return o;
    }

    private static SharedPreferences prefs() { return app.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    private static TextToSpeech engine() {
        if (tts != null) return tts;
        if (app == null) { down = "engine"; return null; }
        List<String[]> installed = installedEngines();
        if (installed != null && installed.isEmpty()) { down = "none"; log("no speech engine installed"); return null; }
        if (SystemClock.elapsedRealtime() < retryAt) { down = "engine"; return null; }
        if (order == null) {
            order = orderOf(installed);
            tried = 0;
            Log.i(TAG, "engines to try: " + Arrays.toString(order) + " (phone's default " + defaultSynth() + ")");
        }
        return make(order[tried]);
    }

    /** The engines to try: the one chosen in Settings (if still installed), the phone's default (null: as Android picks
     *  it, falling back itself to the best installed one), the default named, Google's, then any other installed one. */
    private static String[] orderOf(List<String[]> installed) {
        List<String> names = new ArrayList<>();
        if (installed != null) for (String[] e : installed) names.add(e[0]);
        List<String> out = new ArrayList<>();
        String chosen = prefs().getString(ENGINE, null);
        if (chosen != null) { if (installed == null || names.contains(chosen)) out.add(chosen); else log("the chosen engine " + chosen + " is no longer installed: the phone's default speaks"); }
        if (!out.contains(null)) out.add(null);
        String def = defaultSynth();
        if (def != null && (installed == null || names.contains(def)) && !out.contains(def)) out.add(def);
        if (names.contains("com.google.android.tts") && !out.contains("com.google.android.tts")) out.add("com.google.android.tts");
        for (String n : names) if (!out.contains(n)) out.add(n);
        return out.toArray(new String[0]);
    }

    private static TextToSpeech make(String pkg) {
        using = pkg;
        boundDefault = pkg == null ? defaultSynth() : null;
        plain = false;
        english = false;
        ready = false;
        final TextToSpeech[] made = new TextToSpeech[1];
        try {
            TextToSpeech.OnInitListener started = status -> main.post(() -> onInit(made[0], status));
            made[0] = pkg == null ? new TextToSpeech(app, started) : new TextToSpeech(app, started, pkg);
            tts = made[0];
            madeAt = SystemClock.elapsedRealtime();
            main.postDelayed(Voice::unstick, startMs() + 50);
        } catch (RuntimeException e) {
            // thrown by the constructor: made[0] is still null, nothing was bound; thrown after it: made[0] is bound and
            // next() shuts it down
            tts = made[0];
            log("couldn't start: " + e);
            next();
        }
        return tts;
    }

    private static long startMs() { return everReady ? START_MS : FIRST_START_MS; }

    private static void onInit(TextToSpeech made, int status) {
        if (made != tts) return; // given up meanwhile (drop shut it down)
        if (status != TextToSpeech.SUCCESS) { log("didn't start, status " + status); next(); return; }
        ready = true;
        everReady = true;
        setUpVoice();
        // after the language: some engines reset the rate when it changes
        tts.setSpeechRate(1.05f);
        tts.setAudioAttributes(ATTRS);
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            // begun: back on screen it is left to finish (stop); answered only at its end, so a cue cut off part way (a
            // call) is told as not heard
            @Override public void onStart(String id) { main.post(() -> { if (id.equals(current)) started = true; }); }
            // a cue said to its end: the engine works, so the wait after failures starts over (not when it merely
            // started: one that starts and then can't speak would otherwise retry at once every time)
            @Override public void onDone(String id) { main.post(() -> { if (id.equals(current)) { failures = 0; saidAt = SystemClock.elapsedRealtime(); } ended(id); }); }
            @Override @SuppressWarnings("deprecation") public void onError(String id) { main.post(() -> spokeFailed(id, TextToSpeech.ERROR)); }
            @Override public void onError(String id, int code) { main.post(() -> spokeFailed(id, code)); }
            @Override public void onStop(String id, boolean interrupted) { main.post(() -> ended(id)); }
        });
        Log.i(TAG, "started " + describeEngine() + ", English voice: " + english);
        if (pendingText != null) { String t = pendingText; pendingText = null; currentHeard = pendingHeard; pendingHeard = NOBODY; speak(t, pendingLevel, true); }
    }

    /** The engines on the phone (package, name as shown), null when that can't be told (the engine's own start says).
     *  The manifest's TTS_SERVICE query lets the app see them on Android 11+. */
    private static List<String[]> installedEngines() {
        try {
            PackageManager pm = app.getPackageManager();
            List<String[]> out = new ArrayList<>();
            for (ResolveInfo r : pm.queryIntentServices(new Intent(TextToSpeech.Engine.INTENT_ACTION_TTS_SERVICE), 0)) {
                if (r.serviceInfo == null) continue;
                String n = r.serviceInfo.packageName;
                boolean dup = false;
                for (String[] e : out) if (e[0].equals(n)) dup = true;
                if (!dup) out.add(new String[] { n, String.valueOf(r.loadLabel(pm)) });
            }
            return out;
        } catch (RuntimeException e) { return null; }
    }

    /** The engine chosen in the phone's Text-to-speech settings, null when none was. */
    private static String defaultSynth() {
        if (app == null) return null;
        try { return Settings.Secure.getString(app.getContentResolver(), Settings.Secure.TTS_DEFAULT_SYNTH); }
        catch (RuntimeException e) { return null; }
    }

    /** The package of the engine in use: the one asked for, else the phone's default. */
    private static String actualEngine() {
        if (using != null) return using;
        if (boundDefault != null) return boundDefault;
        try { return tts != null ? tts.getDefaultEngine() : null; } catch (RuntimeException e) { return null; }
    }

    /** The cues are English, as the app is: the phone's own English, else British, American, any English. False when the
     *  engine has none of them, or has them without their voice (LANG_MISSING_DATA). */
    private static boolean pickLanguage() {
        Locale own = Locale.getDefault();
        StringBuilder results = new StringBuilder();
        for (Locale l : new Locale[] { own.getLanguage().equals("en") ? own : null, Locale.UK, Locale.US, Locale.ENGLISH }) {
            if (l == null) continue;
            try {
                int r = tts.setLanguage(l);
                if (r >= TextToSpeech.LANG_AVAILABLE) return true;
                results.append(' ').append(l).append('=').append(r);
            } catch (RuntimeException e) { results.append(' ').append(l).append('=').append(e); }
        }
        log("no English voice:" + results);
        return false;
    }

    /** The English to speak in (pickLanguage), the engine's own voice for it noted (defaultVoice), then the voice chosen
     *  in Settings over it (applyVoice). */
    private static void setUpVoice() {
        english = pickLanguage();
        defaultVoice = null;
        if (!english) return;
        try { android.speech.tts.Voice v = tts.getVoice(); if (v != null) defaultVoice = v.getName(); } catch (RuntimeException ignored) { /* gone */ }
        applyVoice();
    }

    /** The voice chosen in Settings, when it belongs to this engine and is still there; else the language's default. */
    private static void applyVoice() {
        SharedPreferences p = prefs();
        String want = p.getString(VOICE, null);
        if (want == null || !Objects.equals(p.getString(VOICE_ENGINE, null), actualEngine())) return;
        try {
            Set<android.speech.tts.Voice> vs = tts.getVoices();
            if (vs != null) for (android.speech.tts.Voice v : vs) {
                if (!v.getName().equals(want)) continue;
                int r = tts.setVoice(v);
                if (r == TextToSpeech.SUCCESS) { english = true; return; }
                log("couldn't use the chosen voice " + want + ", result " + r);
                return;
            }
            log("the chosen voice " + want + " is gone: its language's default speaks");
        } catch (RuntimeException e) { log("couldn't set the chosen voice: " + e); }
    }

    /** For the plain retry: a voice that needs the internet or isn't downloaded is swapped for a downloaded English one
     *  of the same language, if the engine has one. */
    private static void preferDownloadedVoice() {
        try {
            android.speech.tts.Voice v = tts.getVoice();
            if (v != null && !needsMore(v)) return;
            Set<android.speech.tts.Voice> vs = tts.getVoices();
            if (vs == null) return;
            android.speech.tts.Voice best = null;
            for (android.speech.tts.Voice x : vs) {
                if (x.getLocale() == null || !"en".equals(x.getLocale().getLanguage()) || needsMore(x)) continue;
                if (best == null || (v != null && x.getLocale().equals(v.getLocale()))) best = x;
            }
            if (best != null) { tts.setVoice(best); Log.i(TAG, "switched to the downloaded voice " + best.getName()); }
        } catch (RuntimeException ignored) { /* the engine went away: speaking finds that out */ }
    }

    private static boolean needsMore(android.speech.tts.Voice v) {
        return v.isNetworkConnectionRequired() || (v.getFeatures() != null && v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED));
    }

    /** This engine didn't start or stopped working: let it go and try the next one, the cue waiting (if any) going with
     *  it; after the last one, give up for a while (failed). */
    private static void next() {
        drop();
        // the order was cleared meanwhile (a new choice): start it again from the top rather than give up
        if (order == null && app != null) { order = orderOf(installedEngines()); tried = 0; }
        else tried++;
        if (order != null && tried < order.length) { Log.i(TAG, "trying the next engine: " + order[tried]); make(order[tried]); return; }
        order = null;
        failed();
    }

    /** No engine started or worked: answer "engine" and wait longer before the next try. */
    private static void failed() {
        pendingText = null;
        answer(true, "engine");
        answer(false, "engine");
        drop();
        down = "engine";
        failures++;
        long wait = Math.min(MAX_WAIT_MS, FIRST_WAIT_MS << Math.min(failures - 1, 16));
        retryAt = SystemClock.elapsedRealtime() + wait;
        log("no engine worked; trying again in " + wait / 1000 + " s or when Motus is opened again");
    }

    /** Lets go of a stuck engine (START_MS, BEGIN_MS, SAY_MAX_MS): whoever waits on it hears "timeout", and the next cue
     *  starts a fresh one at once (it is let go only after the wait, so it isn't bound anew on every cue either). One that
     *  never started is passed over: the next cue tries the next engine. */
    private static void unstick() {
        if (tts == null) return;
        long now = SystemClock.elapsedRealtime();
        boolean stuck = !ready ? now - madeAt > startMs() : current != null && now - spokeAt > (started ? SAY_MAX_MS : BEGIN_MS);
        if (!stuck) return;
        log(!ready ? "didn't start within " + startMs() / 1000 + " s" : started ? "didn't finish a cue" : "didn't begin a cue");
        if (!ready) {
            // never started: a failure like any other, so the next engine is tried at once with the cue waiting (if it
            // hasn't waited too long already: then the app says it in its own voice, and the next cue gets the engine)
            if (pendingText != null && now - pendingAt > PENDING_MAX_MS) { pendingText = null; answer(true, "engine"); }
            next();
            return;
        }
        pendingText = null;
        answer(true, "timeout");
        answer(false, "timeout");
        drop();
    }

    private static void drop() {
        if (tts != null) { try { tts.shutdown(); } catch (RuntimeException ignored) { /* already gone */ } }
        tts = null;
        ready = false;
        rebuild = false;
        release();
    }

    /** `again`: the engine was just made for this cue, so a failure moves on to the next engine rather than making
     *  this one anew. */
    private static void speak(String text, float level, boolean again) {
        // no English voice: said in no voice rather than read out by another language's; looked for again at each cue,
        // so one downloaded meanwhile is used
        if (!english) setUpVoice();
        if (!english) { answer(false, "language"); return; }
        Bundle p = new Bundle();
        if (!plain) p.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, Math.max(0f, Math.min(1f, level)));
        String id = "motus-cue-" + (++utterances);
        current = id;
        currentText = text;
        currentLevel = level;
        currentPlain = plain;
        started = false;
        // refused (a phone call going on): not said, rather than over the call
        if (!hold()) { release(); answer(false, "busy"); return; }
        spokeAt = SystemClock.elapsedRealtime();
        int r;
        try {
            tts.setAudioAttributes(plain ? PLAIN : ATTRS);
            r = tts.speak(text, TextToSpeech.QUEUE_FLUSH, p, id);
        } catch (RuntimeException e) { log("speak threw " + e); r = TextToSpeech.ERROR; }
        if (r == TextToSpeech.SUCCESS) {
            main.postDelayed(Voice::unstick, BEGIN_MS + 50);
            main.postDelayed(Voice::unstick, SAY_MAX_MS + 50);
            return;
        }
        log("refused a cue, result " + r);
        // the engine died under us (updated or killed by Android): a fresh one says it, then the next engine
        pendingText = text; pendingLevel = level; pendingHeard = currentHeard; pendingAt = spokeAt;
        currentHeard = NOBODY;
        if (again) { next(); return; }
        drop();
        if (engine() == null) { pendingText = null; answer(true, down); }
    }

    /** The engine couldn't say a cue (UtteranceProgressListener.onError). One it couldn't synthesise is tried once more
     *  with plain settings, then by the next engine, as is one whose engine went away; other errors are told as they are. */
    private static void spokeFailed(String id, int code) {
        if (!id.equals(current)) return;
        log("couldn't say a cue, error " + code + (currentPlain ? " (plain settings)" : ""));
        if (code == TextToSpeech.ERROR_SYNTHESIS && !currentPlain) {
            plain = true;
            preferDownloadedVoice();
            speak(currentText, currentLevel, true);
            return;
        }
        if (code == TextToSpeech.ERROR_SYNTHESIS || code == TextToSpeech.ERROR_SERVICE) {
            pendingText = currentText; pendingLevel = currentLevel; pendingHeard = currentHeard; pendingAt = spokeAt;
            currentHeard = NOBODY;
            next();
            return;
        }
        answer(false, problemOf(code));
        ended(id);
    }

    private static void ended(String id) {
        if (!id.equals(current)) return;
        answer(false, null); // said, or stopped before it began (a newer cue took over): not a fault
        release();
        if (rebuild) drop(); // a new choice came meanwhile: the next cue starts it
    }

    private static String problemOf(int code) {
        // also "no voice installed for this language" on some engines: the app's message covers both
        if (code == TextToSpeech.ERROR_NOT_INSTALLED_YET) return "voice";
        if (code == TextToSpeech.ERROR_NETWORK || code == TextToSpeech.ERROR_NETWORK_TIMEOUT) return "network";
        if (code == TextToSpeech.ERROR_OUTPUT) return "output";
        if (code == TextToSpeech.ERROR_SERVICE || code == TextToSpeech.ERROR_SYNTHESIS) return "engine";
        return "error";
    }

    /** One line to the log (adb logcat -s MotusVoice), with what a report needs: the engine, Android and the phone. */
    private static void log(String what) {
        String engine = using != null ? using : "phone's default (" + defaultSynth() + ")";
        Log.w(TAG, what + " [engine " + engine + ", Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + "), " + Build.MANUFACTURER + " " + Build.MODEL + "]");
    }

    private static String describeEngine() { return using != null ? using : "phone's default (" + actualEngine() + ")"; }

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
        // plain settings were for the cue that needed them, however it ended (said, cut off, stopped): the next one tries
        // the usual ones again, in the chosen voice (the plain try may have swapped it for a downloaded one)
        if (plain) { plain = false; if (tts != null && ready) setUpVoice(); }
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
