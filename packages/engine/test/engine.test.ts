// The engine end to end on PGlite: a routine, a workout with pre-filled values, reminders, notes, goals, records,
// export/import, and above all that one person can never see or change another's data.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import { structureChanges } from "@motus/shared";

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

  it("starts the next workout from the routine's numbers (today's, after the finish), with the reminder applied", async () => {
    const prev = await call(A, "GET", `/routines/${routineId}/preview`);
    const bench = prev.exercises[0];
    expect(bench.sets[0].weightKg).toBe(82.5); // 80 + reminder
    // the rep range stays as set (the reps move inside it): its bottom, 6
    expect(bench.sets[1].reps).toBe(6);
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
  it("saves only the structure changes switched on: an added exercise, then a skipped one taken out; numbers follow today", async () => {
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
    const plank = (await call(C, "GET", `/workouts/${w.id}`)).exercises[2].id;
    const rb = (await call(C, "GET", `/routines/${r.id}`)).exercises[1].id;
    // the skipped deadlift is listed too, but only what's switched on is saved: here the added plank
    await call(C, "POST", `/workouts/${w.id}/finish`, { routineChanges: [`added:${plank}`] });
    const after = await call(C, "GET", `/routines/${r.id}`);
    expect(after.exercises.map((e: any) => e.exerciseId)).toEqual([a, b, c]);
    // today's 105 × 5 in every set: the routine takes it, then Progression (Suggest by default, kept) a step up
    expect(after.exercises[0].sets.map((s: any) => s.weightKg)).toEqual([107.5, 107.5]);
    expect(after.exercises[1].sets[0].weightKg).toBe(140);
    expect(after.exercises[2].sets[0].durationS).toBe(60);
    // asked for later from the ⋮ menu: the skipped one leaves the routine
    await call(C, "POST", `/routines/${r.id}/from-workout`, { workoutId: w.id, changes: [`skipped:${rb}`] });
    expect((await call(C, "GET", `/routines/${r.id}`)).exercises.map((e: any) => e.exerciseId)).toEqual([a, c]);
  });

  it("leaves the routine alone unless asked, and the menu's update saves the session's structure, never its numbers", async () => {
    const C = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'menu-tester','C')", [C]);
    const ex = await call(C, "GET", "/exercises");
    const r = await call(C, "POST", "/routines", { name: "Push", exercises: [{ exerciseId: ex[0].id, sets: [{ kind: "normal", reps: 5, weightKg: 50 }, { kind: "normal", reps: 5, weightKg: 50 }] }] });
    const w = await call(C, "POST", "/workouts/start", { routineId: r.id });
    await call(C, "PUT", `/workout-sets/${w.exercises[0].sets[0].id}`, { weightKg: 55, reps: 5, done: true });
    await call(C, "POST", `/workouts/${w.id}/finish`, {});
    expect((await call(C, "GET", `/routines/${r.id}`)).exercises[0].sets.length).toBe(2);
    // nothing asked for: nothing changes; the set not done is listed and only dropped when asked
    await call(C, "POST", `/routines/${r.id}/from-workout`, { workoutId: w.id, changes: [] });
    expect((await call(C, "GET", `/routines/${r.id}`)).exercises[0].sets.length).toBe(2);
    const rid = (await call(C, "GET", `/routines/${r.id}`)).exercises[0].id;
    await call(C, "POST", `/routines/${r.id}/from-workout`, { workoutId: w.id, changes: [`fewer:${rid}`] });
    // one set ticked today: the routine keeps one, with today's 55 (finishing gave it today's numbers)
    expect((await call(C, "GET", `/routines/${r.id}`)).exercises[0].sets.map((s: any) => s.weightKg)).toEqual([55]);
    // the start fills in the routine's numbers
    expect((await call(C, "GET", `/routines/${r.id}/preview`)).exercises[0].sets[0].weightKg).toBe(55);
  });

  it("gives a swapped exercise today's numbers, treats one with nothing ticked as skipped, and ignores the old updateRoutine", async () => {
    const C = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'swap-tester','C')", [C]);
    const ex = await call(C, "GET", "/exercises");
    const [a, b, c, d] = [ex[0].id, ex[1].id, ex[2].id, ex[3].id];
    const r = await call(C, "POST", "/routines", { name: "Swap", exercises: [
      { exerciseId: a, sets: [{ kind: "normal", reps: 10, weightKg: 100 }] },
      { exerciseId: b, sets: [{ kind: "normal", reps: 5, weightKg: 140 }, { kind: "normal", reps: 5, weightKg: 140 }] }] });
    const ra = (await call(C, "GET", `/routines/${r.id}`)).exercises[0].id;
    // a note pinned to A in this routine: about A, so not shown on the exercise swapped in for it
    await call(C, "POST", "/notes", { targetType: "routine_exercise", targetId: ra, body: "Elbows in", pinned: true });
    const w = await call(C, "POST", "/workouts/start", { routineId: r.id });
    expect(w.exercises[0].notes.map((n: any) => n.body)).toEqual(["Elbows in"]);
    // A swapped for C, done at 30 × 12; B left with nothing ticked (not marked skipped); D added with nothing ticked
    await call(C, "PUT", `/workout-exercises/${w.exercises[0].id}`, { exerciseId: c });
    await call(C, "PUT", `/workout-sets/${w.exercises[0].sets[0].id}`, { weightKg: 30, reps: 12, done: true });
    await call(C, "POST", `/workouts/${w.id}/exercises`, { exerciseId: d, sets: [{ kind: "normal", reps: 3, weightKg: 9 }] });
    // the swap keeps A's place in the routine, so it is one "Swapped" row, not "Removed: A" and "Added: C"
    const live = await call(C, "GET", `/workouts/${w.id}`);
    expect([live.exercises[0].routineExerciseId, live.exercises[0].swapped, live.exercises[0].notes]).toEqual([ra, true, []]);
    expect(structureChanges(await call(C, "GET", `/routines/${r.id}`), live).map((c) => c.kind)).toEqual(["swapped", "skipped"]);
    await call(C, "POST", `/workouts/${w.id}/finish`, { updateRoutine: true });
    expect((await call(C, "GET", `/routines/${r.id}`)).exercises.map((e: any) => e.exerciseId)).toEqual([a, b]);
    // the same again, now asked for with an older app's saveLayout: what's listed, skipped exercises aside
    const w2 = await call(C, "POST", "/workouts/start", { routineId: r.id });
    await call(C, "PUT", `/workout-exercises/${w2.exercises[0].id}`, { exerciseId: c });
    await call(C, "PUT", `/workout-sets/${w2.exercises[0].sets[0].id}`, { weightKg: 30, reps: 12, done: true });
    await call(C, "POST", `/workouts/${w2.id}/exercises`, { exerciseId: d, sets: [{ kind: "normal", reps: 3, weightKg: 9 }] });
    await call(C, "POST", `/workouts/${w2.id}/finish`, { saveLayout: true });
    const after = await call(C, "GET", `/routines/${r.id}`);
    expect(after.exercises.map((e: any) => e.exerciseId)).toEqual([c, b]);
    // the swap saved takes today's 30 × 12, then Progression a step up (every set reached its 12 reps)
    expect(after.exercises[0].sets.map((s: any) => [s.weightKg, s.reps])).toEqual([[32.5, 12]]);
    expect(after.exercises[1].sets.map((s: any) => s.weightKg)).toEqual([140, 140]);
  });
});

