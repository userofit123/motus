import { describe, expect, it } from "vitest";
import { bestSet, workoutScore, workoutSoFar } from "./summary";
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
  it("never counts more sets done than planned when a skipped exercise had sets done", () => {
    const s = workoutSoFar({ exercises: [ex("weight_reps", "pending", [set({ weightKg: 60, reps: 5, done: true }), set({ weightKg: 60, reps: 5 })]), ex("weight_reps", "skipped", [set({ weightKg: 50, reps: 10, done: true })])] });
    expect([s.setsDone, s.setsPlanned]).toEqual([1, 2]);
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

describe("workoutScore", () => {
  const prev = (weightKg: number | null, reps: number | null) => ({ weightKg, reps, durationS: null, distanceM: null });
  it("compares each exercise's best set and volume with last time", () => {
    const s = workoutScore({ exercises: [
      // heavier best set: up
      ex("weight_reps", "done", [set({ weightKg: 85, reps: 8, done: true, targetReps: 8, targetWeightKg: 85, prev: prev(80, 8) }), set({ weightKg: 85, reps: 8, done: true, targetReps: 8, targetWeightKg: 85, prev: prev(80, 8) })]),
      // same best set, one set fewer: down by volume
      ex("weight_reps", "partial", [set({ weightKg: 50, reps: 10, done: true, targetReps: 10, prev: prev(50, 10) }), set({ weightKg: 50, reps: 10, targetReps: 10, prev: prev(50, 10) })]),
      // more help taken than last time: down (less is better when assisted)
      ex("assisted", "done", [set({ weightKg: 30, reps: 8, done: true, prev: prev(20, 8) })]),
      // new exercise: not compared
      ex("reps_only", "done", [set({ reps: 20, done: true })]),
    ] });
    expect(Object.values(s.vsLast)).toEqual(["up", "down", "down"]);
    expect(s.last).toMatchObject({ compared: 3, improved: 1, dropped: 2, verdict: "worse", volumeKg: 85 * 16 + 500, lastVolumeKg: 80 * 16 + 1000 });
    expect(s.last!.volumePct).toBe(Math.round(((85 * 16 + 500) / (80 * 16 + 1000) - 1) * 100));
    expect(s.plan).toMatchObject({ setsDone: 5, setsPlanned: 6, repTargets: 3, repTargetsHit: 3, weightTargets: 2, weightTargetsHit: 2, verdict: "most" });
  });
  it("settles a tie by volume and says the whole plan was done", () => {
    const s = workoutScore({ exercises: [ex("weight_reps", "done", [set({ weightKg: 60, reps: 5, done: true, targetReps: 5, prev: prev(60, 5) }), set({ weightKg: 60, reps: 5, done: true, targetReps: 5, prev: prev(60, 4) })])] });
    expect(s.vsLast).toEqual({ [Object.keys(s.vsLast)[0]!]: "up" });
    expect(s.last?.verdict).toBe("better");
    expect(s.plan.verdict).toBe("all");
  });
  it("has nothing to compare the first time", () => {
    const s = workoutScore({ exercises: [ex("weight_reps", "done", [set({ weightKg: 60, reps: 5, done: true })]), ex("weight_reps", "skipped", [set({ weightKg: 60, reps: 5, prev: prev(60, 5) })])] });
    expect(s.last).toBeNull();
    expect(s.plan).toMatchObject({ skipped: 1, verdict: "most" });
  });
});
