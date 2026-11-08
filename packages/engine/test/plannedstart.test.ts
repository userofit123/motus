// Starting a workout planned on the spot ("Empty workout" → plan → Start): exercises and sets sent with the start,
// filled the same way as a routine (last time's numbers, rests, supersets) but without creating one.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";

let eng: Engine, U: string;
const call = async (method: string, path: string, body?: unknown) => {
  const r = await eng.handle({ method, path, body, userId: U });
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const status = async (method: string, path: string, body?: unknown) => (await eng.handle({ method, path, body, userId: U })).status;
let bench = "", row = "";
beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"));
  U = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username) VALUES ($1, 'u')", [U]);
  const list = await call("GET", "/exercises");
  bench = list.find((e: any) => e.name === "Barbell Bench Press")?.id ?? list[0].id;
  row = list.find((e: any) => e.id !== bench && e.tracking === "weight_reps").id;
}, 120000);

describe("starting a planned workout", () => {
  it("starts with the planned exercises, sets and rests, and no routine", async () => {
    const before = (await call("GET", "/routines")).length;
    const w = await call("POST", "/workouts/start", { name: "Monday", exercises: [
      { exerciseId: bench, restS: 120, restAfterS: 200, restByKind: { warmup: 45 }, sets: [
        { kind: "warmup", reps: 10, weightKg: 20 }, { kind: "normal", reps: 8, weightKg: 60 }, { kind: "normal", reps: 8, weightKg: 60, restS: 90 }, { kind: "normal", reps: 6, weightKg: 62.5 }] },
      { exerciseId: row, sets: [{ reps: 12 }] },
    ] });
    expect(w).toMatchObject({ name: "Monday", status: "in_progress", routineId: null });
    expect(w.exercises.map((e: any) => e.exerciseId)).toEqual([bench, row]);
    const b = w.exercises[0];
    expect(b.sets.map((s: any) => s.kind)).toEqual(["warmup", "normal", "normal", "normal"]);
    expect(b.sets.map((s: any) => s.weightKg)).toEqual([20, 60, 60, 62.5]);
    expect(b.sets.map((s: any) => s.restPlannedS)).toEqual([45, 120, 90, 200]);
    expect(w.exercises[1].sets[0]).toMatchObject({ kind: "normal", reps: 12 });
    expect((await call("GET", "/routines")).length).toBe(before);
    // finish it so the next start fills from it
    for (const e of w.exercises) for (const s of e.sets) await call("PUT", `/workout-sets/${s.id}`, { weightKg: 70, reps: 5, done: true });
    await call("POST", `/workouts/${w.id}/finish`, {});
  });

  it("fills from last time unless the numbers are fixed, and keeps supersets without rest inside a round", async () => {
    const w = await call("POST", "/workouts/start", { exercises: [
      { exerciseId: bench, superset: "A", sets: [{ reps: 8, weightKg: 40 }, { reps: 8, weightKg: 40 }] },
      { exerciseId: row, superset: "A", fixed: true, sets: [{ reps: 10, weightKg: 30 }] },
    ] });
    expect(w.name).toBe("Workout");
    expect(w.exercises[0].sets.map((s: any) => [s.weightKg, s.reps, s.prefilled])).toEqual([[70, 5, true], [70, 5, true]]);
    expect(w.exercises[0].sets.map((s: any) => s.restPlannedS)).toEqual([0, 0]);
    expect(w.exercises[1].sets[0]).toMatchObject({ weightKg: 30, reps: 10, prefilled: false });
    expect(w.exercises.map((e: any) => e.superset)).toEqual(["A", "A"]);
    await call("POST", `/workouts/${w.id}/discard`, {});
  });

  it("refuses an exercise that isn't there", async () => {
    expect(await status("POST", "/workouts/start", { exercises: [{ exerciseId: uuidv7(), sets: [] }] })).toBe(400);
    expect(await status("POST", "/workouts/start", { exercises: [{ exerciseId: "nope", sets: [] }] })).toBe(400);
    expect(await call("GET", "/workouts/active")).toBeNull();
  });
});
