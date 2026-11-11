import { describe, expect, it } from "vitest";
import { applyStructure, cleanProgression, pairSets, planNext, type RoutineSetLike, stepDown, stepUp, structureChanges } from "./nextTime";
import { progressionDefaultsOf, withDefaults } from "./settings";
import { opensSideRound, planSetRest, restAfterSet, sideRounds } from "./training";
import type { WorkoutExercise, WorkoutSet } from "./types";

const set = (p: Partial<WorkoutSet>): WorkoutSet => ({ id: Math.random().toString(36), position: 0, kind: "normal", weightKg: null, reps: null, durationS: null, distanceM: null, rpe: null, rir: null, side: null, done: true, doneAt: null, restPlannedS: null, restActualS: null, targetReps: null, targetWeightKg: null, prefilled: false, ...p });
const ex = (p: Partial<WorkoutExercise> & { name?: string; tracking?: string }): WorkoutExercise =>
  ({ id: Math.random().toString(36), exerciseId: p.name ?? "x", routineExerciseId: null, status: "done", sets: [], ...p, exercise: { name: p.name ?? "x", tracking: p.tracking ?? "weight_reps" } }) as unknown as WorkoutExercise;

describe("planNext", () => {
  // Settings: 6-12 reps, 5 kg both sides together, 2.5 kg one side at a time, lower after 3 missed workouts
  const D = { mode: "suggest" as const, repsMin: 6, repsMax: 12, stepKg: 5, stepOneSideKg: 2.5, lowerAfter: 3 };
  const rs = (p: Record<string, unknown>) => ({ kind: "normal", reps: 8, weightKg: 20, durationS: null, distanceM: null, ...p });
  const slot = (p: Record<string, unknown> = {}) => ({ id: "re1", exerciseId: "x", fixed: false, progression: null, missed: 0, sets: [rs({ kind: "warmup", reps: 10, weightKg: 10 }), rs({}), rs({})], ...p });
  const done = (sets: WorkoutSet[], p: Partial<WorkoutExercise> & { tracking?: string } = {}) => ({ exercises: [ex({ routineExerciseId: "re1", sets, ...p })] });
  const view = (sets: unknown[]) => (sets as RoutineSetLike[]).map((s) => [s.kind, s.weightKg, s.reps]);
  const warm = () => set({ kind: "warmup", weightKg: 15, reps: 10 });
  const at = (weightKg: number, reps: number, p: Partial<WorkoutSet> = {}) => set({ weightKg, reps, ...p });

  it("takes today's weights and the reps done inside the range; warm-ups too; no change of weight below the top", () => {
    const r = planNext([slot()], done([warm(), at(22.5, 10), at(20, 7)]), D);
    expect(view(r.exercises[0]!.sets)).toEqual([["warmup", 15, 10], ["normal", 22.5, 10], ["normal", 20, 7]]);
    expect(r.changes).toEqual([]);
    expect(r.numbersChanged).toBe(true);
  });

  it("50 kg x 12 x 3 at 6-12: heavier, from what was done, on the 5 kg step, reps back to 6, and says so", () => {
    const three = slot({ sets: [rs({ weightKg: 50, reps: 12 }), rs({ weightKg: 50, reps: 12 }), rs({ weightKg: 50, reps: 12 })] });
    const r = planNext([three], done([at(50, 12), at(50, 12), at(50, 12)]), D, ["re1"]);
    // estimated one-rep max 70 kg, so 58.3 kg for 6 reps: 60 kg on the 5 kg grid
    expect(view(r.exercises[0]!.sets)).toEqual([["normal", 60, 6], ["normal", 60, 6], ["normal", 60, 6]]);
    expect(r.changes[0]).toMatchObject({ direction: "up", mode: "suggest", fromKg: 50, toKg: 60, fromReps: 12, reps: 6 });
    expect(r.changes[0]!.reason).toBe("You did 12 reps on every set, the top of 6-12. Next time: heavier, starting again at 6 reps");
    // suggest: listed, applied only when switched on
    expect(view(planNext([three], done([at(50, 12), at(50, 12), at(50, 12)]), D).exercises[0]!.sets)).toEqual([["normal", 50, 12], ["normal", 50, 12], ["normal", 50, 12]]);
  });

  it("46 kg x 12 one side at a time: the 2.5 kg step; an exercise's own step and its own Progression come first", () => {
    const sided = slot({ sets: [rs({ weightKg: 46, side: "L" }), rs({ weightKg: 46, side: "R" })] });
    const r = planNext([sided], done([at(46, 12, { side: "L" }), at(46, 12, { side: "R" })]), D, ["re1"]);
    // 64.4 kg one-rep max, 53.7 kg for 6 reps: 52.5 kg on the 2.5 kg grid
    expect(r.changes[0]).toMatchObject({ fromKg: 46, toKg: 52.5, reps: 6 });
    const own = planNext([slot({ progression: { mode: "auto", repsMin: 8, repsMax: 10, stepKg: 1 } })], done([at(20, 10), at(20, 10)]), D);
    expect(own.changes[0]).toMatchObject({ mode: "auto", toKg: 21, reps: 8 });
    expect(own.changes[0]!.reason).toContain("the top of 8-10");
    const w4 = done([at(20, 12), at(20, 12)]);
    (w4.exercises[0]!.exercise as { incrementKg?: number }).incrementKg = 4;
    const exStep = planNext([slot()], w4, D);
    expect(exStep.changes[0]!.toKg).toBe(24);
  });

  it("goes at least one step up, and only when every working set was ticked at the top", () => {
    // 20 reps is past what the estimate covers: one step
    expect(planNext([slot()], done([at(20, 20), at(20, 20)]), D).changes[0]).toMatchObject({ toKg: 25, reason: "You did 20 reps on every set, above the top of 6-12. Next time: heavier, starting again at 6 reps" });
    expect(planNext([slot({ sets: [rs({}), rs({}), rs({})] })], done([at(20, 12), at(20, 12), at(20, 12, { done: false })]), D).changes).toEqual([]);
    expect(planNext([slot()], done([at(20, 12), at(20, 11)]), D).changes).toEqual([]);
  });

  it("60 kg 6/5/4 at 6-12: nothing changes the first time; the planned reps stay on the missed sets", () => {
    const heavy = slot({ sets: [rs({ weightKg: 60, reps: 6 }), rs({ weightKg: 60, reps: 6 }), rs({ weightKg: 60, reps: 6 })] });
    const r = planNext([heavy], done([at(60, 6), at(60, 5), at(60, 4)]), D);
    expect(view(r.exercises[0]!.sets)).toEqual([["normal", 60, 6], ["normal", 60, 6], ["normal", 60, 6]]);
    expect(r.changes).toEqual([]);
    expect(r.exercises[0]!.missed).toBe(1);
    // the third time in a row: one step lighter, with the reason
    const third = planNext([{ ...heavy, missed: 2 }], done([at(60, 6), at(60, 5), at(60, 4)]), { ...D, mode: "auto" });
    expect(third.changes[0]).toMatchObject({ direction: "down", fromKg: 60, toKg: 55, fromReps: 5, reps: 6 });
    expect(third.changes[0]!.reason).toBe("Below 6 reps, the bottom of 6-12, 3 workouts in a row. Next time: lighter");
    expect(third.exercises[0]!.missed).toBe(0);
    // never lowered when set so
    expect(planNext([{ ...heavy, missed: 9 }], done([at(60, 4)]), { ...D, lowerAfter: 0 }).changes).toEqual([]);
  });

  it("starts the missed count again when a lower is not applied, and counts nothing while Progression is Off", () => {
    const r = planNext([slot({ missed: 2 })], done([at(20, 4), at(20, 8)]), D);
    expect(r.changes[0]!.direction).toBe("down");
    expect(r.exercises[0]!.missed).toBe(0);
    expect(planNext([slot({ missed: 2 })], done([at(20, 4)]), { ...D, mode: "off" }).exercises[0]!.missed).toBe(0);
    expect(planNext([slot()], done([at(20, 12), at(20, 12)]), { ...D, mode: "off" }).changes).toEqual([]);
  });

  it("drop sets take today's numbers, never decide, and move with their set when its weight goes up", () => {
    const withDrop = slot({ sets: [rs({}), rs({ kind: "drop", reps: 10, weightKg: 15 })] });
    const r = planNext([withDrop], done([at(20, 12), at(15, 3, { kind: "drop" })]), D, ["re1"]);
    // 20 x 12: 28 kg one-rep max, 23.3 kg for 6: 25 kg; the drop moves by the same 5 kg, its reps as planned
    expect(view(r.exercises[0]!.sets)).toEqual([["normal", 25, 6], ["drop", 20, 10]]);
  });

  it("assisted exercises move the help the other way, one step", () => {
    const r = planNext([slot({ sets: [rs({ weightKg: 30 })] })], done([at(30, 12)], { tracking: "assisted" }), D, ["re1"]);
    expect(r.changes[0]).toMatchObject({ fromKg: 30, toKg: 25, reps: 6 });
  });

  it("bodyweight and timed exercises only take today's numbers; a rep target missed stays", () => {
    const bw = slot({ sets: [rs({ weightKg: null, reps: 10 })] });
    expect(planNext([bw], done([at(null as any, 15)], { tracking: "reps" }), D).exercises[0]!.sets).toMatchObject([{ reps: 15 }]);
    expect(planNext([bw], done([at(null as any, 7)], { tracking: "reps" }), D).exercises[0]!.sets).toMatchObject([{ reps: 10 }]);
    const timed = slot({ sets: [rs({ reps: null, weightKg: null, durationS: 60 })] });
    const r = planNext([timed], done([set({ durationS: 75 })], { tracking: "duration" }), D);
    expect(r.exercises[0]!.sets).toMatchObject([{ durationS: 75 }]);
    expect(r.changes).toEqual([]);
  });

  it("leaves fixed, skipped and swapped-away exercises alone", () => {
    expect(planNext([slot({ fixed: true })], done([at(20, 12), at(20, 12)]), D).exercises[0]!.sets).toEqual(slot().sets);
    expect(planNext([slot()], done([at(20, 12), at(20, 12)], { status: "skipped" }), D).changes).toEqual([]);
    expect(planNext([slot()], done([at(20, 12), at(20, 12)], { exerciseId: "other" }), D).changes).toEqual([]);
  });

  it("keeps a rep range of its own only with both ends, and turns an old rule into its own Automatic", () => {
    expect(cleanProgression({ mode: null, repsMin: 8, repsMax: null, stepKg: null, lowerAfter: null })).toBeNull();
    expect(cleanProgression({ repsMin: 12, repsMax: 8 })).toBeNull();
    expect(cleanProgression({ repsMin: 8, repsMax: 12 })).toEqual({ mode: null, repsMin: 8, repsMax: 12, stepKg: null, lowerAfter: null });
    expect(cleanProgression({ kind: "linear", incrementKg: 5, deloadAfter: 2 })).toEqual({ mode: "auto", repsMin: null, repsMax: null, stepKg: 5, lowerAfter: 2 });
  });

  it("steps land on the step's grid", () => {
    expect([stepUp(46, 2.5), stepUp(47.5, 2.5), stepDown(46, 2.5), stepDown(1, 2.5)]).toEqual([47.5, 50, 42.5, 0]);
    // off the grid: onto it, and always at least a little up
    expect([stepUp(21.3, 2.5), stepUp(20, 2.27), stepDown(21.3, 2.5)]).toEqual([25, 22.7, 20]);
    // the exercise's own step is the grid: 21.3 kg at 20 reps (past the estimate, one step) lands on 2 kg steps
    const w2 = done([at(21.3, 20), at(21.3, 20)]);
    (w2.exercises[0]!.exercise as { incrementKg?: number }).incrementKg = 2;
    expect(planNext([slot()], w2, D).changes[0]).toMatchObject({ fromKg: 21.3, toKg: 24 });
  });

  it("pairs routine sets by place, so an unticked middle set keeps its own numbers", () => {
    const three = slot({ sets: [rs({ kind: "warmup", reps: 10, weightKg: 10 }), rs({}), rs({}), rs({})] });
    const r = planNext([three], done([warm(), at(22.5, 10), at(30, 3, { done: false }), at(25, 9)]), D);
    expect(view(r.exercises[0]!.sets)).toEqual([["warmup", 15, 10], ["normal", 22.5, 10], ["normal", 20, 8], ["normal", 25, 9]]);
    expect(r.changes).toEqual([]);
  });

  it("pairs drops with drops only: a ticked drop set never gives a working set its weight", () => {
    const withDrop = slot({ sets: [rs({ kind: "warmup", reps: 10, weightKg: 10 }), rs({}), rs({ kind: "drop", reps: 10, weightKg: 15 })] });
    const r = planNext([withDrop], done([warm(), at(20, 8, { done: false }), at(12, 10, { kind: "drop" })]), D);
    expect(view(r.exercises[0]!.sets)).toEqual([["warmup", 15, 10], ["normal", 20, 8], ["drop", 12, 10]]);
    expect(r.changes).toEqual([]);
  });

  it("on a lower the drop sets come down with their set; a working set with no weight stops the drop after it from following", () => {
    const auto = { mode: "auto", repsMin: null, repsMax: null, stepKg: null, lowerAfter: null };
    const withDrop = slot({ missed: 2, progression: auto, sets: [rs({}), rs({ kind: "drop", reps: 10, weightKg: 15 })] });
    const down = planNext([withDrop], done([at(20, 4), at(15, 12, { kind: "drop" })]), D);
    // one 5 kg step lighter, the drop by the same 5 kg; the planned reps stay
    expect(down.changes[0]).toMatchObject({ direction: "down", fromKg: 20, toKg: 15 });
    expect(view(down.exercises[0]!.sets)).toEqual([["normal", 15, 8], ["drop", 10, 10]]);
    const bare = slot({ missed: 2, progression: auto, sets: [rs({}), rs({ weightKg: null }), rs({ kind: "drop", reps: 10, weightKg: 14 })] });
    const nw = planNext([bare], done([at(20, 4), set({ done: false }), at(14, 10, { kind: "drop" })]), D);
    expect(nw.exercises[0]!.sets.map((x: any) => x.weightKg)).toEqual([15, null, 14]);
  });

  it("an unticked set doesn't block a miss; a workout inside the range starts the missed count again", () => {
    const miss = planNext([slot({ missed: 2 })], done([warm(), at(20, 4), set({ weightKg: 20, done: false })]), D);
    expect(miss.changes[0]).toMatchObject({ direction: "down", reason: "Below 6 reps, the bottom of 6-12, 3 workouts in a row. Next time: lighter" });
    expect(planNext([slot({ missed: 2 })], done([warm(), at(20, 8), at(20, 9)]), D).exercises[0]!.missed).toBe(0);
  });

  it("applies a lower only when accepted (Suggest), and the missed count starts again either way", () => {
    const miss = done([warm(), at(20, 4), at(20, 5)]);
    expect(planNext([slot({ missed: 2 })], miss, D).exercises[0]).toMatchObject({ missed: 0, sets: [{ weightKg: 15 }, { weightKg: 20 }, { weightKg: 20 }] });
    expect(planNext([slot({ missed: 2 })], miss, D, ["re1"]).exercises[0]).toMatchObject({ missed: 0, sets: [{ weightKg: 15 }, { weightKg: 15 }, { weightKg: 15 }] });
  });

  it("says the numbers didn't change when today matched the routine", () => {
    const same = () => set({ kind: "warmup", weightKg: 10, reps: 10 });
    expect(planNext([slot()], done([same(), at(20, 8), at(20, 8)]), D).numbersChanged).toBe(false);
    expect(planNext([slot()], done([same(), at(20, 9), at(20, 8)]), D).numbersChanged).toBe(true);
    // a heavier warm-up is a change too
    expect(planNext([slot()], done([warm(), at(20, 8), at(20, 8)]), D).numbersChanged).toBe(true);
  });

  // a first workout of a new routine (no weight, 8 reps planned), sets added, 46 kg x 12 on every left and right set:
  // the added sets come from applyStructure, today's numbers become the routine's, then Progression goes up on the one
  // side step (2.5 kg) from what was done, reps back to the bottom
  it("a first workout with left and right sets: applyStructure adds the sets, planNext moves them all up together", () => {
    const blank = rs({ reps: 8, weightKg: null });
    const r0 = { id: "re1", exerciseId: "x", fixed: false, progression: { mode: "auto" }, missed: 0, sets: [blank, blank, blank] };
    const w = done([1, 2, 3].flatMap(() => [at(46, 12, { side: "L" }), at(46, 12, { side: "R" })]));
    // three sets for both sides together became left and right ones: a change of sets, not only more of them
    expect(structureChanges({ exercises: [r0] }, w).map((c) => c.key)).toEqual(["sets:re1"]);
    const shaped = applyStructure({ exercises: [r0] }, w, ["sets:re1"]) as typeof r0[];
    expect(shaped[0]!.sets).toHaveLength(6);
    const r = planNext(shaped, w, D);
    expect(r.exercises[0]!.sets.map((x: any) => [x.weightKg, x.reps])).toEqual(Array(6).fill([52.5, 6]));
    expect(r.changes[0]).toMatchObject({ mode: "auto", direction: "up", fromKg: 46, toKg: 52.5, fromReps: 12, reps: 6 });
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
      ["more:rc", "changed", "Add 1 set to C", "You did 2 sets · the routine has 1 set"],
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

// The developer's report: a routine of 3 sets with no weights; in the workout set 1 made a warm-up with a weight, a
// working set added, then a left and a right set, everything ticked. Finish must list it (off), save nothing of the
// layout unasked, and carry the warm-up's weight either way.
describe("a workout with sets added, made warm-ups and split into sides", () => {
  const D = { mode: "suggest" as const, repsMin: 6, repsMax: 12, stepKg: 5, stepOneSideKg: 2.5, lowerAfter: 3 };
  const blank = (p: Record<string, unknown> = {}) => ({ kind: "normal", reps: 8, weightKg: null, durationS: null, distanceM: null, side: null, ...p });
  const view = (sets: unknown[]) => (sets as RoutineSetLike[]).map((s) => [s.kind, s.side ?? "", s.weightKg, s.reps]);
  const today = () => ({ exercises: [ex({ name: "Curl", exerciseId: "x", routineExerciseId: "re1", sets: [
    set({ kind: "warmup", weightKg: 10, reps: 12 }), set({ weightKg: 20, reps: 8 }), set({ weightKg: 20, reps: 8 }), set({ weightKg: 20, reps: 8 }),
    set({ weightKg: 10, reps: 10, side: "L" }), set({ weightKg: 10, reps: 10, side: "R" })] })] });
  const routine = () => ({ exercises: [{ id: "re1", exerciseId: "x", exercise: { name: "Curl" }, fixed: false, progression: null, missed: 0, sets: [blank(), blank(), blank()] }] });

  // set 1 made a warm-up and a working set added reads as a warm-up in front of the routine's 3 sets
  it("lists the sets added by kind and side, with a switch that starts off", () => {
    expect(structureChanges(routine(), today()).map((c) => [c.key, c.group, c.text, c.action])).toEqual([
      ["more:re1", "changed", "Add 1 warm-up, 1 left set and 1 right set to Curl", "You did 1 warm-up, 3 sets, 1 left set and 1 right set · the routine has 3 sets"]]);
    expect(applyStructure(routine(), today(), [])).toBeNull();
  });

  it("not switched on: the routine keeps its 3 sets, which take today's working numbers (the warm-up has no place)", () => {
    const r = planNext(routine().exercises, today(), D);
    expect(view(r.exercises[0]!.sets)).toEqual([["normal", "", 20, 8], ["normal", "", 20, 8], ["normal", "", 20, 8]]);
  });

  it("switched on: the routine gets today's sets, the warm-up and the sides with today's weights", () => {
    const shaped = applyStructure(routine(), today(), ["more:re1"]) as ReturnType<typeof routine>["exercises"];
    const r = planNext(shaped, today(), D);
    expect(view(r.exercises[0]!.sets)).toEqual([["warmup", "", 10, 12], ["normal", "", 20, 8], ["normal", "", 20, 8], ["normal", "", 20, 8],
      ["normal", "L", 10, 10], ["normal", "R", 10, 10]]);
  });

  it("a set made a warm-up with nothing added is listed as a change of sets, and a routine warm-up takes today's weight", () => {
    // the routine already has a warm-up: its weight follows today's, with no switch needed
    const withWarm = { exercises: [{ ...routine().exercises[0]!, sets: [blank({ kind: "warmup", reps: 10 }), blank(), blank(), blank()] }] };
    const w = today();
    w.exercises[0]!.sets = w.exercises[0]!.sets.slice(0, 4);
    expect(structureChanges(withWarm, w)).toEqual([]);
    expect(view(planNext(withWarm.exercises, w, D).exercises[0]!.sets)[0]).toEqual(["warmup", "", 10, 12]);
    // 3 working sets in the routine, today the first made a warm-up: listed, and only saved when switched on
    const w2 = today();
    w2.exercises[0]!.sets = w2.exercises[0]!.sets.slice(0, 3);
    const ch = structureChanges(routine(), w2);
    expect(ch.map((c) => [c.key, c.text, c.action])).toEqual([["sets:re1", "Use this workout's sets for Curl", "You did 1 warm-up and 2 sets · the routine has 3 sets"]]);
    expect(view(planNext(routine().exercises, w2, D).exercises[0]!.sets).map((x) => x[0])).toEqual(["normal", "normal", "normal"]);
    const on = applyStructure(routine(), w2, ["sets:re1"]) as ReturnType<typeof routine>["exercises"];
    expect(view(planNext(on, w2, D).exercises[0]!.sets)).toEqual([["warmup", "", 10, 12], ["normal", "", 20, 8], ["normal", "", 20, 8]]);
  });

  it("sets left out are listed as not done, whichever ones they were", () => {
    const withWarm = { exercises: [{ ...routine().exercises[0]!, sets: [blank({ kind: "warmup" }), blank(), blank()] }] };
    const w = { exercises: [ex({ name: "Curl", exerciseId: "x", routineExerciseId: "re1", sets: [set({ kind: "warmup", done: false }), set({ weightKg: 20, reps: 8 }), set({ weightKg: 20, reps: 8 })] })] };
    expect(structureChanges(withWarm, w).map((c) => [c.key, c.group, c.text])).toEqual([["fewer:re1", "notDone", "Remove 1 warm-up from Curl"]]);
    const out = applyStructure(withWarm, w, ["fewer:re1"]) as ReturnType<typeof routine>["exercises"];
    expect(out[0]!.sets.map((x) => x.kind)).toEqual(["normal", "normal"]);
  });
});

describe("the old routine settings", () => {
  it("are dropped from saved settings, and Progression gets its defaults", () => {
    const s = withDefaults({ workout: { updateRoutine: "always", prefillFromLast: false, prefillScope: "routine" }, features: { progression: true } });
    expect(["updateRoutine", "prefillFromLast", "prefillScope"].filter((k) => k in s.workout)).toEqual([]);
    expect("progression" in s.features).toBe(false);
    // a step not chosen is saved as not chosen (null), never as the default
    expect(s.progression).toEqual({ mode: "suggest", repsMin: 6, repsMax: 12, stepKg: null, stepOneSideKg: null, lowerAfter: 3 });
    expect(withDefaults({ progression: { mode: "nope", lowerAfter: 40, repsMin: 12, repsMax: 8, stepKg: -1 } }).progression).toEqual({ mode: "suggest", repsMin: 6, repsMax: 12, stepKg: null, stepOneSideKg: null, lowerAfter: 3 });
    expect(progressionDefaultsOf(s)).toMatchObject({ stepKg: 5, stepOneSideKg: 2.5 });
    // pounds: 10 lb and 5 lb unless chosen, also after settings saved in kg (what the server stores is withDefaults')
    const lb = progressionDefaultsOf(withDefaults({ ...withDefaults({}), units: { weight: "lb" } }));
    expect([lb.stepKg, lb.stepOneSideKg].map((x) => Math.round(x * 1000) / 1000)).toEqual([4.536, 2.268]);
    // one chosen stays, in either unit
    expect(progressionDefaultsOf(withDefaults({ units: { weight: "lb" }, progression: { stepKg: 2.5 } })).stepKg).toBe(2.5);
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
    const D = { mode: "suggest" as const, repsMin: 6, repsMax: 12, stepKg: 5, stepOneSideKg: 2.5, lowerAfter: 3 };
    const rs = (side: string | null, weightKg: number) => ({ kind: "normal", reps: 10, weightKg, durationS: null, distanceM: null, side });
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

describe("planSetRest", () => {
  const d = { betweenSetsS: 90, afterExerciseS: 150, byKindS: { failure: 150 } };
  const x = { restS: 120, restAfterS: 200, restByKind: { warmup: 45 }, routineSetRests: [null, 75, null] };
  const kinds = (...k: string[]) => k.map((kind) => ({ kind, side: null }));
  it("rests a set by its kind as it is now, so a set made a warm-up or to failure shows its new rest", () => {
    expect([0, 1, 2].map((i) => planSetRest(kinds("normal", "normal", "normal"), i, x, d))).toEqual([120, 75, 200]);
    expect(planSetRest(kinds("warmup", "normal", "normal"), 0, x, d)).toBe(45);
    expect(planSetRest(kinds("failure", "normal", "normal"), 0, x, d)).toBe(150);
    // none before a drop set, and the routine set's own rest stays through a change of kind
    expect(planSetRest(kinds("normal", "drop", "normal"), 0, x, d)).toBe(0);
    expect(planSetRest(kinds("normal", "warmup", "normal"), 1, x, d)).toBe(75);
  });
  it("rests a set made a warm-up as Settings does for warm-ups, not as the exercise's working sets (M-88)", () => {
    // the developer's case: exercise rest 2:00, Settings' warm-up rest 1:30, set or left at "Same as between sets 1:30"
    const ex2 = { restS: 120, restAfterS: null, restByKind: null, routineSetRests: [null, null, null] };
    for (const byKindS of [{ warmup: 90 }, {}]) {
      const d2 = { betweenSetsS: 90, afterExerciseS: 150, byKindS };
      expect(planSetRest(kinds("normal", "normal", "normal"), 0, ex2, d2)).toBe(120);
      expect(planSetRest(kinds("warmup", "normal", "normal"), 0, ex2, d2)).toBe(90);
    }
    // the routine's own warm-up rest still comes first
    expect(planSetRest(kinds("warmup", "normal", "normal"), 0, { ...ex2, restByKind: { warmup: 45 } }, { betweenSetsS: 90, afterExerciseS: 150, byKindS: {} })).toBe(45);
  });
  it("leaves the routine sets' own rests once a set was added, and takes the exercise's settings last", () => {
    expect(planSetRest(kinds("normal", "normal", "normal", "normal"), 1, x, d)).toBe(120);
    expect(planSetRest(kinds("normal", "normal"), 0, { prefRestS: 100 }, d)).toBe(100);
    expect(planSetRest(kinds("normal", "normal"), 0, {}, d, true)).toBe(150);
    expect(planSetRest([{ kind: "normal", side: "L" }, { kind: "normal", side: "R" }, { kind: "normal", side: null }], 0, x, d)).toBe(0);
  });
});
