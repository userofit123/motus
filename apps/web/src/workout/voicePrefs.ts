// Which voice speaks Voice cues on this device, and what became of the latest cue. Kept on the device (core/prefs.ts),
// not in the account: an engine or a voice only exists on the phone or computer that has it. The Android app gets a
// copy, so the cues it speaks with the screen locked use the same choice.
import { ref } from "vue";
import { readJson, writeJson } from "../core/prefs";
import { nativeSetVoice, type NativeVoiceProblem } from "./native";

/** `own`: Motus's own voice. Android: `engine` (a package) and `voice` (its name, in `voiceEngine`), null for the
 *  phone's default. A browser or the desktop app: `voice` is a speechSynthesis voiceURI, null for its default. */
export interface VoiceChoice { own?: boolean; engine?: string | null; voice?: string | null; voiceEngine?: string | null }
const KEY = "motusVoice";
export const voiceChoice = ref<VoiceChoice>(readJson<VoiceChoice>(KEY, {}));
// given to the app as Motus starts too, so a choice kept here and the app's own copy can't differ
nativeSetVoice(voiceChoice.value);
export function setVoiceChoice(c: VoiceChoice) {
  voiceChoice.value = c;
  writeJson(KEY, c);
  nativeSetVoice(c);
  voiceResult.value = null;
}

/** Why a cue wasn't heard as chosen: the Android app's reason, the browser's, or "builtin" (Motus's own voice couldn't load). */
export type VoiceProblem = NativeVoiceProblem | SpeechSynthesisErrorCode | "builtin";
/** The latest cue on this device: who spoke it ("phone": the phone's engine, "browser": the browser's or computer's
 *  voice, "own": Motus's own voice, null: nobody) and why not as chosen (null: it was). Settings shows it. */
export const voiceResult = ref<{ by: "phone" | "browser" | "own" | null; problem: VoiceProblem | null } | null>(null);
