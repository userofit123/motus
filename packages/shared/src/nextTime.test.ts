import { describe, expect, it } from "vitest";
import { applyStructure, cleanProgression, pairSets, planNext, type RoutineSetLike, stepDown, stepUp, structureChanges } from "./nextTime";
import { withDefaults } from "./settings";
import { opensSideRound, restAfterSet, sideRounds } from "./training";
import type { WorkoutExercise, WorkoutSet } from "./types";

const set = (p: Partial<WorkoutSet>): WorkoutSet => ({ id: Math.random().toString(36), position: 0, kind: "normal", weightKg: null, reps: null, durationS: null, distanceM: null, rpe: null, rir: null, side: null, done: true, doneAt: null, restPlannedS: null, restActualS: null, targetReps: null, targetWeightKg: null, prefilled: false, ...p });
const ex = (p: Partial<WorkoutExercise> & { name?: string; tracking?: string }): WorkoutExercise =>
  ({ id: Math.random().toString(36), exerciseId: p.name ?? "x", routineExerciseId: null, status: "done", sets: [], ...p, exercise: { name: p.name ?? "x", tracking: p.tracking ?? "weight_reps" } }) as unknown as WorkoutExercise;
const range = (reps: number, weightKg = 20) => set({ weightKg, reps, targetReps: 8, targetRepsMax: 12 });

