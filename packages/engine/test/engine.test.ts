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

  it("plans the rest after each kind of set, with a set's own rest first", async () => {
    const r = await call(A, "POST", "/routines", { name: "Rests", exercises: [{ exerciseId: benchId, restS: 120, restAfterS: 200, restByKind: { warmup: 45, drop: 0, bogus: 9 }, sets: [
      { kind: "warmup", reps: 10 }, { kind: "warmup", reps: 5, restS: 75 }, { kind: "normal", reps: 8 }, { kind: "drop", reps: 8 }, { kind: "failure", reps: 8 }, { kind: "normal", reps: 8 }] }] });
    const full = await call(A, "GET", `/routines/${r.id}`);
    expect(full.exercises[0].restByKind).toEqual({ warmup: 45, drop: 0 });
    const prev = await call(A, "GET", `/routines/${r.id}/preview`);
    expect(prev.exercises[0].sets.map((s: any) => s.restS)).toEqual([45, 75, 0, 0, 120, 200]); // no rest before a drop set
    // the person's default for a kind comes before the exercise's working-set rest
    await call(A, "PUT", "/settings", { workout: { restByKindS: { failure: 30, warmup: 99 } } });
    const prev2 = await call(A, "GET", `/routines/${r.id}/preview`);
    expect(prev2.exercises[0].sets.map((s: any) => s.restS)).toEqual([45, 75, 0, 0, 30, 200]);
    await call(A, "PUT", "/settings", { workout: { restByKindS: { failure: null, warmup: null } } });
    await call(A, "DELETE", `/routines/${r.id}`);
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

  it("says how long a routine usually takes from its last finished workouts, without pauses or given-up ones", async () => {
    // its own account, so these workouts don't change what the other tests count
    const D = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'d','D')", [D]);
    const r = await call(D, "POST", "/routines", { name: "Timed", exercises: [{ exerciseId: benchId, sets: [{ kind: "normal", reps: 8 }] }] });
    const before = (await call(D, "GET", "/routines")).find((x: any) => x.id === r.id);
    expect(before.usual).toBeNull();
    expect(before.estimateS).toBeGreaterThan(0);
    // newest first: 2 min (given up), 60 min with 5 min paused, 50 min, 60 min, and an hour that was discarded
    const add = (daysAgo: number, min: number, pausedS = 0, status = "completed") => eng.db.admin.query(
      "INSERT INTO workouts (id, user_id, routine_id, name, status, started_at, ended_at, paused_s) VALUES ($1,$2,$3,'Timed',$4, now() - make_interval(days => $5), now() - make_interval(days => $5) + make_interval(mins => $6), $7)",
      [uuidv7(), D, r.id, status, daysAgo, min, pausedS]);
    await add(1, 2); await add(2, 60, 300); await add(3, 50); await add(4, 60); await add(5, 60, 0, "discarded");
    const after = (await call(D, "GET", "/routines")).find((x: any) => x.id === r.id);
    expect(after.usual).toEqual({ s: (55 + 50 + 60) * 60 / 3, of: 3, newest: false });
    expect((await call(D, "GET", `/routines/${r.id}/preview`)).usual).toEqual(after.usual);
    // someone else sees neither the routine nor its times
    expect((await call(B, "GET", "/routines")).find((x: any) => x.id === r.id)).toBeUndefined();
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
    // last time's whole session comes along, even for sets that have no pair today
    await call(A, "DELETE", `/workout-sets/${w.exercises[0].sets.at(-1).id}`);
    const fewer = await call(A, "GET", "/workouts/active");
    expect(fewer.exercises[0].sets.length).toBe(3);
    expect(fewer.exercises[0].last.map((x: any) => [x.weightKg, x.reps])).toEqual([[80, 8], [80, 7], [80, 6], [80, 5]]);
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
    expect(home.goals.length).toBe(3); // the two set above and the "Weekly target" A gets for already having workouts
    const stats = await call(A, "GET", "/stats");
    expect(stats.workouts.length).toBe(2);
    expect(stats.muscles.chest).toBeGreaterThan(0);
    const today = new Date().toISOString().slice(0, 10);
    const cal = await call(A, "GET", "/calendar", undefined, { from: today, to: today });
    expect(cal.workouts.length).toBe(2);
    // planned days come soonest first, timed ones before those with no time; "Every day" is every 1 day
    const addDays = (d: string, n: number) => new Date(Date.parse(d + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
    await call(A, "POST", "/schedules", { routineId, rule: "interval", intervalDays: 1, startDate: today, timeOfDay: null });
    await call(A, "POST", "/schedules", { routineId, rule: "once", startDate: addDays(today, 1), timeOfDay: "07:30" });
    await call(A, "POST", "/schedules", { routineId, rule: "once", startDate: addDays(today, 1), timeOfDay: "06:00" });
    const plan = (await call(A, "GET", "/calendar", undefined, { from: today, to: addDays(today, 2), tz: "0" })).planned;
    // today's is left out: this routine was already done today
    expect(plan.map((p: any) => [p.date, p.timeOfDay])).toEqual([[addDays(today, 1), "06:00"], [addDays(today, 1), "07:30"], [addDays(today, 1), null], [addDays(today, 2), null]]);
    for (const s of await call(A, "GET", "/schedules")) await call(A, "DELETE", `/schedules/${s.id}`);
  });

  it("keeps people's data apart", async () => {
    // B sees none of A's things
    expect((await call(B, "GET", "/routines")).length).toBe(0);
    expect(await call(B, "GET", "/workouts/active")).toBe(null);
    expect((await call(B, "GET", "/workouts")).length).toBe(0);
    expect((await call(B, "GET", "/goals")).map((g: any) => g.title)).toEqual([]); // B has no data, so no starter goal, and none of A's
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
    // A's ids are taken on this server, so another account gets copies under new ids; A's own rows stay as they are
    const C = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username) VALUES ($1,'c')", [C]);
    const res = await call(C, "POST", "/import", { data, mode: "merge" });
    expect(res.workouts).toBe(2);
    expect((await call(C, "GET", "/workouts")).length).toBe(data.tables.workouts.filter((w: any) => w.status === "completed").length);
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

describe("updating a routine from a workout", () => {
  it("takes today's sets and added exercises, and keeps skipped ones", async () => {
    const C = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'legs-tester','C')", [C]);
    const ex = await call(C, "GET", "/exercises");
    const [a, b, c] = ["Barbell Squat", "Barbell Deadlift", "Plank"].map((n) => ex.find((e: any) => e.name === n)?.id ?? ex[0].id);
    const r = await call(C, "POST", "/routines", { name: "Legs", exercises: [
      { exerciseId: a, sets: [{ kind: "normal", reps: 5, weightKg: 100 }, { kind: "normal", reps: 5, weightKg: 100 }] },
      { exerciseId: b, sets: [{ kind: "normal", reps: 5, weightKg: 140 }] }] });
    const w = await call(C, "POST", "/workouts/start", { routineId: r.id });
    for (const s of w.exercises[0].sets) await call(C, "PUT", `/workout-sets/${s.id}`, { weightKg: 105, reps: 5, done: true });
    await call(C, "PUT", `/workout-exercises/${w.exercises[1].id}`, { status: "skipped" });
    await call(C, "POST", `/workouts/${w.id}/exercises`, { exerciseId: c, sets: [{ kind: "normal", durationS: 60, done: true }] });
    await call(C, "POST", `/workouts/${w.id}/finish`, { updateRoutine: true });
    const after = await call(C, "GET", `/routines/${r.id}`);
    expect(after.exercises.map((e: any) => e.exerciseId)).toEqual([a, b, c]);
    expect(after.exercises[0].sets.map((s: any) => s.weightKg)).toEqual([105, 105]);
    expect(after.exercises[1].sets[0].weightKg).toBe(140);
  });
});
