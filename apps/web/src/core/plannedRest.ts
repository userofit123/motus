import { restAfterSet, opensSideRound, type RestDefaults, type RoutineExercise, type RoutineSet, type SetKind } from "@motus/shared";

type Ex = Pick<RoutineExercise, "restS" | "restAfterS" | "restByKind">;
// The rest a routine plans after a set of one kind (the exercise's, then the person's defaults): one place so the
// routine page and the editor always say the same.
export const restForKind = (e: Ex, kind: SetKind, isLastSet: boolean, d: RestDefaults, own: number | null = null, nextKind?: SetKind, sideRound?: boolean): number =>
  restAfterSet({ setRestS: own, kind, nextKind, sideRound, byKindS: e.restByKind, exRestS: e.restS, isLastSet, exRestAfterS: e.restAfterS }, d);
// ...and after one particular set, which may have its own rest or be followed by a drop (or open a left and right round)
export const plannedRest = (e: Ex & { sets: RoutineSet[] }, x: RoutineSet, j: number, d: RestDefaults): number =>
  restForKind(e, x.kind, j === e.sets.length - 1, d, x.restS, e.sets[j + 1]?.kind, opensSideRound(e.sets, j));

/** "1:45 between sets, 2:30 after the last one": the routine editor's and the routine page's one-line rest summary */
export const restSummary = (e: { restS?: number | null; restAfterS?: number | null; sets: { restS?: number | null }[] }, clock: (s: number) => string, w: { restBetweenSetsS: number; restAfterExerciseS: number }, sides: boolean) =>
  `${clock(e.restS ?? w.restBetweenSetsS)} between sets${sides ? ", none between sides" : ""}, ${clock(e.restAfterS ?? w.restAfterExerciseS)} after the last one${e.sets.some((x) => x.restS != null) ? ", some sets their own" : ""}`;