describe("planNext", () => {
  const D = { mode: "suggest" as const, stepKg: 2.5, lowerAfter: 3 };
  const rs = (p: Record<string, unknown>) => ({ kind: "normal", reps: 8, repsMax: 12, weightKg: 20, durationS: null, distanceM: null, ...p });
  const slot = (p: Record<string, unknown> = {}) => ({ id: "re1", exerciseId: "x", fixed: false, progression: null, missed: 0, sets: [rs({ kind: "warmup", reps: 10, repsMax: null, weightKg: 10 }), rs({}), rs({})], ...p });
  const done = (sets: WorkoutSet[], p: Partial<WorkoutExercise> & { tracking?: string } = {}) => ({ exercises: [ex({ routineExerciseId: "re1", sets, ...p })] });
  const view = (sets: unknown[]) => (sets as RoutineSetLike[]).map((s) => [s.kind, s.weightKg, s.reps, s.startReps ?? null]);
  const warm = () => set({ kind: "warmup", weightKg: 15, reps: 10 });

  it("takes today's working numbers, keeps warm-ups and the rep range, and starts next time at the reps done", () => {
    const r = planNext([slot()], done([warm(), range(10, 22.5), range(9, 22.5)]), D);
    expect(r.exercises[0]!.sets.map((s: any) => [s.kind, s.weightKg, s.reps, s.repsMax, s.startReps ?? null])).toEqual([["warmup", 10, 10, null, null], ["normal", 22.5, 8, 12, 10], ["normal", 22.5, 8, 12, 9]]);
    expect(r.changes).toEqual([]);
    expect(r.numbersChanged).toBe(true);
  });
  it("goes up a step with reps at the bottom when every set reached the top; suggest applies only when accepted", () => {
    const r = planNext([slot()], done([warm(), range(12), range(12)]), D);
    expect(r.changes[0]).toMatchObject({ mode: "suggest", direction: "up", fromKg: 20, toKg: 22.5, fromReps: 12, reps: 8, reason: "Every set reached 12 reps, the top of 8-12" });
    expect(r.exercises[0]!.sets.map((s: any) => s.weightKg)).toEqual([10, 20, 20]);
    expect(planNext([slot()], done([warm(), range(12), range(12)]), D, ["re1"]).exercises[0]!.sets.map((s: any) => s.weightKg)).toEqual([10, 22.5, 22.5]);
    expect(planNext([slot()], done([warm(), range(12), range(12)]), D, ["other"]).exercises[0]!.sets.map((s: any) => s.weightKg)).toEqual([10, 20, 20]);
    expect(planNext([slot({ progression: { mode: "off", stepKg: null, lowerAfter: null } })], done([range(12), range(12)]), D).changes).toEqual([]);
    expect(planNext([slot({ progression: { mode: "auto", stepKg: null, lowerAfter: null } })], done([range(12), range(12)]), D).changes[0]!.mode).toBe("auto");
  });
  it("only changes the reps inside a range: the reps done are clamped into it, and the same as before is no change", () => {
    const r = planNext([slot()], done([warm(), range(15), range(6)]), D);
    expect(r.exercises[0]!.sets.map((s: any) => [s.reps, s.startReps ?? null])).toEqual([[10, null], [8, 12], [8, null]]);
    const same = slot({ sets: [rs({ startReps: 10 }), rs({ startReps: 10 })] });
    expect(planNext([same], done([range(10), range(10)]), D).numbersChanged).toBe(false);
    expect(planNext([slot({ sets: [rs({}), rs({})] })], done([range(10), range(10)]), D).numbersChanged).toBe(true);
  });
  it("goes up only when every working set was ticked at the top; an unticked one doesn't block a miss", () => {
    const r = planNext([slot()], done([warm(), range(12), set({ weightKg: 20, reps: 12, done: false })]), D);
    expect(r.changes).toEqual([]);
    const miss = planNext([slot({ missed: 2 })], done([warm(), range(7), set({ weightKg: 20, reps: null, done: false })]), D);
    expect(miss.changes[0]).toMatchObject({ direction: "down", reason: "Missed reps 3 workouts in a row" });
    expect(planNext([slot()], done([warm(), range(8), set({ done: false })]), D).exercises[0]).toMatchObject({ missed: 0 });
  });
  it("pairs routine sets by place, so an unticked middle set keeps its own numbers", () => {
    const three = slot({ sets: [rs({ kind: "warmup", reps: 10, repsMax: null, weightKg: 10 }), rs({}), rs({}), rs({})] });
    const r = planNext([three], done([warm(), range(10, 22.5), set({ weightKg: 30, reps: 3, done: false }), range(9, 25)]), D);
    expect(r.exercises[0]!.sets.map((s: any) => [s.weightKg, s.startReps ?? null])).toEqual([[10, null], [22.5, 10], [20, null], [25, 9]]);
  });
  it("pairs drops with drops only: a ticked drop never gives a working set its weight", () => {
    const withDrop = slot({ sets: [rs({ kind: "warmup", reps: 10, repsMax: null, weightKg: 10 }), rs({}), rs({ kind: "drop", repsMax: null, weightKg: 15 })] });
    const r = planNext([withDrop], done([warm(), set({ weightKg: 20, reps: 8, done: false }), set({ kind: "drop", weightKg: 12, reps: 10 })]), D);
    expect(r.exercises[0]!.sets.map((s: any) => [s.kind, s.weightKg])).toEqual([["warmup", 10], ["normal", 20], ["drop", 12]]);
    expect(r.changes).toEqual([]);
  });
  it("drop sets take today's numbers, never decide, and move with their set when its weight changes", () => {
    const withDrop = slot({ sets: [rs({}), rs({ kind: "drop", reps: 10, repsMax: 15, weightKg: 15 }), rs({}), rs({ kind: "drop", reps: 10, repsMax: null, weightKg: 14 })] });
    const drop = (reps: number | null, weightKg: number, p: Partial<WorkoutSet> = {}) => set({ kind: "drop", weightKg, reps, ...p });
    // no change: the drops simply take today's weight and reps (a range keeps it, the reps done are where it starts)
    const same = planNext([withDrop], done([range(10), drop(12, 16), range(10), drop(11, 14)]), D);
    expect(view(same.exercises[0]!.sets)).toEqual([["normal", 20, 8, 10], ["drop", 16, 10, 12], ["normal", 20, 8, 10], ["drop", 14, 11, null]]);
    // a missed or unticked drop doesn't stop the working sets from going up, and a drop at the top doesn't count
    const up = planNext([withDrop], done([range(12), drop(3, 16), range(12), drop(11, 14, { done: false })]), D, ["re1"]);
    expect(up.changes[0]).toMatchObject({ direction: "up", fromKg: 20, toKg: 22.5 });
    // each drop goes up by its own set's step and starts again at the bottom like it
    expect(view(up.exercises[0]!.sets)).toEqual([["normal", 22.5, 8, null], ["drop", 18.5, 10, null], ["normal", 22.5, 8, null], ["drop", 16.5, 10, null]]);
    // reps done above the bottom (a range) or beating the target were done at the old weight: they start again too
    const high = planNext([withDrop], done([range(12), drop(13, 16), range(12), drop(12, 14)]), D, ["re1"]);
    expect(view(high.exercises[0]!.sets)).toEqual([["normal", 22.5, 8, null], ["drop", 18.5, 10, null], ["normal", 22.5, 8, null], ["drop", 16.5, 10, null]]);
    expect(planNext([withDrop], done([range(10), drop(15, 16), range(10), drop(15, 14)]), D).changes).toEqual([]);
    // lowered after missed workouts: the drops come down with their sets and start again at the bottom / target
    const down = planNext([{ ...withDrop, missed: 2, progression: { mode: "auto", stepKg: null, lowerAfter: null } }], done([range(7), drop(13, 15), range(7), drop(12, 14)]), D);
    expect(view(down.exercises[0]!.sets)).toEqual([["normal", 17.5, 8, null], ["drop", 12.5, 10, null], ["normal", 17.5, 8, null], ["drop", 11.5, 10, null]]);
    // a working set without a weight moves nothing: the drop after it stays put instead of following the set before
    const bare = slot({ missed: 2, sets: [rs({}), rs({ weightKg: null }), rs({ kind: "drop", reps: 10, repsMax: null, weightKg: 14 })] });
    const nw = planNext([bare], done([range(7), set({ reps: null, weightKg: null, done: false }), drop(12, 14)]), D, ["re1"]);
    expect(view(nw.exercises[0]!.sets).map((r) => r[1])).toEqual([17.5, null, 14]);
  });
  it("shows the reps actually done on the set a change is about", () => {
    expect(planNext([slot()], done([range(13), range(12)]), D).changes[0]).toMatchObject({ direction: "up", fromKg: 20, fromReps: 13, toKg: 22.5, reps: 8 });
    expect(planNext([slot({ missed: 2 })], done([range(9), range(7)]), D).changes[0]).toMatchObject({ direction: "down", fromReps: 7, toKg: 17.5, reps: 8 });
  });
  it("going up resets the starting reps to the range bottom; a miss is only below the bottom", () => {
    const up = planNext([slot({ sets: [rs({ startReps: 11 }), rs({ startReps: 11 })] })], done([range(12), range(12)]), D, ["re1"]);
    expect(up.exercises[0]!.sets.map((s: any) => [s.weightKg, s.reps, s.startReps ?? null])).toEqual([[22.5, 8, null], [22.5, 8, null]]);
    expect(planNext([slot({ missed: 2 })], done([range(8), range(8)]), D).changes).toEqual([]);
    expect(planNext([slot({ missed: 2 })], done([range(7), range(8)]), D).changes[0]).toMatchObject({ direction: "down" });
  });
  it("snaps to the step's grid, the exercise's own step before Settings'", () => {
    expect(stepUp(22.5, 2.5)).toBe(25);
    expect(stepUp(21.3, 2.5)).toBe(25);
    expect(stepUp(20, 2.27)).toBe(22.7);
    expect(stepDown(21.3, 2.5)).toBe(20);
    expect(stepDown(1, 2.5)).toBe(0);
    const own = ex({ routineExerciseId: "re1", sets: [range(12, 21), range(12, 21)] });
    (own.exercise as any).incrementKg = 1;
    expect(planNext([slot()], { exercises: [own] }, D).changes[0]!.toKg).toBe(22);
  });
  it("uses the rep target when there is no range: reached, it becomes today's reps; missed, it stays", () => {
    const one = slot({ sets: [rs({ repsMax: null, reps: 5, weightKg: 100 })] });
    expect(planNext([one], done([set({ weightKg: 100, reps: 5 })]), D).changes[0]).toMatchObject({ toKg: 102.5, reps: 5, reason: "Every set reached 5 reps" });
    expect(planNext([one], done([set({ weightKg: 100, reps: 4 })]), D).exercises[0]!.sets[0]).toMatchObject({ reps: 5, weightKg: 100 });
  });
  it("lowers a step after N missed workouts in a row, with the reason, and never when set so", () => {
    const miss = done([range(7), range(8)]);
    expect(planNext([slot({ missed: 1 })], miss, D)).toMatchObject({ changes: [], exercises: [{ missed: 2 }] });
    const r = planNext([slot({ missed: 2, progression: { mode: "auto", stepKg: null, lowerAfter: null } })], miss, D);
    expect(r.changes[0]).toMatchObject({ direction: "down", toKg: 17.5, reason: "Missed reps 3 workouts in a row" });
    expect(r.exercises[0]).toMatchObject({ missed: 0 });
    expect(planNext([slot({ missed: 9 })], miss, { ...D, lowerAfter: 0 }).changes).toEqual([]);
    expect(planNext([slot({ missed: 5 })], done([range(9), range(9)]), D).exercises[0]).toMatchObject({ missed: 0 });
  });
  it("starts the missed count again when a lower is not applied, and counts nothing while Progression is Off", () => {
    const miss = done([range(7), range(8)]);
    const r = planNext([slot({ missed: 2 })], miss, D);
    expect(r.changes[0]).toMatchObject({ mode: "suggest", direction: "down" });
    expect(r.exercises[0]).toMatchObject({ missed: 0, sets: [{ weightKg: 10 }, { weightKg: 20 }, { weightKg: 20 }] });
    expect(planNext([slot({ missed: 2 })], miss, D, ["re1"]).exercises[0]).toMatchObject({ missed: 0, sets: [{ weightKg: 10 }, { weightKg: 17.5 }, { weightKg: 17.5 }] });
    expect(planNext([slot({ missed: 2 })], miss, { ...D, mode: "off" }).exercises[0]).toMatchObject({ missed: 0 });
    expect(planNext([slot({ missed: 2, progression: { mode: "off", stepKg: null, lowerAfter: null } })], miss, D).exercises[0]).toMatchObject({ missed: 0 });
  });
  it("leaves fixed, skipped and swapped-away exercises alone", () => {
    const today = done([range(12, 30), range(12, 30)]);
    expect(planNext([slot({ fixed: true })], today, D).numbersChanged).toBe(false);
    expect(planNext([slot()], done([range(12, 30)], { status: "skipped" }), D).numbersChanged).toBe(false);
    expect(planNext([slot({ exerciseId: "other" })], today, D).numbersChanged).toBe(false);
  });
  it("handles bodyweight, assisted and timed exercises sensibly", () => {
    const bw = slot({ sets: [rs({ weightKg: null, repsMax: null, reps: 10 })] });
    const r = planNext([bw], done([set({ reps: 12 })], { tracking: "reps" }), D);
    expect([r.changes, r.exercises[0]!.sets[0]]).toMatchObject([[], { reps: 12, weightKg: null }]);
    // assisted: up means less help
    const as = planNext([slot()], done([range(12, 20), range(12, 20)], { tracking: "assisted" }), D);
    expect(as.changes[0]).toMatchObject({ direction: "up", fromKg: 20, toKg: 17.5 });
    const timed = slot({ sets: [rs({ reps: null, repsMax: null, weightKg: null, durationS: 60 })] });
    const t = planNext([timed], done([set({ durationS: 75 })], { tracking: "duration" }), D);
    expect([t.changes, t.exercises[0]!.sets[0]]).toMatchObject([[], { durationS: 75 }]);
  });
  it("turns an old rule into its own Automatic", () => {
    expect(cleanProgression({ kind: "double", incrementKg: 5, deloadAfter: 2 })).toEqual({ mode: "auto", stepKg: 5, lowerAfter: 2 });
    expect(cleanProgression({ mode: null, stepKg: null, lowerAfter: null })).toBeNull();
  });
});

