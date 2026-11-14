// The sound library: every sound choice offers these, in this order with these names - the rest over and countdown
// sounds (Settings → Workout defaults → Workout sounds) and each part of the interval timer. Each name plays the same
// file wherever it is picked (workout/runtime.ts); the ids are SOUND_IDS in @motus/shared, which also moves the ids
// saved before these sounds to the nearest of them.
//
// The sounds are from the uisfx "Minimal" pack (https://github.com/romainsimon/uisfx, packages/uisfx/sounds/minimal),
// CC0 1.0 (public domain), each levelled to -1 dB peak so they carry over a gym on a phone's speaker. The same
// sounds as .ogg are in the Android app (res/raw), which plays the countdown sound in the background (RestCues.java).
import { SOUND_IDS, type IntervalSound, type SoundId } from "@motus/shared";

const NAMES: Record<SoundId, string> = {
  press: "Tap", focus: "Blip", progressStep: "Step", select: "Pip", check: "Check", toggleOn: "Switch", info: "Ping",
  start: "Start", wake: "Wake", checkpoint: "Checkpoint", notification: "Alert", reward: "Reward", warning: "Warning",
  success: "Success", streak: "Streak", complete: "Complete", levelUp: "Level up", achievement: "Achievement",
};
/** short ones first, then the ones with two or more notes, the longest last */
export const SOUNDS = SOUND_IDS.map((id) => ({ id, name: NAMES[id] }));
/** The rest over and countdown sounds' choices */
export const CUE_SOUND_OPTIONS = SOUNDS.map((s) => ({ value: s.id as string, label: s.name }));
/** An interval part's choices: the same list, and None for a part that starts in silence (the rest timer's sounds
 *  have switches for that: Play sounds, the 10 seconds warning, the 3-2-1) */
export const INTERVAL_SOUND_OPTIONS: { value: IntervalSound; label: string }[] = [...SOUNDS.map((s) => ({ value: s.id, label: s.name })), { value: "none", label: "None" }];
export const intervalSoundName = (id: IntervalSound) => INTERVAL_SOUND_OPTIONS.find((o) => o.value === id)?.label ?? "";

// The files, bundled with the app (hashed under /assets/, the smallest inlined), so they play offline: the service
// worker keeps /assets/, the Android and desktop apps carry them. Named as the Android app's res/raw (snake_case).
const FILES = import.meta.glob<string>("../sounds/*.mp3", { eager: true, query: "?url", import: "default" });
const fileName = (id: SoundId) => id.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
/** Each sound's file address */
export const soundUrl = (id: SoundId) => FILES[`../sounds/${fileName(id)}.mp3`]!;
