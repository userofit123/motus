import { describe, expect, it } from "vitest";
import { applyStructure, readyForMore, stepUp, structureChanges } from "./nextTime";
import { withDefaults } from "./settings";
import type { WorkoutExercise, WorkoutSet } from "./types";

const set = (p: Partial<WorkoutSet>): WorkoutSet => ({ id: Math.random().toString(36), position: 0, kind: "normal", weightKg: null, reps: null, durationS: null, distanceM: null, rpe: null, rir: null, side: null, done: true, doneAt: null, restPlannedS: null, restActualS: null, targetReps: null, targetWeightKg: null, prefilled: false, ...p });
const ex = (p: Partial<WorkoutExercise> & { name?: string; tracking?: string }): WorkoutExercise =>
  ({ id: Math.random().toString(36), exerciseId: p.name ?? "x", routineExerciseId: null, status: "done", sets: [], ...p, exercise: { name: p.name ?? "x", tracking: p.tracking ?? "weight_reps" } }) as unknown as WorkoutExercise;
const range = (reps: number, weightKg = 20) => set({ weightKg, reps, targetReps: 8, targetRepsMax: 12 });

describe("readyForMore", () => {
  it("suggests one step up with reps back at the bottom when every set reached the top of the range", () => {
    const [m] = readyForMore({ exercises: [ex({ name: "Curl", sets: [set({ kind: "warmup", weightKg: 10, reps: 5, targetReps: 10 }), range(12), range(12, 22.5)] })] }, 2.5);
    expect(m).toMatchObject({ name: "Curl", fromKg: 22.5, toKg: 25, reps: 8, topReps: 12 });
  });
  it("waits while any set is short of the top, unticked, or without a target", () => {
    expect(readyForMore({ exercises: [ex({ sets: [range(12), range(11)] })] }, 2.5)).toEqual([]);
    expect(readyForMore({ exercises: [ex({ sets: [range(12), { ...range(12), done: false }] })] }, 2.5)).toEqual([]);
    expect(readyForMore({ exercises: [ex({ sets: [set({ weightKg: 20, reps: 12 })] })] }, 2.5)).toEqual([]);
  });
  it("uses the rep target when there is no range, and leaves out assisted and skipped exercises", () => {
    expect(readyForMore({ exercises: [ex({ sets: [set({ weightKg: 100, reps: 5, targetReps: 5 })] })] }, 2.5)[0]).toMatchObject({ toKg: 102.5, reps: 5 });
    expect(readyForMore({ exercises: [ex({ tracking: "assisted", sets: [range(12)] }), ex({ status: "skipped", sets: [range(12)] })] }, 2.5)).toEqual([]);
  });
  it("uses each exercise's own step when given, snaps to its grid, and leaves out exercises with no step", () => {
    const a = ex({ name: "A", sets: [range(12, 21)] }), b = ex({ name: "B", sets: [range(12, 20)] }), c = ex({ name: "C", sets: [range(12)] });
    const steps: Record<string, number | null> = { A: 2.5, B: 1, C: null };
    expect(readyForMore({ exercises: [a, b, c] }, (e) => steps[e.exercise.name]!).map((m) => [m.name, m.toKg])).toEqual([["A", 22.5], ["B", 21]]);
    expect(stepUp(22.5, 2.5)).toBe(25);
    expect(stepUp(21.3, 2.5)).toBe(25);
    expect(stepUp(20, 2.27)).toBe(22.7);
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
      ["more:rc", "changed", "C: 2 sets instead of 1", "Add 1 set to the routine"],
      ["swapped:rb", "changed", "Swapped: B for E", "Use E in the routine"],
      ["added:wf", "changed", "Added: F", "Add to the routine"],
      ["removed:rd", "changed", "Removed: D", "Remove from the routine"],
      ["order", "changed", "Exercises in a different order", "Use this session's order"],
      ["fewer:ra", "notDone", "A: 2 of 3 sets done", "Keep 2 sets in the routine"]]);
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
      .toEqual(["B (today: Y): 2 sets instead of 1", "A (today: X): 1 of 2 sets done"]);
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

describe("the old routine update setting", () => {
  it("is dropped from saved settings", () => {
    expect("updateRoutine" in withDefaults({ workout: { updateRoutine: "always", prefillFromLast: false } }).workout).toBe(false);
    expect(withDefaults({ workout: { updateRoutine: "always", prefillFromLast: false } }).workout.prefillFromLast).toBe(false);
  });
});