describe("structureChanges", () => {
  const routine = { exercises: [
    { id: "ra", exerciseId: "A", exercise: { name: "A" }, sets: [{}, {}, {}] },
    { id: "rb", exerciseId: "B", exercise: { name: "B" }, sets: [{}] },
    { id: "rc", exerciseId: "C", exercise: { name: "C" }, sets: [{}] },
    { id: "rd", exerciseId: "D", exercise: { name: "D" }, sets: [{}] }] };
  it("lists nothing when today followed the routine, numbers aside", () => {
    const w = { exercises: routine.exercises.map((r) => ex({ name: r.exerciseId, exerciseId: r.exerciseId, routineExerciseId: r.id, sets: r.sets.map(() => set({ weightKg: 99, reps: 1 })) })) };
    expect(structureChanges(routine, w)).toEqual([]);
  });
  it("lists what was changed, then what was not done", () => {
    const w = { exercises: [
      ex({ name: "C", exerciseId: "C", routineExerciseId: "rc", sets: [set({}), set({})] }),
      ex({ name: "A", exerciseId: "A", routineExerciseId: "ra", sets: [set({}), set({}), set({ done: false })] }),
      ex({ name: "E", exerciseId: "E", routineExerciseId: "rb", sets: [set({})] }),
      ex({ name: "F", id: "wf", exerciseId: "F", sets: [set({})] })] };
    // D was taken out of the workout; B was swapped for E; C got a set more; A had one not done
    expect(structureChanges(routine, w).map((c) => [c.key, c.group, c.text, c.action])).toEqual([
      ["more:rc", "changed", "Add 1 set to C", "You did 2 sets, the routine has 1 · it would have 2"],
      ["swapped:rb", "changed", "Replace B with E", "You swapped it in this workout · E takes its place and settings"],
      ["added:wf", "changed", "Add F to the routine", "You added it in this workout · it joins with today's 1 set"],
      ["removed:rd", "changed", "Remove D from the routine", "You removed it from this workout"],
      ["order", "changed", "Use this workout's exercise order", "You did the exercises in a different order"],
      ["fewer:ra", "notDone", "Remove 1 set from A", "You did 2 of 3 sets · the routine would have 2"]]);
  });
  it("lists a skipped exercise and one with nothing ticked as skipped; one added with nothing ticked isn't listed", () => {
    const w = { exercises: [...routine.exercises.map((r) => ex({ name: r.exerciseId, exerciseId: r.exerciseId, routineExerciseId: r.id, status: r.id === "rc" ? "skipped" : "pending", sets: r.sets.map(() => set({ done: r.id !== "rb" })) })),
      ex({ name: "F", exerciseId: "F", status: "pending", sets: [set({ done: false })] })] };
    expect(structureChanges(routine, w).map((c) => c.key)).toEqual(["skipped:rb", "skipped:rc"]);
  });
});

