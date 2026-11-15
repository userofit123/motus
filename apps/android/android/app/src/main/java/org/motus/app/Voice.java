package org.motus.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import java.util.Locale;

/**
 * Voice cues ("Rest over. Bench Press, set 3, 8 reps at 80 kilos", "10 seconds") through the phone's own speech engine:
 * Android's WebView has no speechSynthesis, so the web app speaks through here on screen (MotusWorkoutPlugin.speak) and
 * RestCues speaks the scheduled ones with the screen off. One engine, kept once started (starting takes up to a second);
 * a cue asked for while it is still starting is spoken once it has. On the media stream like the cue sounds, at the
 * same level. All on the main thread.
 */
final class Voice {
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static TextToSpeech tts;
    private static boolean ready;
    // the one cue waiting for the engine to start (a newer one replaces it: only the latest is still worth saying)
    private static String pendingText;
    private static float pendingLevel;

    private Voice() {}

    /** Starts the engine ahead of a cue, so the cue isn't held up by it. */
    static void warm(Context ctx) {
        Context app = ctx.getApplicationContext();
        main.post(() -> engine(app));
    }

    /** Says `text` at `level` (0-1), in place of anything still being said. */
    static void say(Context ctx, String text, float level) {
        if (text == null || text.isEmpty()) return;
        Context app = ctx.getApplicationContext();
        main.post(() -> {
            if (engine(app) == null) return;
            if (ready) speak(text, level);
            else { pendingText = text; pendingLevel = level; }
        });
    }

    /** Stops what is being said (the app came back to the screen: it speaks its own cues from there). */
    static void stop() {
        main.post(() -> { pendingText = null; if (tts != null && ready) tts.stop(); });
    }

    private static TextToSpeech engine(Context app) {
        if (tts != null) return tts;
        try {
            tts = new TextToSpeech(app, status -> main.post(() -> {
                if (status != TextToSpeech.SUCCESS) { tts = null; ready = false; return; } // no engine: tried again next time
                ready = true;
                // the cues are English, as the app is; the phone's own language only when it has no English voice
                if (tts.isLanguageAvailable(Locale.getDefault().getLanguage().equals("en") ? Locale.getDefault() : Locale.UK) >= TextToSpeech.LANG_AVAILABLE)
                    tts.setLanguage(Locale.getDefault().getLanguage().equals("en") ? Locale.getDefault() : Locale.UK);
                tts.setSpeechRate(1.05f);
                tts.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
                if (pendingText != null) { speak(pendingText, pendingLevel); pendingText = null; }
            }));
        } catch (RuntimeException e) { tts = null; }
        return tts;
    }

    private static void speak(String text, float level) {
        Bundle p = new Bundle();
        p.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, Math.max(0f, Math.min(1f, level)));
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, p, "motus-cue");
    }
}