describe("saving routine changes twice", () => {
  it("adds an added exercise once: saved, it belongs to the routine and isn't listed again", async () => {
    const C = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'twice-tester','C')", [C]);
    const ex = await call(C, "GET", "/exercises");
    const r = await call(C, "POST", "/routines", { name: "Twice", exercises: [{ exerciseId: ex[0].id, sets: [{ kind: "normal", reps: 5, weightKg: 50 }] }] });
    const other = await call(C, "POST", "/routines", { name: "Other", exercises: [] });
    const w = await call(C, "POST", "/workouts/start", { routineId: r.id });
    await call(C, "PUT", `/workout-sets/${w.exercises[0].sets[0].id}`, { weightKg: 50, reps: 5, done: true });
    await call(C, "POST", `/workouts/${w.id}/exercises`, { exerciseId: ex[1].id, sets: [{ kind: "normal", reps: 8, weightKg: 20, done: true }] });
    await call(C, "POST", `/workouts/${w.id}/finish`, {});
    const added = (await call(C, "GET", `/workouts/${w.id}`)).exercises[1].id;
    const save = { workoutId: w.id, changes: [`added:${added}`] };
    expect((await call(C, "POST", `/routines/${r.id}/from-workout`, save)).saved).toBe(true);
    expect((await call(C, "POST", `/routines/${r.id}/from-workout`, save)).saved).toBe(false);
    const after = await call(C, "GET", `/routines/${r.id}`);
    expect(after.exercises.map((e: any) => e.exerciseId)).toEqual([ex[0].id, ex[1].id]);
    expect((await call(C, "GET", `/workouts/${w.id}`)).exercises[1].routineExerciseId).toBe(after.exercises[1].id);
    // an older app's request without a list, and a workout from another routine, are refused plainly
    expect(await status(C, "POST", `/routines/${r.id}/from-workout`, { workoutId: w.id })).toBe(400);
    expect(await status(C, "POST", `/routines/${other.id}/from-workout`, save)).toBe(400);
  });
});

