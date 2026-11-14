// The sound library: one list of sounds for every sound choice, the rest over sound and the countdown sound (Settings
// → Workout defaults → Workout sounds) and each part of the interval timer. Each is a short recorded cue (apps/web
// src/sounds, the Android app's res/raw): most from the uisfx "Minimal" pack (CC0), and four single notes the app used
// to make itself (Round, Marimba, Bell, High), rendered from their old recipes to sit with them. The
// names the screens show and how each plays are in apps/web core/sounds.ts and workout/runtime.ts.

/** Every sound's id as saved, short ones first. */
export const SOUND_IDS = ["hover", "soft", "progressStep", "check", "marimba", "bell", "high", "info", "checkpoint", "notification", "success", "levelUp"] as const;
export type SoundId = (typeof SOUND_IDS)[number];

const isSound = (v: unknown): v is SoundId => (SOUND_IDS as readonly unknown[]).includes(v);

// Ids saved earlier that are no longer in the library, each moved to the nearest of these (by its length, its notes
// and whether it rose or fell), so a choice saved then still plays something like it.
/** Recorded sounds there were for a while (Tap, Blip, Pip, Switch, Start, Wake, Reward, Warning, Streak, Complete, Achievement). */
const DROPPED: Record<string, SoundId> = {
  press: "hover", focus: "marimba", select: "check", toggleOn: "check", start: "info", wake: "info", reward: "success",
  warning: "notification", streak: "levelUp", complete: "success", achievement: "levelUp",
};
// The sounds made in the app before the recorded ones. Most single notes are back under their own names; the two
// timers saved different ids for the same sound (the rest timer's "beep" was Bright, the interval timer's was Bell;
// "gong" was the deep gong for one and the small gong for the other), so each has its own list.
/** The rest timer's old ids (rest over and countdown sound). */
const OLD_REST_SOUNDS: Record<string, SoundId> = {
  ...DROPPED, beep: "soft", click: "hover", digital: "progressStep", wood: "marimba",
  double: "checkpoint", triple: "success", rising: "levelUp", chime: "success", pulse: "checkpoint", softAlarm: "notification",
  handBell: "success", shipBell: "success", tubular: "bell", smallGong: "bell", temple: "bell", bowl: "bell", gong: "bell",
};
/** The interval timer's old ids (each part's sound). */
const OLD_INTERVAL_SOUNDS: Record<string, SoundId> = {
  ...DROPPED, beep: "bell", bright: "soft", low: "soft", click: "hover", digital: "progressStep",
  double: "checkpoint", triple: "success", rising: "levelUp", chime: "success", pulse: "checkpoint", softAlarm: "notification",
  handBell: "success", shipBell: "success", tubular: "bell", gong: "bell", temple: "bell", bowl: "bell", deepGong: "bell",
};
const own = (map: Record<string, SoundId>, v: unknown) => (typeof v === "string" && Object.prototype.hasOwnProperty.call(map, v) ? map[v] : undefined);
/** A rest timer sound as saved (now or before the recorded sounds), as one of ours; undefined if it is neither. */
export const soundOfRest = (v: unknown): SoundId | undefined => (isSound(v) ? v : own(OLD_REST_SOUNDS, v));
/** An interval part's sound as saved (now or before the recorded sounds), as one of ours; undefined if it is neither. */
export const soundOfInterval = (v: unknown): SoundId | undefined => (isSound(v) ? v : own(OLD_INTERVAL_SOUNDS, v));
