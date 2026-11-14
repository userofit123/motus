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
export const MISSED_HINT = "Missing the bottom of the rep range in this many workouts in a row";
/** What Progression does, at the top of Settings' Progression and of an exercise's own */
export const PROGRESSION_INTRO = "After each workout the routine keeps the reps you did. The reps move inside the rep range; when every set reaches its top, the weight goes up and the reps start again at its bottom";
export const RANGE_HINT = "The reps to aim for. At the top on every set, the weight goes up";
/** Settings' two rep range rows, one end each, like the two weight step rows */
export const RANGE_BOTTOM_HINT = "Where the reps start again after the weight goes up";
export const RANGE_TOP_HINT = "At the top on every set, the weight goes up";
type ProgShown = { mode: ProgressionMode; repsMin: number; repsMax: number; stepKg: number; lowerAfter: number };
type ProgOwn = { mode?: unknown; repsMin?: unknown; stepKg?: unknown; lowerAfter?: unknown } | null | undefined;
/** One exercise's Progression in plain words, as the routine page and the routine editor's Progression header say it:
 *  "Automatic · aims for 6-12 reps · when every set reaches 12, adds 2.5 kg and goes back to 6 reps · lowers the weight
 *  after 3 missed workouts"; one target: "aims for 8 reps · when every set reaches 8, adds 2.5 kg next time"; Suggest
 *  "suggests adding ..."; assisted exercises move the help the other way (nextTime: up = less help, down = more help).
 *  Each part is faded (`dim`) while it follows your default; Off is only "Off". */
export function progParts(p: ProgShown, own: ProgOwn, weight: (kg: number) => string, opts: { assisted?: boolean } = {}) {
  const o = own ?? {};
  const mode = { text: modeLabel(p.mode), dim: o.mode == null };
  if (p.mode === "off") return [mode];
  const ask = p.mode === "suggest", w = weight(p.stepKg), same = p.repsMin === p.repsMax;
  // the weight's move as a verb: "adds 2.5 kg", "suggests adding 2.5 kg", "takes 2.5 kg off the help"
  const up = opts.assisted ? (ask ? `suggests taking ${w} off the help` : `takes ${w} off the help`) : (ask ? `suggests adding ${w}` : `adds ${w}`);
  const back = same ? " next time" : ask ? ` and going back to ${p.repsMin} reps` : ` and goes back to ${p.repsMin} reps`;
  const n = p.lowerAfter, missed = n === 1 ? "1 missed workout" : `${n} missed workouts in a row`;
  const down = opts.assisted ? (ask ? "suggests more help" : "adds more help") : (ask ? "suggests lowering the weight" : "lowers the weight");
  return [mode,
    { text: `aims for ${rangeText(p.repsMin, p.repsMax)}`, dim: o.repsMin == null },
    { text: `when every set reaches ${p.repsMax}, ${up}${back}`, dim: o.repsMin == null && o.stepKg == null },
    { text: n === 0 ? (opts.assisted ? "never adds help" : "never lowers the weight") : `${down} after ${missed}`, dim: o.lowerAfter == null }];
}
