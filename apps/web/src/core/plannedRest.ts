import { restAfterSet, type RestDefaults, type RoutineExercise, type RoutineSet, type SetKind } from "@motus/shared";

type Ex = Pick<RoutineExercise, "restS" | "restAfterS" | "restByKind">;
// The rest a routine plans after a set of one kind (the exercise's, then the person's defaults): one place so the
// routine page and the editor always say the same.
export const restForKind = (e: Ex, kind: SetKind, isLastSet: boolean, d: RestDefaults, own: number | null = null, nextKind?: SetKind, side?: string | null, nextSide?: string | null): number =>
  restAfterSet({ setRestS: own, kind, nextKind, side, nextSide, byKindS: e.restByKind, exRestS: e.restS, isLastSet, exRestAfterS: e.restAfterS }, d);
// ...and after one particular set, which may have its own rest or be followed by a drop (or be a left set before its right)
export const plannedRest = (e: Ex & { sets: RoutineSet[] }, x: RoutineSet, j: number, d: RestDefaults): number =>
  restForKind(e, x.kind, j === e.sets.length - 1, d, x.restS, e.sets[j + 1]?.kind, x.side, e.sets[j + 1]?.side);
