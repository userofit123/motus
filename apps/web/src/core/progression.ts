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
/** "6-12 reps", or "8 reps" when both ends are the same */
export const rangeText = (lo: number, hi: number) => (lo === hi ? `${lo} reps` : `${lo}-${hi} reps`);
export const LOWER_AFTER: { value: number; label: string }[] = Array.from({ length: 11 }, (_, n) => ({ value: n, label: lowerAfterLabel(n) }));
export const MISSED_HINT = "A missed workout: a working set below the bottom of the rep range. Once or twice is part of training";
/** What Progression does, at the top of Settings' Progression and of an exercise's own */
export const PROGRESSION_INTRO = "After each workout the routine keeps the reps you did. The reps move inside the rep range; when every set reaches its top, the weight goes up and the reps start again at its bottom";
export const RANGE_HINT = "The reps to aim for. At the top on every set, the weight goes up";
/** Settings' two rep range rows, one end each, like the two weight step rows */
export const RANGE_BOTTOM_HINT = "Where the reps start again after the weight goes up";
export const RANGE_TOP_HINT = "At the top on every set, the weight goes up";
/** The short lower-after part of a summary: "lower after 3 missed", "never lower" */
export const lowerAfterShort = (n: number) => (n === 0 ? "never lower" : `lower after ${n} missed`);
type ProgShown = { mode: ProgressionMode; repsMin: number; repsMax: number; stepKg: number; lowerAfter: number };
type ProgOwn = { mode?: unknown; repsMin?: unknown; stepKg?: unknown; lowerAfter?: unknown } | null | undefined;
/** One exercise's Progression in a few words, as the routine editor's tile and the routine page say it:
 *  "Automatic · 6-12 reps · +2.5 kg" (+ "lower after 3 missed" with `lowerAfter`), each part faded (`dim`) while it
 *  follows your default; Off is only "Off". `more` marks the parts after the mode (a phone tile may hide them). */
export function progParts(p: ProgShown, own: ProgOwn, weight: (kg: number) => string, opts: { lowerAfter?: boolean } = {}) {
  const o = own ?? {};
  const mode = { text: modeLabel(p.mode), dim: o.mode == null, more: false };
  if (p.mode === "off") return [mode];
  return [mode, { text: rangeText(p.repsMin, p.repsMax), dim: o.repsMin == null, more: true }, { text: `+${weight(p.stepKg)}`, dim: o.stepKg == null, more: true },
    ...(opts.lowerAfter ? [{ text: lowerAfterShort(p.lowerAfter), dim: o.lowerAfter == null, more: true }] : [])];
}
