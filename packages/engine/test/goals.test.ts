// Body measurement goals: which way they head, progress from where you started, and achieving them.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";

let eng: Engine, U: string;
const call = async (method: string, path: string, body?: unknown) => {
  const r = await eng.handle({ method, path, body, userId: U });
  if (r.status !== 200) throw Object.assign(new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`), { status: r.status });
  return r.body as any;
};
const log = (kind: string, value: number, daysAgo = 0) => call("POST", "/body", { kind, value, measuredAt: new Date(Date.now() - daysAgo * 86400000).toISOString() });
const goal = async (id: string) => call("GET", `/goals/${id}`);
beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"));
  U = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username) VALUES ($1, 'u')", [U]);
}, 120000);

describe("body measurement goals", () => {
  it("grows an arm: higher is better, progress from the starting measurement", async () => {
    await log("arm_r", 36, 3);
    const { id, comparator } = await call("POST", "/goals", { metric: "body_metric", scopeId: "arm_r", target: 38 });
    expect(comparator).toBe(">=");
    let g = await goal(id);
    expect(g.progress.unit).toBe("cm");
    expect(g.progress.pct).toBe(0);
    expect(g.progress.done).toBe(false);
    await log("arm_r", 37);
    g = await goal(id);
    expect(g.progress.current).toBe(37);
    expect(g.progress.pct).toBeCloseTo(0.5);
    expect(g.status).toBe("active");
    await log("arm_r", 38.2);
    g = await goal(id);
    expect(g.progress.done).toBe(true);
    expect(g.progress.pct).toBe(1);
    expect(g.status).toBe("achieved");
  });

  it("shrinks a waist: lower is better", async () => {
    await log("waist", 90, 2);
    const { id, comparator } = await call("POST", "/goals", { metric: "body_metric", scopeId: "waist", target: 85 });
    expect(comparator).toBe("<=");
    await log("waist", 87.5);
    let g = await goal(id);
    expect(g.progress.pct).toBeCloseTo(0.5);
    expect(g.progress.done).toBe(false);
    await log("waist", 91); // going the wrong way is no progress, not negative
    expect((await goal(id)).progress.pct).toBe(0);
    await log("waist", 84.8);
    g = await goal(id);
    expect(g.progress.done).toBe(true);
    expect(g.status).toBe("achieved");
  });

  it("with nothing logged, heads the usual way for the measure", async () => {
    expect((await call("POST", "/goals", { metric: "body_metric", scopeId: "calf_l", target: 40 })).comparator).toBe(">=");
    const hips = await call("POST", "/goals", { metric: "body_metric", scopeId: "hips", target: 95 });
    expect(hips.comparator).toBe("<=");
    // nothing logged is not "got down to 95"
    const g = await goal(hips.id);
    expect(g.progress.done).toBe(false);
    expect(g.progress.pct).toBe(0);
  });

  it("follows the current value even against the usual way (bulking body weight)", async () => {
    await log("weight", 70, 5);
    expect((await call("POST", "/goals", { metric: "body_weight", target: 75 })).comparator).toBe(">=");
  });

  it("keeps the direction the person chose over the suggested one", async () => {
    // usual way for body fat is down and nothing says otherwise, but this person wants to go up
    const { id, comparator } = await call("POST", "/goals", { metric: "body_metric", scopeId: "body_fat", target: 15, comparator: ">=" });
    expect(comparator).toBe(">=");
    await log("body_fat", 12, 4);
    let g = await goal(id);
    expect(g.comparator).toBe(">=");
    expect(g.progress.done).toBe(false);
    await log("body_fat", 13.5);
    g = await goal(id);
    expect(g.progress.pct).toBeCloseTo(0.5);
    // and against the latest entry: 95 kg now, aiming at 100, but the person chose "decrease" (suggestion would be up)
    await log("weight", 95);
    const w = await call("POST", "/goals", { metric: "body_weight", target: 100, comparator: "<=" });
    expect(w.comparator).toBe("<=");
    // 95 is already at or under 100, so with the chosen direction it is reached
    expect((await goal(w.id)).status).toBe("achieved");
  });

  it("lets the direction be changed later, and reopens a goal that turning it round undoes", async () => {
    await log("chest", 100, 2);
    const { id } = await call("POST", "/goals", { metric: "body_metric", scopeId: "chest", target: 105, comparator: "<=" });
    expect((await goal(id)).status).toBe("achieved"); // 100 ≤ 105: met the wrong way round
    await call("PUT", `/goals/${id}`, { comparator: ">=" });
    const g = await goal(id);
    expect(g.comparator).toBe(">=");
    expect(g.status).toBe("active");
    expect(g.achievedAt).toBeNull();
    expect(g.progress.done).toBe(false);
  });

  it("ignores a direction for goals whose way is fixed", async () => {
    const { id, comparator } = await call("POST", "/goals", { metric: "workouts", target: 3, comparator: "<=" });
    expect(comparator).toBe(">=");
    await call("PUT", `/goals/${id}`, { comparator: "<=" });
    expect((await goal(id)).comparator).toBe(">=");
  });

  it("refuses an unknown measurement", async () => {
    await expect(call("POST", "/goals", { metric: "body_metric", scopeId: "nose", target: 5 })).rejects.toMatchObject({ status: 400 });
  });
});

describe("editing a goal", () => {
  it("changes what it measures, its target, how often and its days", async () => {
    const { id } = await call("POST", "/goals", { metric: "sessions", scopeId: "workout", target: 3, period: "week", title: "Gym" });
    await call("PUT", `/goals/${id}`, { metric: "activity_distance", scopeId: "walk", target: 30, period: "month", title: "Walking" });
    let g = await goal(id);
    expect(g).toMatchObject({ scope: "activity", metric: "activity_distance", scopeId: "walk", target: 30, period: "month", title: "Walking", comparator: ">=" });
    await call("PUT", `/goals/${id}`, { metric: "steps_avg", scopeId: null, target: 8000, period: "day", days: [1, 3] });
    g = await goal(id);
    expect(g).toMatchObject({ metric: "steps_avg", scopeId: null, period: "day", days: [1, 3], title: "Walking" });
    // a measure that isn't counted per week or month becomes one-off, and its days go
    const r = (await call("POST", "/routines", { name: "Edit test day" })).id;
    await call("PUT", `/goals/${id}`, { metric: "routine_duration", scopeId: r, target: 45, period: "week" });
    g = await goal(id);
    expect(g).toMatchObject({ scope: "routine", metric: "routine_duration", scopeId: r, period: "once", comparator: "<=" });
    expect(g.days ?? null).toBeNull();
  });

  it("checks an edit like a new goal", async () => {
    const { id } = await call("POST", "/goals", { metric: "workouts", target: 3, period: "week" });
    await expect(call("PUT", `/goals/${id}`, { metric: "nonsense" })).rejects.toMatchObject({ status: 400 });
    await expect(call("PUT", `/goals/${id}`, { target: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(call("PUT", `/goals/${id}`, { metric: "max_weight" })).rejects.toMatchObject({ status: 400 });
    await expect(call("PUT", `/goals/${id}`, { metric: "muscle_sets", scopeId: "nose" })).rejects.toMatchObject({ status: 400 });
    await expect(call("PUT", `/goals/${id}`, { metric: "routine_count", scopeId: uuidv7() })).rejects.toMatchObject({ status: 400 });
    await expect(call("PUT", `/goals/${id}`, { metric: "body_metric", scopeId: "nose" })).rejects.toMatchObject({ status: 400 });
    expect(await goal(id)).toMatchObject({ metric: "workouts", target: 3 });
  });

  it("can't reach someone else's goal or routine", async () => {
    const other = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username) VALUES ($1, 'other')", [other]);
    const as = (method: string, path: string, body?: unknown) => eng.handle({ method, path, body, userId: other });
    const theirs = ((await as("POST", "/routines", { name: "Theirs" })).body as any).id;
    const { id } = await call("POST", "/goals", { metric: "workouts", target: 3, period: "week" });
    expect((await as("PUT", `/goals/${id}`, { target: 9 })).status).toBe(404);
    await expect(call("PUT", `/goals/${id}`, { metric: "routine_count", scopeId: theirs })).rejects.toMatchObject({ status: 400 });
    expect((await goal(id)).target).toBe(3);
  });

  it("reopens an achieved goal when what it measures changes, and moves a body goal to another measure", async () => {
    await log("hips", 90);
    const { id } = await call("POST", "/goals", { metric: "body_metric", scopeId: "hips", target: 95, comparator: "<=" });
    expect((await goal(id)).status).toBe("achieved");
    await call("PUT", `/goals/${id}`, { target: 85 });
    let g = await goal(id);
    expect(g.status).toBe("active");
    expect(g.achievedAt).toBeNull();
    // a new measure takes its own direction when none is given
    await log("neck", 40);
    await call("PUT", `/goals/${id}`, { scopeId: "neck", target: 38 });
    g = await goal(id);
    expect(g).toMatchObject({ metric: "body_metric", scopeId: "neck", comparator: "<=", target: 38, status: "active" });
    // turned round, 40 is past 38: achieved again; a rename alone then keeps it achieved
    await call("PUT", `/goals/${id}`, { comparator: ">=" });
    expect((await goal(id)).status).toBe("achieved");
    await call("PUT", `/goals/${id}`, { title: "Lighter" });
    expect(await goal(id)).toMatchObject({ title: "Lighter", status: "achieved" });
  });

  it("clears a deadline", async () => {
    const { id } = await call("POST", "/goals", { metric: "workouts", target: 10, period: "once", deadline: "2099-01-01" });
    expect((await goal(id)).deadline).toBe("2099-01-01");
    await call("PUT", `/goals/${id}`, { deadline: null });
    expect((await goal(id)).deadline ?? null).toBeNull();
  });

  it("checks the kept reference when the kind changes and scopeId is left out", async () => {
    const r = (await call("POST", "/routines", { name: "Kind change" })).id;
    const { id } = await call("POST", "/goals", { metric: "routine_count", scopeId: r, target: 2, period: "week" });
    // a routine's id is no exercise
    await expect(call("PUT", `/goals/${id}`, { metric: "max_weight" })).rejects.toMatchObject({ status: 400 });
    const walk = (await call("POST", "/goals", { metric: "activity_distance", scopeId: "walk", target: 30, period: "month" })).id;
    // "walk" is no muscle group
    await expect(call("PUT", `/goals/${walk}`, { metric: "muscle_sets" })).rejects.toMatchObject({ status: 400 });
    expect(await goal(id)).toMatchObject({ metric: "routine_count", scopeId: r });
    expect(await goal(walk)).toMatchObject({ metric: "activity_distance", scopeId: "walk" });
  });

  it("refuses an exercise goal turned into a routine goal that keeps the exercise's id", async () => {
    const ex = (await call("POST", "/exercises", { name: "Kind change press", tracking: "weight_reps", primaryMuscles: ["chest"] })).id;
    const { id } = await call("POST", "/goals", { metric: "max_weight", scopeId: ex, target: 80 });
    await expect(call("PUT", `/goals/${id}`, { metric: "routine_count" })).rejects.toMatchObject({ status: 400 });
    expect(await goal(id)).toMatchObject({ metric: "max_weight", scopeId: ex });
  });

  it("checks what an activity goal counts, on a new goal and when the kind or measure changes", async () => {
    const r = (await call("POST", "/routines", { name: "To activity" })).id;
    const rg = (await call("POST", "/goals", { metric: "routine_count", scopeId: r, target: 2, period: "week" })).id;
    // a routine's id is no activity type
    await expect(call("PUT", `/goals/${rg}`, { metric: "sessions" })).rejects.toMatchObject({ status: 400 });
    const chest = (await call("POST", "/goals", { metric: "muscle_sets", scopeId: "chest", target: 10, period: "week" })).id;
    await expect(call("PUT", `/goals/${chest}`, { metric: "activity_distance" })).rejects.toMatchObject({ status: 400 });
    // gym workouts are counted only as sessions
    const gym = (await call("POST", "/goals", { metric: "sessions", scopeId: "workout", target: 3, period: "week" })).id;
    await expect(call("PUT", `/goals/${gym}`, { metric: "activity_distance" })).rejects.toMatchObject({ status: 400 });
    await expect(call("POST", "/goals", { metric: "activity_minutes", scopeId: "workout", target: 60, period: "week" })).rejects.toMatchObject({ status: 400 });
    await expect(call("POST", "/goals", { metric: "sessions", scopeId: "nonsense", target: 3, period: "week" })).rejects.toMatchObject({ status: 400 });
    // one of the person's activity types, or everything, is fine
    await call("PUT", `/goals/${chest}`, { metric: "activity_distance", scopeId: "walk" });
    expect(await goal(chest)).toMatchObject({ scope: "activity", metric: "activity_distance", scopeId: "walk" });
    await call("PUT", `/goals/${rg}`, { metric: "sessions", scopeId: null });
    expect(await goal(rg)).toMatchObject({ scope: "activity", metric: "sessions", scopeId: null });
    // a general goal drops the reference it had
    await call("PUT", `/goals/${chest}`, { metric: "active_minutes" });
    expect(await goal(chest)).toMatchObject({ scope: "general", metric: "active_minutes", scopeId: null });
    expect(await goal(gym)).toMatchObject({ metric: "sessions", scopeId: "workout" });
  });

  it("reopens an achieved goal on a small deliberate change to its target", async () => {
    await log("weight", 100);
    const { id } = await call("POST", "/goals", { metric: "body_weight", target: 100, comparator: ">=" });
    expect((await goal(id)).status).toBe("achieved");
    // 0.1 lb more
    await call("PUT", `/goals/${id}`, { target: 100.05 });
    expect(await goal(id)).toMatchObject({ target: 100.05, status: "active", achievedAt: null });
  });

  it("keeps an achieved goal achieved when the same target is sent back", async () => {
    await log("chest", 100);
    const { id } = await call("POST", "/goals", { metric: "body_metric", scopeId: "chest", target: 100, comparator: ">=" });
    expect((await goal(id)).status).toBe("achieved");
    // read again: the read that marks it gives the app's clock, later ones the stored date
    const before = await goal(id);
    // the same 100 cm (off only by float error): not reopened (a reopened one-off goal is achieved again on the next
    // read, but with a new achieved date)
    await new Promise((r) => setTimeout(r, 20));
    await call("PUT", `/goals/${id}`, { target: 100 * (1 + 1e-9), title: "Chest" });
    expect(await goal(id)).toMatchObject({ title: "Chest", status: "achieved", achievedAt: before.achievedAt });
  });

  it("re-checks an achieved one-off goal when the data that reached it is corrected", async () => {
    const ex = (await call("POST", "/exercises", { name: "Typo bench", tracking: "weight_reps", primaryMuscles: ["chest"] })).id;
    const { id } = await call("POST", "/goals", { metric: "max_weight", scopeId: ex, target: 100 });
    const w = await call("POST", "/workouts/log", { startedAt: new Date(Date.now() - 3600000).toISOString(), durationS: 3600, exercises: [{ exerciseId: ex, sets: [{ weightKg: 1000, reps: 5 }] }] });
    expect((await goal(id)).status).toBe("achieved"); // 1000 kg: a typo for 100
    const set = (await call("GET", `/workouts/${w.id}`)).exercises[0].sets[0];
    await call("PUT", `/workout-sets/${set.id}`, { weightKg: 80 });
    expect(await goal(id)).toMatchObject({ status: "active", achievedAt: null, progress: { current: 80, done: false } });
    // the real thing later achieves it again
    await call("PUT", `/workout-sets/${set.id}`, { weightKg: 102.5 });
    expect((await goal(id)).status).toBe("achieved");
  });

  it("keeps a body goal achieved after a real slip back, but not after its only reaching entry is deleted", async () => {
    await log("thigh_l", 50, 5);
    const { id } = await call("POST", "/goals", { metric: "body_metric", scopeId: "thigh_l", target: 55 });
    const typo = await log("thigh_l", 555, 1);
    expect((await goal(id)).status).toBe("achieved");
    await call("DELETE", `/body/${typo.id}`);
    expect((await goal(id)).status).toBe("active");
    await log("thigh_l", 55.5, 0.5);
    expect((await goal(id)).status).toBe("achieved");
    await log("thigh_l", 54.5); // reached once for real: a later dip doesn't take it away
    expect(await goal(id)).toMatchObject({ status: "achieved", progress: { done: false } });
  });
});
