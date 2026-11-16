// The workout switches in one place, in the groups, order and words both screens show them: Settings → Workout
// defaults (the saved defaults) and the Workout settings popup (this workout only).
import { FEATURES, type Settings, type WorkoutPrefs } from "@motus/shared";
import { CUE_SOUND_OPTIONS } from "./sounds";

export interface PrefRow {
  key: keyof WorkoutPrefs;
  label: string;
  hint: string;
  /** a choice instead of a switch */
  options?: { value: string; label: string }[];
  /** shown only while this feature is on (Settings → Features) */
  feature?: string;
  /** with a play button by the choice (and by each option in its list) to hear it */
  preview?: boolean;
  /** shown only while this switch is on, right under it */
  under?: keyof WorkoutPrefs;
  /** a number with − and + instead of a switch */
  num?: { min: number; max: number; step: number; unit: string };
}
export interface PrefGroup { id: "fill" | "timer" | "sounds" | "during"; title: string; rows: PrefRow[] }

/** What turning Voice cues on speaks as an example: what they say when a rest ends. */
export const VOICE_EXAMPLE = "Rest over. Bench press, set 3, 8 reps";

export const WORKOUT_PREF_GROUPS: PrefGroup[] = [
  { id: "fill", title: "Sets", rows: [
    { key: "showPrevious", label: "Show last time's numbers", hint: "A Last time column beside each set" },
    { key: "showWarmups", label: "Show warm-up sets", hint: "", feature: "setTypes" },
  ] },
  { id: "timer", title: "Rest timer", rows: [
    { key: "autoRest", label: "Start the rest timer when a set is ticked", hint: "" },
    { key: "restEndNext", label: "Go to the next set when the rest ends", hint: "Otherwise it waits on \"Rest over\" until you tap the button to go on" },
    { key: "vibrate", label: "Vibrate when the rest ends", hint: "On Android phones, also when an interval part starts" },
    { key: "lockScreen", label: "Rest timer on the lock screen", hint: "In the Android app" },
  ] },
  // the switch first, then which cues play, then how they sound: the two sounds and the level
  { id: "sounds", title: "Workout sounds", rows: [
    { key: "sound", label: "Play sounds", hint: "For the rest timer, timed sets and the interval timer" },
    { key: "warn10", label: "Warn 10 seconds before the rest ends", hint: "One beep in the countdown sound", under: "sound" },
    { key: "countdown", label: "3-2-1 countdown", hint: "Three beeps in the countdown sound before a rest ends or a timed set starts", under: "sound" },
    { key: "voice", label: "Voice cues", hint: 'When a rest ends, says the next set after the rest over sound, and "10 seconds" with the warning', feature: "voice", under: "sound" },
    { key: "cueSound", label: "Rest over sound", hint: "When a rest or a timed set reaches 0", preview: true, under: "sound", options: CUE_SOUND_OPTIONS },
    { key: "tickSound", label: "Countdown sound", hint: "The 10 second warning and every 3-2-1", preview: true, under: "sound", options: CUE_SOUND_OPTIONS },
    { key: "cueVolume", label: "Sound level", hint: "How loud all workout and timer sounds and the voice play", under: "sound", num: { min: 10, max: 100, step: 10, unit: "%" } },
  ] },
  { id: "during", title: "During a workout", rows: [
    { key: "autoAdvance", label: "Go to the next exercise when one is done", hint: "" },
    { key: "keepAwake", label: "Keep the screen on", hint: "" },
    { key: "sessionNotice", label: "Show the workout as a notification", hint: "Its name, the exercise and set you're on, and how far along you are" },
    { key: "showReminders", label: "Show reminders and pinned notes", hint: "Notes written in this workout always show" },
  ] },
];

/** The groups as one screen shows them: rows for features that are off left out. Empty groups are dropped. */
export function prefGroups(s: Settings): PrefGroup[] {
  return WORKOUT_PREF_GROUPS.map((g) => ({ ...g, rows: g.rows.filter((r) => !r.feature || s.features[r.feature]) })).filter((g) => g.rows.length);
}

/** What a switch in Settings → Features saves: switched on, also the workout settings it needs (FeatureDef.turnsOn). */
export function featurePatch(id: string, on: boolean): Record<string, unknown> {
  const keys = on ? FEATURES.find((f) => f.id === id)?.turnsOn : undefined;
  return keys ? { features: { [id]: true }, workout: Object.fromEntries(keys.map((k) => [k, true])) } : { features: { [id]: on } };
}
