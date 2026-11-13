// The workout switches in one place, in the groups, order and words both screens show them: Settings → Workout
// defaults (the saved defaults) and the Workout settings popup (this workout only).
import type { CueSound, Settings, WorkoutPrefs } from "@motus/shared";
import { SOUND_BELL, SOUND_ROUND, SOUND_DIGITAL, SOUND_MARIMBA } from "./soundNames";

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
  /** a number with − and + instead of a switch */
  num?: { min: number; max: number; step: number; unit: string };
}
/** The cue sounds' names, in the order offered (ids: CUE_SOUNDS in @motus/shared) */
export const CUE_SOUND_NAME: Record<CueSound, string> = { beep: "Bright", bell: SOUND_BELL, soft: SOUND_ROUND, digital: SOUND_DIGITAL, wood: SOUND_MARIMBA };
export interface PrefGroup { id: "fill" | "timer" | "during"; title: string; rows: PrefRow[] }

export const WORKOUT_PREF_GROUPS: PrefGroup[] = [
  { id: "fill", title: "Sets", rows: [
    { key: "showPrevious", label: "Show last time's numbers", hint: "A Previous column beside each set" },
    { key: "showWarmups", label: "Show warm-up sets", hint: "", feature: "setTypes" },
  ] },
  { id: "timer", title: "Rest timer", rows: [
    { key: "autoRest", label: "Start the rest timer when a set is ticked", hint: "" },
    { key: "restEndNext", label: "Go to the next set when the rest ends", hint: "Otherwise it waits on \"Rest over\" until you tap Next set" },
    { key: "sound", label: "Sound when the rest ends", hint: "" },
    { key: "cueSound", label: "Sound", hint: "For every workout cue: rest, 10-second warning and timed sets", preview: true,
      options: (Object.keys(CUE_SOUND_NAME) as CueSound[]).map((value) => ({ value, label: CUE_SOUND_NAME[value] })) },
    { key: "cueVolume", label: "Sound level", hint: "How loud the workout cues play", num: { min: 10, max: 100, step: 10, unit: "%" } },
    { key: "vibrate", label: "Vibrate when the rest ends", hint: "" },
    { key: "warn10", label: "Warn 10 seconds before the rest ends", hint: "" },
    { key: "voice", label: "Voice cues", hint: "Says what's next when a rest ends", feature: "voice" },
    { key: "countdown", label: "3-2-1 countdown", hint: "Before timed sets, and in the last seconds of a rest" },
    { key: "lockScreen", label: "Rest timer on the lock screen", hint: "Android app" },
  ] },
  { id: "during", title: "During a workout", rows: [
    { key: "autoAdvance", label: "Go to the next exercise when one is done", hint: "" },
    { key: "keepAwake", label: "Keep the screen on", hint: "" },
    { key: "sessionNotice", label: "Show the workout as a notification", hint: "Its name, the exercise and set you're on, and how far along you are" },
    { key: "showReminders", label: "Show reminders and pinned notes", hint: "Notes written in this workout always show" },
    { key: "confirmSkip", label: "Ask before skipping an exercise", hint: "" },
  ] },
];

/** The groups as one screen shows them: rows for features that are off left out. Empty groups are dropped. */
export function prefGroups(s: Settings): PrefGroup[] {
  return WORKOUT_PREF_GROUPS.map((g) => ({ ...g, rows: g.rows.filter((r) => !r.feature || s.features[r.feature]) })).filter((g) => g.rows.length);
}
