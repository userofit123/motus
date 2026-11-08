import { describe, expect, it } from "vitest";
import { readyForMore, stepUp, structureChanges } from "./nextTime";
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
  it("lists added, removed, swapped, set counts and order; skipped exercises are not a change", () => {
    const w = { exercises: [
      ex({ name: "C", exerciseId: "C", routineExerciseId: "rc", sets: [set({})] }),
      ex({ name: "A", exerciseId: "A", routineExerciseId: "ra", sets: [set({}), set({}), set({ done: false })] }),
      ex({ name: "E", exerciseId: "E", routineExerciseId: "rb", sets: [set({})] }),
      ex({ name: "F", exerciseId: "F", sets: [set({})] })] };
    // D was taken out of the workout; B was swapped for E
    expect(structureChanges(routine, w).map((c) => c.text)).toEqual(["A: 2 sets instead of 3", "B becomes E", "Add F", "Remove D", "Exercises in today's order"]);
    const skipped = { exercises: [...routine.exercises.map((r) => ex({ name: r.exerciseId, exerciseId: r.exerciseId, routineExerciseId: r.id, status: r.id === "rb" ? "skipped" : "done", sets: r.sets.map(() => set({ done: r.id !== "rb" })) }))] };
    expect(structureChanges(routine, skipped)).toEqual([]);
  });
  it("treats an exercise with nothing ticked as skipped: kept as it was, or not added when new today", () => {
    const w = { exercises: [...routine.exercises.map((r) => ex({ name: r.exerciseId, exerciseId: r.exerciseId, routineExerciseId: r.id, status: "pending", sets: r.sets.map(() => set({ done: r.id !== "rb" })) })),
      ex({ name: "F", exerciseId: "F", status: "pending", sets: [set({ done: false })] })] };
    expect(structureChanges(routine, w)).toEqual([]);
  });
});

describe("the old routine update setting", () => {
  it("is dropped from saved settings", () => {
    expect("updateRoutine" in withDefaults({ workout: { updateRoutine: "always", prefillFromLast: false } }).workout).toBe(false);
    expect(withDefaults({ workout: { updateRoutine: "always", prefillFromLast: false } }).workout.prefillFromLast).toBe(false);
  });
});
