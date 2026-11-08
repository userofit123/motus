import { describe, expect, it } from "vitest";
import { bestSet, workoutSoFar } from "./summary";
import type { WorkoutExercise, WorkoutSet } from "./types";

const set = (p: Partial<WorkoutSet>): WorkoutSet => ({ id: Math.random().toString(36), position: 0, kind: "normal", weightKg: null, reps: null, durationS: null, distanceM: null, rpe: null, rir: null, side: null, done: false, doneAt: null, restPlannedS: null, restActualS: null, targetReps: null, targetWeightKg: null, prefilled: false, ...p });
const ex = (tracking: string, status: string, sets: WorkoutSet[]) => ({ id: Math.random().toString(36), exercise: { name: tracking, tracking }, status, sets } as unknown as WorkoutExercise);

describe("workoutSoFar", () => {
  const w = { exercises: [
    ex("weight_reps", "done", [set({ kind: "warmup", weightKg: 40, reps: 10, done: true }), set({ weightKg: 80, reps: 8, done: true, targetReps: 8, pr: ["weight"] }), set({ weightKg: 85, reps: 7, done: true, targetReps: 8 })]),
    ex("assisted", "pending", [set({ weightKg: 20, reps: 8, done: true }), set({ weightKg: 30, reps: 8 })]),
    ex("weight_reps", "skipped", [set({ weightKg: 50, reps: 10 })]),
  ] };
  const r = workoutSoFar(w);
  it("counts done against planned, leaving skipped exercises out", () => {
    expect([r.exercisesDone, r.exercisesTotal, r.setsDone, r.setsPlanned]).toEqual([1, 2, 4, 5]);
  });
  it("adds volume from working sets only, and none for assisted help", () => {
    expect(r.volumeKg).toBe(80 * 8 + 85 * 7);
  });
  it("counts records and rep targets", () => {
    expect([r.records, r.targets, r.targetsHit]).toEqual([1, 2, 1]);
  });
  it("picks the best set by estimated 1RM, and the least help when assisted", () => {
    expect(r.perExercise[0]!.best?.weightKg).toBe(85);
    expect(bestSet([set({ weightKg: 30, reps: 8, done: true }), set({ weightKg: 20, reps: 8, done: true })], "assisted")?.weightKg).toBe(20);
    expect(bestSet([set({ reps: 8 })], "reps_only")).toBeNull();
  });
});