describe("applyStructure", () => {
  const routine = { exercises: [
    { id: "ra", exerciseId: "A", exercise: { name: "A" }, note: "keep", sets: [{ kind: "normal", reps: 5, weightKg: 100 }, { kind: "normal", reps: 5, weightKg: 100 }] },
    { id: "rb", exerciseId: "B", exercise: { name: "B" }, sets: [{ kind: "normal", reps: 5, weightKg: 140 }] }] };
  const w = { exercises: [
    ex({ name: "A", exerciseId: "A", routineExerciseId: "ra", sets: [set({ weightKg: 105, reps: 5 }), set({ done: false })] }),
    ex({ name: "B", exerciseId: "B", routineExerciseId: "rb", status: "skipped", sets: [set({ done: false })] }),
    ex({ name: "C", id: "wc", exerciseId: "C", sets: [set({ weightKg: 30, reps: 12 }), set({ weightKg: 30, reps: 12 })] })] };
  it("changes nothing unless asked", () => {
    expect(applyStructure(routine, w, [])).toBeNull();
    expect(applyStructure(routine, w, ["made-up"])).toBeNull();
  });
  it("applies only the changes asked for, keeping the routine's own numbers and settings", () => {
    const fewer = applyStructure(routine, w, ["fewer:ra"])!;
    expect(fewer.map((e: any) => [e.exerciseId, e.sets.map((s: any) => s.weightKg)])).toEqual([["A", [100]], ["B", [140]]]);
    expect((fewer[0] as any).note).toBe("keep");
    const out = applyStructure(routine, w, ["skipped:rb", "added:wc"])!;
    // the added exercise takes today's sets, as the routine has none for it
    expect(out.map((e: any) => [e.exerciseId, e.sets.map((s: any) => s.weightKg)])).toEqual([["A", [100, 100]], ["C", [30, 30]]]);
  });
  it("adds sets as copies of the routine's last one, and follows today's order when asked", () => {
    const w2 = { exercises: [
      ex({ name: "B", exerciseId: "B", routineExerciseId: "rb", sets: [set({ weightKg: 150, reps: 5 }), set({ weightKg: 150, reps: 5 })] }),
      ex({ name: "A", exerciseId: "A", routineExerciseId: "ra", sets: [set({}), set({})] })] };
    const out = applyStructure(routine, w2, ["more:rb", "order"])!;
    expect(out.map((e: any) => [e.exerciseId, e.sets.map((s: any) => s.weightKg)])).toEqual([["B", [140, 140]], ["A", [100, 100]]]);
  });
  it("gives an exercise swapped in today's numbers but the routine's set count, unless fewer/more is on too", () => {
    // A (2 sets) swapped for X with 1 set ticked; B (1 set) swapped for Y with 2 ticked
    const w3 = { exercises: [
      ex({ name: "X", exerciseId: "X", routineExerciseId: "ra", sets: [set({ weightKg: 40, reps: 8 })] }),
      ex({ name: "Y", exerciseId: "Y", routineExerciseId: "rb", sets: [set({ weightKg: 60, reps: 6 }), set({ weightKg: 62, reps: 6 })] })] };
    const sets = (out: any[]) => out.map((e) => [e.exerciseId, e.sets.map((s: any) => s.weightKg)]);
    expect(sets(applyStructure(routine, w3, ["swapped:ra", "swapped:rb"])!)).toEqual([["X", [40, 40]], ["Y", [60]]]);
    expect(sets(applyStructure(routine, w3, ["swapped:ra", "fewer:ra", "swapped:rb", "more:rb"])!)).toEqual([["X", [40]], ["Y", [60, 62]]]);
    // the set-count rows name the routine's exercise, with what was done in its place
    expect(structureChanges(routine, w3).filter((c) => c.kind === "fewer" || c.kind === "more").map((c) => c.text))
      .toEqual(["Add 1 set to B (today: Y)", "Remove 1 set from A (today: X)"]);
  });
  it("matches a swapped-in exercise's sets by kind: the routine's warm-ups stay, working sets take today's working numbers", () => {
    const r4 = { exercises: [{ id: "ra", exerciseId: "A", exercise: { name: "A" }, sets: [
      { kind: "warmup", weightKg: 20, reps: 10 }, { kind: "normal", weightKg: 100, reps: 5 }, { kind: "normal", weightKg: 100, reps: 5 }] }] };
    // today: X with a warm-up and one working set ticked
    const w5 = { exercises: [ex({ name: "X", exerciseId: "X", routineExerciseId: "ra", sets: [set({ kind: "warmup", weightKg: 10, reps: 12 }), set({ weightKg: 40, reps: 8 })] })] };
    const out = applyStructure(r4, w5, ["swapped:ra"])!;
    expect(out.map((e: any) => [e.exerciseId, e.sets.map((s: any) => [s.kind, s.weightKg, s.reps])])).toEqual([["X", [["warmup", 20, 10], ["normal", 40, 8], ["normal", 40, 8]]]]);
  });
  it("keeps exercises not done today in their routine place when following today's order", () => {
    const r3 = { exercises: ["a", "b", "c", "d"].map((k) => ({ id: `r${k}`, exerciseId: k.toUpperCase(), exercise: { name: k.toUpperCase() }, sets: [{ kind: "normal" }] })) };
    // today: B skipped but listed first, then D, A, C done
    const w4 = { exercises: [
      ex({ name: "B", exerciseId: "B", routineExerciseId: "rb", status: "skipped", sets: [set({ done: false })] }),
      ex({ name: "D", exerciseId: "D", routineExerciseId: "rd", sets: [set({})] }),
      ex({ name: "A", exerciseId: "A", routineExerciseId: "ra", sets: [set({})] }),
      ex({ name: "C", exerciseId: "C", routineExerciseId: "rc", sets: [set({})] })] };
    expect(structureChanges(r3, w4).map((c) => c.key)).toContain("order");
    expect(applyStructure(r3, w4, ["order"])!.map((e: any) => e.exerciseId)).toEqual(["D", "A", "B", "C"]);
  });
});

