import { restAfterSet, planSetRest, type WorkoutExercise, opensSideRound, type RestDefaults, type WorkoutPrefs, restDefaultsOf, type RoutineExercise, type RoutineSet, type SetKind } from "@motus/shared";

type Ex = Pick<RoutineExercise, "restS" | "restAfterS" | "restByKind">;
// The rest a routine plans after a set of one kind (the exercise's, then the person's defaults): one place so the
// routine page and the editor always say the same.
export const restForKind = (e: Ex, kind: SetKind, isLastSet: boolean, d: RestDefaults, own: number | null = null, nextKind?: SetKind, sideRound?: boolean): number =>
  restAfterSet({ setRestS: own, kind, nextKind, sideRound, byKindS: e.restByKind, exRestS: e.restS, isLastSet, exRestAfterS: e.restAfterS }, d);
// ...and after one particular set, which may have its own rest or be followed by a drop (or open a left and right round)
export const plannedRest = (e: Ex & { sets: RoutineSet[] }, x: RoutineSet, j: number, d: RestDefaults): number =>
  restForKind(e, x.kind, j === e.sets.length - 1, d, x.restS, e.sets[j + 1]?.kind, opensSideRound(e.sets, j));
// The rest a workout exercise planned after set j, for joining left and right rounds (sideJoins): the set's own planned
// rest, else the plan's rule. Never restFor, which adds runtime changes (adaptive rest, supersets) and would make the bar flicker.
export const joinRest = (e: WorkoutExercise, j: number, d: RestDefaults): number =>
  e.sets[j]?.restPlannedS ?? planSetRest(e.sets, j, e, d);

export const KIND_LABEL: Partial<Record<SetKind, string>> = { warmup: "after warm-ups", failure: "after failure sets", drop: "after drops" };
/** ["1:00 after warm-ups", "1:45 between sets", "2:30 after the last one"]: the routine editor's and the routine page's rest
 *  summary, as parts so the views join them with the same dot as every other summary line. Only the set types the exercise
 *  has, and only rests above 0 (0 is off); the numbers come from restForKind, the rule the workout and server use. */
export const restSummary = (e: Ex & { sets: (RoutineSet | { kind?: SetKind | null; restS?: number | null })[] }, clock: (s: number) => string, w: WorkoutPrefs, sides: boolean): string[] => {
  const d = restDefaultsOf(w), last = e.sets.length - 1;
  const kinds = (k: SetKind) => e.sets.some((x, j) => x.kind === k && j < last);
  const between = restForKind(e, "normal", false, d), after = restForKind(e, "normal", true, d);
  const kindPart = (k: SetKind) => {
    const r = kinds(k) ? restForKind(e, k, false, d) : 0;
    return r > 0 ? `${clock(r)} ${KIND_LABEL[k]}` : "";
  };
  return [
    // warm-ups resting like every other set need no part of their own
    kinds("warmup") && restForKind(e, "warmup", false, d) === between ? "" : kindPart("warmup"),
    between > 0 ? `${clock(between)} between sets` : "",
    kindPart("failure"),
    kindPart("drop"),
    sides ? "none between sides" : "",
    after > 0 ? `${clock(after)} after the last one` : "",
    e.sets.some((x) => x.restS != null) ? "some sets their own" : "",
  ].filter(Boolean);
};
