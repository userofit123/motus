// The workout switches in one place, in the groups, order and words both screens show them: Settings → Workout
// defaults (the saved defaults) and the Workout settings popup (this workout only). The popup leaves out what can't
// change once a workout is under way (how sets are filled in), so it shows those only before starting.
import type { Settings, WorkoutPrefs } from "@motus/shared";

export interface PrefRow {
  key: keyof WorkoutPrefs;
  label: string;
  hint: string;
  /** a choice instead of a switch */
  options?: { value: string; label: string }[];
  /** shown only while this feature is on (Settings → Features) */
  feature?: string;
  /** decided when the workout starts: no use changing it during one */
  atStart?: boolean;
}
export interface PrefGroup { id: "fill" | "timer" | "during"; title: string; rows: PrefRow[] }

export const WORKOUT_PREF_GROUPS: PrefGroup[] = [
  { id: "fill", title: "Filling in sets", rows: [
    { key: "prefillFromLast", label: "Start from what you did last time", hint: "Weights and reps fill in from last time. Off: the routine's own numbers", atStart: true },
    { key: "prefillScope", label: "Last time's numbers come from", hint: "", atStart: true, options: [{ value: "any", label: "Any routine" }, { value: "routine", label: "The same routine" }] },
    { key: "showPrevious", label: "Show last time's numbers", hint: "Beside each set" },
    { key: "showWarmups", label: "Show warm-up sets", hint: "", feature: "setTypes" },
  ] },
  { id: "timer", title: "Rest timer", rows: [
    { key: "autoRest", label: "Start the rest timer when a set is ticked", hint: "" },
    { key: "restEndNext", label: "Go to the next set when the rest ends", hint: "Otherwise it waits on \"Rest over\" until you tap Next set" },
    { key: "sound", label: "Sound when the rest ends", hint: "" },
    { key: "vibrate", label: "Vibrate when the rest ends", hint: "" },
    { key: "warn10", label: "Warn 10 seconds before the rest ends", hint: "" },
    { key: "voice", label: "Voice cues", hint: "Says what's next when a rest ends", feature: "voice" },
    { key: "countdown", label: "3-2-1 before timed sets", hint: "" },
    { key: "lockScreen", label: "Rest timer on the lock screen", hint: "Android app" },
  ] },
  { id: "during", title: "During a workout", rows: [
    { key: "autoAdvance", label: "Go to the next exercise when one is done", hint: "" },
    { key: "keepAwake", label: "Keep the screen on", hint: "" },
    { key: "sessionNotice", label: "Show the workout as a notification", hint: "Its name, the exercise and set you're on, and how far along you are" },
    { key: "showReminders", label: "Show reminders and pinned notes", hint: "" },
    { key: "confirmSkip", label: "Ask before skipping an exercise", hint: "" },
  ] },
];

/** The groups as one screen shows them: rows for features that are off left out, and (`during`) the ones decided at
 * the start left out once a workout is under way. Empty groups are dropped. */
export function prefGroups(s: Settings, during = false): PrefGroup[] {
  return WORKOUT_PREF_GROUPS.map((g) => ({ ...g, rows: g.rows.filter((r) => (!r.feature || s.features[r.feature]) && !(during && r.atStart)) })).filter((g) => g.rows.length);
}