describe("the old routine settings", () => {
  it("are dropped from saved settings, and Progression gets its defaults", () => {
    const s = withDefaults({ workout: { updateRoutine: "always", prefillFromLast: false, prefillScope: "routine" }, features: { progression: true } });
    expect(["updateRoutine", "prefillFromLast", "prefillScope"].filter((k) => k in s.workout)).toEqual([]);
    expect("progression" in s.features).toBe(false);
    expect(s.progression).toEqual({ mode: "suggest", lowerAfter: 3 });
    expect(withDefaults({ progression: { mode: "nope", lowerAfter: 40 } }).progression).toEqual({ mode: "suggest", lowerAfter: 10 });
  });
  it("give Off to someone who had the old Progression feature switched off, unless they chose a mode since", () => {
    expect(withDefaults({ features: { progression: false } }).progression.mode).toBe("off");
    expect(withDefaults({ features: { progression: false }, progression: { mode: "auto" } }).progression.mode).toBe("auto");
  });
});

describe("left and right sets", () => {
  const S = (kind: string, side: string | null = null) => ({ kind, side });
  it("pairs each side with the other's same side, general sets with general ones, warm-ups with warm-ups", () => {
    const last = [S("warmup"), S("normal"), S("normal", "R"), S("normal", "L"), S("normal", "R"), S("normal", "L")].map((s, i) => ({ ...s, i }));
    const p = pairSets([S("warmup"), S("normal", "L"), S("normal", "R"), S("normal"), S("normal", "L"), S("normal", "R")], last);
    expect(p.map((x) => x?.i ?? null)).toEqual([0, 3, 2, 1, 5, 4]);
  });
  it("falls back to general sets for a side last time didn't have, and a general set to sided ones, as before sides", () => {
    const general = [S("normal"), S("normal")].map((s, i) => ({ ...s, i }));
    expect(pairSets([S("normal", "L"), S("normal", "R"), S("normal", "L"), S("normal", "R")], general).map((x) => x?.i ?? null)).toEqual([0, 0, 1, 1]);
    const sided = [S("normal", "L"), S("normal", "R")].map((s, i) => ({ ...s, i }));
    expect(pairSets([S("normal"), S("normal"), S("normal")], sided, true).map((x) => x?.i ?? null)).toEqual([0, 1, 1]);
  });
  it("never gives one set twice: general sets past last time's general ones take its unmatched sided sets", () => {
    const last = [S("normal"), S("normal", "L"), S("normal", "R")].map((s, i) => ({ ...s, i }));
    expect(pairSets([S("normal"), S("normal"), S("normal")], last).map((x) => x?.i ?? null)).toEqual([0, 1, 2]);
  });
  it("a side falling back to general sets skips one a general set already took", () => {
    const last = [S("normal")].map((s, i) => ({ ...s, i }));
    expect(pairSets([S("normal"), S("normal", "L")], last).map((x) => x?.i ?? null)).toEqual([0, null]);
    const two = [S("normal"), S("normal")].map((s, i) => ({ ...s, i }));
    expect(pairSets([S("normal"), S("normal", "L"), S("normal", "R")], two).map((x) => x?.i ?? null)).toEqual([0, 1, 1]);
  });
  it("a left and a right set next to each other of the same kind are one round, in either order; L R L R is two", () => {
    expect(sideRounds([S("normal", "L"), S("normal", "R"), S("normal", "L"), S("normal", "R")])).toEqual([true, false, true, false]);
    expect(sideRounds([S("normal", "R"), S("normal", "L"), S("normal")])).toEqual([true, false, false]);
    expect(sideRounds([S("normal", "L"), S("failure", "R"), S("normal", "L"), S("drop", "R")])).toEqual([false, false, false, false]);
    expect(sideRounds([S("normal", "L"), S("normal", "L"), S("normal", "R")])).toEqual([false, true, false]);
  });
  it("no rest inside a left and right round, either order; a set's own rest still wins", () => {
    const d = { betweenSetsS: 90, afterExerciseS: 120 };
    const sets = [S("normal", "R"), S("normal", "L"), S("normal", "L"), S("normal", "R")];
    const rest = (j: number, own?: number) => restAfterSet({ setRestS: own, sideRound: opensSideRound(sets, j), isLastSet: j === sets.length - 1 }, d);
    expect([0, 1, 2, 3].map((j) => rest(j))).toEqual([0, 90, 0, 120]);
    expect(rest(0, 30)).toBe(30);
  });
  it("Progression takes each routine set's numbers from today's set of the same side, and the sides stay", () => {
    const D = { mode: "suggest" as const, stepKg: 2.5, lowerAfter: 3 };
    const rs = (side: string | null, weightKg: number) => ({ kind: "normal", reps: 10, repsMax: null, weightKg, durationS: null, distanceM: null, side });
    const slot = { id: "re1", exerciseId: "x", fixed: false, progression: null, missed: 0, sets: [rs(null, 40), rs("L", 16), rs("R", 16)] };
    // today the right side went first
    const today = { exercises: [ex({ routineExerciseId: "re1", sets: [set({ weightKg: 40, reps: 10 }), set({ side: "R", weightKg: 18, reps: 10 }), set({ side: "L", weightKg: 16, reps: 10 })] })] };
    const r = planNext([slot], today, D);
    expect((r.exercises[0]!.sets as any[]).map((s) => [s.side, s.weightKg])).toEqual([[null, 40], ["L", 16], ["R", 18]]);
  });
  it("a swapped-in exercise's working sets take today's numbers side by side and keep the routine's sides", () => {
    const routine = { exercises: [{ id: "ra", exerciseId: "A", exercise: { name: "A" }, sets: [{ kind: "normal", reps: 8, weightKg: 10, side: "L" }, { kind: "normal", reps: 8, weightKg: 10, side: "R" }] }] };
    const w = { exercises: [ex({ name: "B", exerciseId: "B", routineExerciseId: "ra", sets: [set({ side: "R", weightKg: 14, reps: 8 }), set({ side: "L", weightKg: 12, reps: 8 })] })] };
    const out = applyStructure(routine, w, ["swapped:ra"])!;
    expect((out[0] as any).sets.map((s: any) => [s.side, s.weightKg])).toEqual([["L", 12], ["R", 14]]);
  });
});
