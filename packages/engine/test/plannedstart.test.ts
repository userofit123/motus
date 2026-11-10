// Starting a workout planned on the spot ("Empty workout" → plan → Start): exercises and sets sent with the start,
// filled the same way as a routine (last time's numbers, rests, supersets) but without creating one.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import { planSetRest, restDefaultsOf, withDefaults } from "@motus/shared";

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

  it("plans the rest again when a set changes kind or the exercise gets a new rest", async () => {
    const r = await call("POST", "/routines", { name: "Kinds", exercises: [{ exerciseId: bench, restS: 120, restAfterS: 200, restByKind: { warmup: 45 }, sets: [
      { kind: "normal", reps: 8 }, { kind: "normal", reps: 8 }, { kind: "normal", reps: 8 }] }] });
    const w = await call("POST", "/workouts/start", { routineId: r.id });
    const rests = async () => (await call("GET", "/workouts/active")).exercises[0].sets.map((s: any) => s.restPlannedS);
    const [a, b] = w.exercises[0].sets;
    expect(await rests()).toEqual([120, 120, 200]);
    // made a warm-up after it was done: it rests as the routine's warm-ups do (a rest may be running after it)
    await call("PUT", `/workout-sets/${a.id}`, { done: true, kind: "normal" });
    await call("PUT", `/workout-sets/${a.id}`, { kind: "warmup" });
    expect(await rests()).toEqual([45, 120, 200]);
    // the workout carries what the rests are planned from, so the screen works out the same rest before the server's
    // copy is back: the set made to failure (no rest by kind for it) rests as normal sets, made a warm-up as warm-ups
    const ae = (await call("GET", "/workouts/active")).exercises[0];
    expect(ae.restByKind).toEqual({ warmup: 45 });
    expect(ae.routineSetRests).toEqual([null, null, null]);
    const d = restDefaultsOf(withDefaults({}).workout);
    expect(ae.sets.map((_: any, i: number) => planSetRest(ae.sets, i, ae, d))).toEqual([45, 120, 200]);
    // ticking sends the kind again: nothing changes
    await call("PUT", `/workout-sets/${b.id}`, { restPlannedS: 33 });
    await call("PUT", `/workout-sets/${b.id}`, { done: false, kind: "normal" });
    expect(await rests()).toEqual([45, 33, 200]);
    // back to "as planned"
    await call("PUT", `/workout-sets/${b.id}`, { restPlannedS: null });
    expect(await rests()).toEqual([45, 120, 200]);
    // a new rest between sets counts for the sets still to do, not the one done
    await call("PUT", `/workout-exercises/${w.exercises[0].id}`, { restS: 60 });
    expect(await rests()).toEqual([45, 60, 200]);
    await call("POST", `/workouts/${w.id}/discard`, {});
    await call("DELETE", `/routines/${r.id}`);
  });

  it("keeps the routine set's own rest through a change of kind, and \"as planned\" brings it back", async () => {
    const r = await call("POST", "/routines", { name: "Own rest", exercises: [{ exerciseId: bench, restS: 120, restAfterS: 200, restByKind: { warmup: 45 }, sets: [
      { kind: "normal", reps: 8, restS: 75 }, { kind: "normal", reps: 8 }, { kind: "normal", reps: 8 }] }] });
    const w = await call("POST", "/workouts/start", { routineId: r.id });
    const rests = async () => (await call("GET", "/workouts/active")).exercises[0].sets.map((s: any) => s.restPlannedS);
    const [a] = w.exercises[0].sets;
    expect(await rests()).toEqual([75, 120, 200]);
    await call("PUT", `/workout-sets/${a.id}`, { kind: "warmup" });
    expect(await rests()).toEqual([75, 120, 200]);
    await call("PUT", `/workout-sets/${a.id}`, { restPlannedS: 33 });
    await call("PUT", `/workout-sets/${a.id}`, { restPlannedS: null });
    expect(await rests()).toEqual([75, 120, 200]);
    await call("PUT", `/workout-exercises/${w.exercises[0].id}`, { restS: 60 });
    expect(await rests()).toEqual([75, 60, 200]);
    await call("POST", `/workouts/${w.id}/discard`, {});
    await call("DELETE", `/routines/${r.id}`);
  });

  it("gives the set before a drop set no rest, and its rest back when the drop set becomes a normal one", async () => {
    const r = await call("POST", "/routines", { name: "Drops", exercises: [{ exerciseId: bench, restS: 120, restAfterS: 200, sets: [
      { kind: "normal", reps: 8 }, { kind: "drop", reps: 8 }, { kind: "normal", reps: 8 }] }] });
    const w = await call("POST", "/workouts/start", { routineId: r.id });
    const rests = async () => (await call("GET", "/workouts/active")).exercises[0].sets.map((s: any) => s.restPlannedS);
    const [a, b] = w.exercises[0].sets;
    expect((await rests())[0]).toBe(0);
    // done, with its rest possibly running: it follows all the same while the drop set is still to do
    await call("PUT", `/workout-sets/${a.id}`, { done: true, kind: "normal" });
    await call("PUT", `/workout-sets/${b.id}`, { kind: "normal" });
    expect(await rests()).toEqual([120, 120, 200]);
    await call("PUT", `/workout-sets/${b.id}`, { kind: "drop" });
    expect((await rests())[0]).toBe(0);
    // a rest set on the set before stays
    await call("PUT", `/workout-sets/${a.id}`, { restPlannedS: 50 });
    await call("PUT", `/workout-sets/${b.id}`, { kind: "normal" });
    expect((await rests())[0]).toBe(50);
    await call("POST", `/workouts/${w.id}/discard`, {});
    await call("DELETE", `/routines/${r.id}`);
  });

  it("plans the rests again in a workout started without a routine", async () => {
    const w = await call("POST", "/workouts/start", { exercises: [{ exerciseId: bench, restS: 100, restAfterS: 150, sets: [
      { kind: "normal", reps: 8 }, { kind: "normal", reps: 8 }, { kind: "normal", reps: 8 }] }] });
    const rests = async () => (await call("GET", "/workouts/active")).exercises[0].sets.map((s: any) => s.restPlannedS);
    const [, b] = w.exercises[0].sets;
    expect(await rests()).toEqual([100, 100, 150]);
    await call("PUT", `/workout-sets/${b.id}`, { kind: "drop" });
    expect((await rests())[0]).toBe(0);
    await call("PUT", `/workout-sets/${b.id}`, { kind: "normal" });
    await call("PUT", `/workout-exercises/${w.exercises[0].id}`, { restS: 80, restAfterS: 160 });
    expect(await rests()).toEqual([80, 80, 160]);
    await call("POST", `/workouts/${w.id}/discard`, {});
  });

  it("keeps a rest set on one set when the exercise gets a new rest", async () => {
    const r = await call("POST", "/routines", { name: "Kept", exercises: [{ exerciseId: bench, restS: 120, restAfterS: 200, sets: [
      { kind: "normal", reps: 8 }, { kind: "normal", reps: 8 }, { kind: "normal", reps: 8 }] }] });
    const w = await call("POST", "/workouts/start", { routineId: r.id });
    const rests = async () => (await call("GET", "/workouts/active")).exercises[0].sets.map((s: any) => s.restPlannedS);
    await call("PUT", `/workout-sets/${w.exercises[0].sets[1].id}`, { restPlannedS: 33 });
    await call("PUT", `/workout-exercises/${w.exercises[0].id}`, { restS: 60 });
    expect(await rests()).toEqual([60, 33, 200]);
    await call("POST", `/workouts/${w.id}/discard`, {});
    await call("DELETE", `/routines/${r.id}`);
  });

  it("stops matching the routine's own set rests by position once a set is added", async () => {
    const r = await call("POST", "/routines", { name: "Shifted", exercises: [{ exerciseId: bench, restS: 120, restAfterS: 200, sets: [
      { kind: "normal", reps: 8 }, { kind: "normal", reps: 8 }, { kind: "normal", reps: 8, restS: 90 }] }] });
    const w = await call("POST", "/workouts/start", { routineId: r.id });
    const rests = async () => (await call("GET", "/workouts/active")).exercises[0].sets.map((s: any) => s.restPlannedS);
    const [a, b] = w.exercises[0].sets;
    expect(await rests()).toEqual([120, 120, 90]);
    await call("POST", `/workout-exercises/${w.exercises[0].id}/sets`, { id: uuidv7(), afterId: a.id, kind: "drop", reps: 8, restPlannedS: 120 });
    // the old set 2 is now third: "as planned" must not give it routine set 3's own rest
    await call("PUT", `/workout-sets/${b.id}`, { restPlannedS: 33 });
    await call("PUT", `/workout-sets/${b.id}`, { restPlannedS: null });
    expect((await rests())[2]).toBe(120);
    await call("POST", `/workouts/${w.id}/discard`, {});
    await call("DELETE", `/routines/${r.id}`);
  });

  it("gives the set before a drop set added during the workout no rest, unless a rest was set on it", async () => {
    const r = await call("POST", "/routines", { name: "Added drop", exercises: [{ exerciseId: bench, restS: 120, restAfterS: 200, sets: [
      { kind: "normal", reps: 8 }, { kind: "normal", reps: 8 }] }] });
    const w = await call("POST", "/workouts/start", { routineId: r.id });
    const rests = async () => (await call("GET", "/workouts/active")).exercises[0].sets.map((s: any) => s.restPlannedS);
    const [a, b] = w.exercises[0].sets;
    // done, its rest may be running: the drop set comes straight after
    await call("PUT", `/workout-sets/${a.id}`, { done: true });
    await call("POST", `/workout-exercises/${w.exercises[0].id}/sets`, { id: uuidv7(), afterId: a.id, kind: "drop", reps: 8, restPlannedS: 120 });
    expect(await rests()).toEqual([0, 120, 200]);
    // the last set, rest set on it by hand: it keeps that rest
    await call("PUT", `/workout-sets/${b.id}`, { restPlannedS: 50 });
    await call("POST", `/workout-exercises/${w.exercises[0].id}/sets`, { id: uuidv7(), afterId: b.id, kind: "drop", reps: 8, restPlannedS: 50 });
    expect((await rests())[2]).toBe(50);
    await call("POST", `/workouts/${w.id}/discard`, {});
    await call("DELETE", `/routines/${r.id}`);
  });

  it("refuses an exercise that isn't there", async () => {
    expect(await status("POST", "/workouts/start", { exercises: [{ exerciseId: uuidv7(), sets: [] }] })).toBe(400);
    expect(await status("POST", "/workouts/start", { exercises: [{ exerciseId: "nope", sets: [] }] })).toBe(400);
    expect(await call("GET", "/workouts/active")).toBeNull();
  });
});