describe("the routine's numbers and Progression", () => {
  it("takes today's numbers at the finish, applies Automatic, asks for Suggest, keeps fixed ones, and keeps History", async () => {
    const C = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'prog-tester','C')", [C]);
    const ex = await call(C, "GET", "/exercises");
    const r = await call(C, "POST", "/routines", { name: "Prog", exercises: [
      { exerciseId: ex[0].id, progression: { mode: "auto" }, sets: [{ kind: "warmup", reps: 10, weightKg: 20 }, { kind: "normal", reps: 5, weightKg: 60 }, { kind: "normal", reps: 5, weightKg: 60 }] },
      { exerciseId: ex[1].id, sets: [{ kind: "normal", reps: 8, repsMax: 10, weightKg: 40 }] },
      { exerciseId: ex[2].id, sets: [{ kind: "normal", reps: 8, weightKg: 30 }] },
      { exerciseId: ex[3].id, fixed: true, sets: [{ kind: "normal", reps: 8, weightKg: 10 }] }] });
    const w = await call(C, "POST", "/workouts/start", { routineId: r.id });
    expect(w.exercises.map((e: any) => e.sets.at(-1).weightKg)).toEqual([60, 40, 30, 10]);
    await call(C, "PUT", `/workout-sets/${w.exercises[0].sets[0].id}`, { weightKg: 25, reps: 10, done: true });
    for (const s of w.exercises[0].sets.slice(1)) await call(C, "PUT", `/workout-sets/${s.id}`, { weightKg: 60, reps: 5, done: true });
    await call(C, "PUT", `/workout-sets/${w.exercises[1].sets[0].id}`, { weightKg: 40, reps: 10, done: true });
    await call(C, "PUT", `/workout-sets/${w.exercises[2].sets[0].id}`, { weightKg: 32.5, reps: 6, done: true });
    await call(C, "PUT", `/workout-sets/${w.exercises[3].sets[0].id}`, { weightKg: 15, reps: 8, done: true });
    const rid = (await call(C, "GET", `/routines/${r.id}`)).exercises[1].id;
    await call(C, "POST", `/workouts/${w.id}/finish`, { declined: [rid] });
    const after = (await call(C, "GET", `/routines/${r.id}`)).exercises;
    // warm-up untouched, Automatic up a step; Suggest switched off keeps today's; a miss keeps the rep target; fixed stays
    expect(after.map((e: any) => e.sets.map((s: any) => [s.weightKg, s.reps]))).toEqual([[[20, 10], [62.5, 5], [62.5, 5]], [[40, 8]], [[32.5, 8]], [[10, 8]]]);
    expect(after[2].missed).toBe(1);
    const next = await call(C, "POST", "/workouts/start", { routineId: r.id, force: true });
    expect(next.exercises[0].sets.map((s: any) => s.weightKg)).toEqual([20, 62.5, 62.5]);
    const hist = await call(C, "GET", `/routines/${r.id}/versions`);
    expect(hist.map((v: any) => v.reason)).toEqual(["workout", "edit"]);
    expect(hist[0]).toMatchObject({ workoutId: w.id, workoutName: "Prog" });
    expect(hist[0].top[0].kg).toBe(62.5);
    const old = await call(C, "GET", `/routines/${r.id}/versions/${hist[1].id}`);
    expect(old.exercises[0].sets[1].weightKg).toBe(60);
    await call(C, "POST", `/routines/${r.id}/versions/${hist[1].id}/restore`);
    expect((await call(C, "GET", `/routines/${r.id}`)).exercises[0].sets[1].weightKg).toBe(60);
    expect((await call(C, "GET", `/routines/${r.id}/versions`)).length).toBe(3);
  });

  it("makes no more-weight reminders, and an older app's moreWeight is left out", async () => {
    const C = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'more-tester','C')", [C]);
    const ex = await call(C, "GET", "/exercises");
    const r = await call(C, "POST", "/routines", { name: "Arms", exercises: [{ exerciseId: ex[0].id, sets: [{ kind: "normal", reps: 8, repsMax: 12, weightKg: 20 }, { kind: "normal", reps: 8, repsMax: 12, weightKg: 20 }] }] });
    const w = await call(C, "POST", "/workouts/start", { routineId: r.id });
    expect(w.exercises[0].sets[0].targetRepsMax).toBe(12);
    for (const s of w.exercises[0].sets) await call(C, "PUT", `/workout-sets/${s.id}`, { weightKg: 20, reps: 12, done: true });
    await call(C, "POST", `/workouts/${w.id}/finish`, { moreWeight: [{ exerciseId: ex[0].id, weightKg: 22.5, reps: 8 }] });
    expect((await eng.db.admin.query("SELECT 1 FROM reminders WHERE created_workout_id = $1", [w.id])).rows.length).toBe(0);
    // Settings' default is Suggest, kept (nothing switched off): next time at one step more, reps at the bottom
    const next = await call(C, "POST", "/workouts/start", { routineId: r.id });
    expect(next.exercises[0].sets.map((s: any) => [s.weightKg, s.reps])).toEqual([[22.5, 8], [22.5, 8]]);
  });

  it("keeps the rep target and range on a set added during the workout", async () => {
    const C = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'addset-tester','C')", [C]);
    const ex = await call(C, "GET", "/exercises");
    const r = await call(C, "POST", "/routines", { name: "Arms", exercises: [{ exerciseId: ex[0].id, sets: [{ kind: "normal", reps: 8, repsMax: 12, weightKg: 20 }] }] });
    const w = await call(C, "POST", "/workouts/start", { routineId: r.id });
    const we = w.exercises[0];
    // as the app sends it (the copied numbers, no targets) and as an older or bare call does (nothing at all)
    await call(C, "POST", `/workout-exercises/${we.id}/sets`, { id: uuidv7(), kind: "normal", weightKg: 20, reps: 8, prefilled: true });
    await call(C, "POST", `/workout-exercises/${we.id}/sets`, {});
    const sets = (await call(C, "GET", `/workouts/${w.id}`)).exercises[0].sets;
    expect(sets.map((s: any) => [s.targetReps, s.targetRepsMax])).toEqual([[8, 12], [8, 12], [8, 12]]);
  });
});
