// Progression's words in one place (PLAN.md §8.7), so Settings, the routine editor and Finish say the same thing.
import type { ProgressionMode } from "@motus/shared";

export const PROGRESSION_MODES: { value: ProgressionMode; label: string; hint: string }[] = [
  { value: "suggest", label: "Suggest", hint: "Asks you after a workout before changing the weight" },
  { value: "auto", label: "Automatic", hint: "Changes the weight without asking" },
  { value: "off", label: "Off", hint: "The weight only changes when you edit it" },
];
export const modeLabel = (m: ProgressionMode) => PROGRESSION_MODES.find((x) => x.value === m)?.label ?? "Suggest";
/** "Never", "1 missed workout", "3 missed workouts in a row" */
export const lowerAfterLabel = (n: number) => (n === 0 ? "Never" : n === 1 ? "1 missed workout" : `${n} missed workouts in a row`);
export const LOWER_AFTER: { value: number; label: string }[] = Array.from({ length: 11 }, (_, n) => ({ value: n, label: lowerAfterLabel(n) }));
export const MISSED_HINT = "A missed workout: not every working set reached its target reps";
