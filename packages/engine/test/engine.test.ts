// The engine end to end on PGlite: a routine, a workout with pre-filled values, reminders, notes, goals, records,
// export/import, and above all that one person can never see or change another's data.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";

let eng: Engine;
let A: string, B: string;
const call = async (user: string, method: string, path: string, body?: unknown, query?: Record<string, string>) => {
  const r = await eng.handle({ method, path, body, query, userId: user });
  if (r.status !== 200) throw Object.assign(new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`), { status: r.status });
  return r.body as any;
};
const status = async (user: string, method: string, path: string, body?: unknown) => (await eng.handle({ method, path, body, userId: user })).status;

beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"), { mode: "server" });
  A = uuidv7(); B = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'a','A'), ($2,'b','B')", [A, B]);
}, 120000);

describe("engine", () => {
  it("seeds the exercise library", async () => {
    const list = await call(A, "GET", "/exercises");
    expect(list.length).toBeGreaterThan(800);
    expect(list.find((e: any) => e.name === "Barbell Squat")).toBeTruthy();
  });

  let routineId = "", benchId = "", workoutId = "";
  it("creates a routine from a template", async () => {
    const r = await call(A, "POST", "/routines", { template: "push" });
    routineId = r.id;
    const full = await call(A, "GET", `/routines/${routineId}`);
    expect(full.exercises.length).toBe(5);
    benchId = full.exercises[0].exerciseId;
    const list = await call(A, "GET", "/routines");
    expect(list[0].estimateS).toBeGreaterThan(600);
  });

  it("starts, logs and finishes a workout", async () => {
    const w = await call(A, "POST", "/workouts/start", { routineId });
    workoutId = w.id;
    expect(w.status).toBe("in_progress");
    const bench = w.exercises[0];
    for (const [i, s] of bench.sets.entries()) await call(A, "PUT", `/workout-sets/${s.id}`, { weightKg: 80, reps: 8 - i, done: true });
    await call(A, "PUT", `/workout-exercises/${w.exercises[1].id}`, { status: "skipped", skipReason: "Equipment busy" });
    await call(A, "POST", "/notes", { targetType: "exercise", targetId: benchId, body: "Felt strong", workoutId, pinned: true });
    await call(A, "POST", "/reminders", { targetType: "exercise", targetId: benchId, body: "Go up 2.5 kg", action: { weightKg: 2.5 }, workoutId });
    await call(A, "POST", `/workouts/${workoutId}/finish`, {});
    const done = await call(A, "GET", `/workouts/${workoutId}`);
    expect(done.status).toBe("completed");
    expect(done.exercises[1].status).toBe("skipped");
    expect(done.report.totals.volumeKg).toBe(80 * (8 + 7 + 6 + 5));
  });

  it("pre-fills the next workout from last time, with the reminder applied", async () => {
    const prev = await call(A, "GET", `/routines/${routineId}/preview`);
    const bench = prev.exercises[0];
    expect(bench.sets[0].weightKg).toBe(82.5); // 80 + reminder
    expect(bench.sets[1].reps).toBe(7);
    expect(bench.sets[0].prev.weightKg).toBe(80);
    expect(bench.reminders.length).toBe(1);
    expect(bench.notes[0].body).toBe("Felt strong");
    expect(prev.estimate.totalS).toBeGreaterThan(0);
  });

  it("detects records against earlier sessions", async () => {
    const w = await call(A, "POST", "/workouts/start", { routineId });
    const s = w.exercises[0].sets[0];
    await call(A, "PUT", `/workout-sets/${s.id}`, { weightKg: 85, reps: 8, done: true });
    const live = await call(A, "GET", "/workouts/active");
    expect(live.exercises[0].sets[0].pr).toContain("weight");
    await call(A, "POST", `/workouts/${w.id}/finish`, {});
    const hist = await call(A, "GET", `/exercises/${benchId}/history`);
    expect(hist.sessions.length).toBe(2);
    expect(hist.records.maxWeight.value).toBe(85);
    expect(hist.sessions[0].position).toBe(1);
  });

  it("tracks goals", async () => {
    await call(A, "POST", "/goals", { metric: "max_weight", scopeId: benchId, target: 100 });
    await call(A, "POST", "/goals", { metric: "workouts", period: "week", target: 3 });
    const goals = await call(A, "GET", "/goals");
    const g = goals.find((x: any) => x.metric === "max_weight");
    expect(g.progress.current).toBe(85);
    expect(g.progress.pct).toBeCloseTo(0.85);
  });

  it("builds the home summary, stats and calendar", async () => {
    const home = await call(A, "GET", "/home");
    expect(home.last.name).toBe("Push");
    expect(home.goals.length).toBe(2);
    const stats = await call(A, "GET", "/stats");
    expect(stats.workouts.length).toBe(2);
    expect(stats.muscles.chest).toBeGreaterThan(0);
    const today = new Date().toISOString().slice(0, 10);
    const cal = await call(A, "GET", "/calendar", undefined, { from: today, to: today });
    expect(cal.workouts.length).toBe(2);
  });

  it("keeps people's data apart", async () => {
    // B sees none of A's things
    expect((await call(B, "GET", "/routines")).length).toBe(0);
    expect(await call(B, "GET", "/workouts/active")).toBe(null);
    expect((await call(B, "GET", "/workouts")).length).toBe(0);
    expect((await call(B, "GET", "/goals")).length).toBe(0);
    expect(await status(B, "GET", `/routines/${routineId}`)).toBe(404);
    expect(await status(B, "GET", `/workouts/${workoutId}`)).toBe(404);
    // and cannot change them
    await call(B, "DELETE", `/routines/${routineId}`);
    await call(B, "DELETE", `/workouts/${workoutId}`);
    expect((await call(A, "GET", "/routines")).length).toBe(1);
    expect((await call(A, "GET", `/workouts/${workoutId}`)).id).toBe(workoutId);
    // nor point their own rows at A's
    expect(await status(B, "POST", "/notes", { targetType: "workout", targetId: workoutId, body: "x", workoutId })).toBe(400);
    // raw SQL as B through the row-level security
    const { withUser } = await import("../src/db");
    for (const t of ["workouts", "workout_sets", "routines", "notes", "reminders", "goals", "events"]) {
      const n = await withUser(eng.db, B, async (q) => Number((await q.query(`SELECT count(*) n FROM ${t} WHERE user_id <> $1`, [B])).rows[0].n));
      expect(n, t).toBe(0);
    }
    const n = await withUser(eng.db, B, async (q) => Number((await q.query("SELECT count(*) n FROM users")).rows[0].n));
    expect(n).toBe(1);
    // custom exercises are private
    const ex = await call(A, "POST", "/exercises", { name: "My secret lift", primaryMuscles: ["chest"] });
    expect((await call(B, "GET", "/exercises")).some((e: any) => e.id === ex.id)).toBe(false);
  });

  it("exports and imports", async () => {
    const data = await call(A, "GET", "/export");
    expect(data.tables.workouts.length).toBe(2);
    const res = await call(B, "POST", "/import", { data, mode: "merge" });
    expect(res.workouts).toBe(0); // same ids already exist (in A's rows), so a merge skips them
    const C = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username) VALUES ($1,'c')", [C]);
    // a fresh person restoring with replace gets new copies only when ids are free; A still owns these ids
    const after = await call(A, "GET", "/workouts");
    expect(after.length).toBe(2);
  });

  it("imports a Strong CSV", async () => {
    const csv = `Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2024-05-01 18:00:00,Evening,1h 0m,Bench Press (Barbell),1,60,10,0,0,,,
2024-05-01 18:00:00,Evening,1h 0m,Bench Press (Barbell),2,65,8,0,0,,,
2024-05-01 18:00:00,Evening,1h 0m,Mystery Move,1,10,10,0,0,,,`;
    const prev = await call(B, "POST", "/import/csv/preview", { text: csv });
    expect(prev.format).toBe("Strong");
    expect(prev.workouts).toBe(1);
    const res = await call(B, "POST", "/import/csv", { text: csv, mapping: {} });
    expect(res.workouts).toBe(1);
    expect((await call(B, "GET", "/workouts")).length).toBe(1);
  });
});
