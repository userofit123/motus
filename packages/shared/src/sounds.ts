// The sound library: one list of sounds for every sound choice, the rest over sound and the countdown sound (Settings
// → Workout defaults → Workout sounds) and each part of the interval timer. Each is a short recorded cue (apps/web
// src/sounds, the Android app's res/raw), picked from the uisfx "Minimal" pack (CC0). The names the screens show and
// how each plays are in apps/web core/sounds.ts and workout/runtime.ts.

/** Every sound's id as saved, short ones first. */
export const SOUND_IDS = ["hover", "press", "focus", "progressStep", "select", "check", "toggleOn", "info", "start", "wake", "checkpoint", "notification", "reward", "warning", "success", "streak", "complete", "levelUp", "achievement"] as const;
export type SoundId = (typeof SOUND_IDS)[number];

const isSound = (v: unknown): v is SoundId => (SOUND_IDS as readonly unknown[]).includes(v);

// The sounds made in the app before the recorded ones, each moved to the nearest of these (by its length, its notes
// and whether it rose or fell), so a choice saved then still plays something like it. The two timers saved different
// ids for the same sound (the rest timer's "beep" was Bright, the interval timer's was Bell; "gong" was the deep gong
// for one and the small gong for the other), so each has its own list.
/** The rest timer's old ids (rest over and countdown sound). */
const OLD_REST_SOUNDS: Record<string, SoundId> = {
  beep: "progressStep", bell: "notification", soft: "select", digital: "focus", wood: "press", click: "press",
  double: "checkpoint", triple: "streak", high: "info", rising: "levelUp", chime: "reward", pulse: "start", softAlarm: "warning",
  handBell: "success", shipBell: "complete", tubular: "complete", smallGong: "complete", temple: "achievement", bowl: "achievement", gong: "achievement",
};
/** The interval timer's old ids (each part's sound). */
const OLD_INTERVAL_SOUNDS: Record<string, SoundId> = {
  bright: "progressStep", beep: "notification", low: "select", digital: "focus", marimba: "press", click: "press",
  double: "checkpoint", triple: "streak", high: "info", rising: "levelUp", chime: "reward", pulse: "start", softAlarm: "warning",
  handBell: "success", shipBell: "complete", tubular: "complete", gong: "complete", temple: "achievement", bowl: "achievement", deepGong: "achievement",
};
const own = (map: Record<string, SoundId>, v: unknown) => (typeof v === "string" && Object.prototype.hasOwnProperty.call(map, v) ? map[v] : undefined);
/** A rest timer sound as saved (now or before the recorded sounds), as one of ours; undefined if it is neither. */
export const soundOfRest = (v: unknown): SoundId | undefined => (isSound(v) ? v : own(OLD_REST_SOUNDS, v));
/** An interval part's sound as saved (now or before the recorded sounds), as one of ours; undefined if it is neither. */
export const soundOfInterval = (v: unknown): SoundId | undefined => (isSound(v) ? v : own(OLD_INTERVAL_SOUNDS, v));
