// Home suggestions (your usual order of routines, muscles left out), and goal fixes found in an audit.
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
async function doWorkout(routineId: string) {
  const w = await call("POST", "/workouts/start", { routineId });
  for (const e of w.exercises) for (const s of e.sets) await call("PUT", `/workout-sets/${s.id}`, { weightKg: 20, reps: 8, done: true });
  await call("POST", `/workouts/${w.id}/finish`, {});
}

beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"), { mode: "server" });
  U = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'s','S')", [U]);
}, 120000);

describe("suggestions", () => {
  it("suggests the routine that usually comes next", async () => {
    const push = (await call("POST", "/routines", { template: "push" })).id;
    const pull = (await call("POST", "/routines", { template: "pull" })).id;
    const legs = (await call("POST", "/routines", { template: "legs" })).id;
    for (const r of [push, pull, legs, push, pull, legs, push]) await doWorkout(r);
    const home = await call("GET", "/home");
    expect(home.suggest[0].kind).toBe("order");
    expect(home.suggest[0].routineId).toBe(pull);
    expect(home.suggest[0].reason).toContain("after Push");
  }, 60000);

  // a fresh person with one routine of their own exercises, so the gaps are known exactly
  async function personWith(muscles: string[], helpers: Record<string, string[]> = {}) {
    U = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,$2,'G')", [U, `g${U.slice(-6)}`]);
    const exercises = [];
    for (const m of muscles) {
      const e = await call("POST", "/exercises", { name: `Only ${m}`, primaryMuscles: [m], secondaryMuscles: helpers[m] ?? (m === "biceps" ? ["forearms"] : []), equipment: "dumbbell", category: "strength" });
      exercises.push({ exerciseId: e.id, sets: [{ reps: 8 }] });
    }
    return (await call("POST", "/routines", { name: "Mine", exercises })).id as string;
  }
  const suggest = async () => (await call("GET", "/home")).suggest as any[];

  it("points out a muscle group none of your routines works, at most two gaps", async () => {
    await personWith(["chest"]);
    const sug = await suggest();
    const gaps = sug.filter((x) => x.kind === "gap" || x.kind === "target");
    // groups in their usual order: back and shoulders are the first ones nothing works
    expect(gaps.map((x) => x.muscle)).toEqual(["back", "shoulders"]);
    expect(gaps[0].routineId).toBeNull();
    expect(gaps[0].title).toBe("Work your back");
    expect(gaps[0].reason).toBe("No routine works your back · add a back exercise");
    expect(gaps[0].muscles).toContain("lats");
  }, 60000);

  it("says a group is only worked as a helper, with the right word for its exercise", async () => {
    await personWith(["chest", "lats", "shoulders"], { chest: ["triceps"] });
    const arms = (await suggest()).find((x) => x.muscle === "arms");
    expect(arms?.title).toBe("Work your arms");
    expect(arms?.reason).toBe("Your routines only work your arms as a helper · add an arm exercise");
  }, 60000);

  it("leaves out a gap you trained outside your routines lately", async () => {
    await personWith(["chest"]);
    const other = await call("POST", "/exercises", { name: "Rows", primaryMuscles: ["lats"], secondaryMuscles: [], equipment: "dumbbell", category: "strength" });
    const r = (await call("POST", "/routines", { name: "Once", exercises: [{ exerciseId: other.id, sets: [{ reps: 8 }] }] })).id;
    await doWorkout(r);
    await call("PUT", `/routines/${r}`, { archived: true });
    const gaps = (await suggest()).filter((x) => x.kind === "gap" || x.kind === "target");
    expect(gaps.map((x) => x.muscle)).not.toContain("back");
    expect(gaps[0].muscle).toBe("shoulders");
  }, 60000);

  it("points out a muscle only ever worked as a helper once every group is covered", async () => {
    await personWith(["chest", "lats", "middle back", "shoulders", "biceps", "triceps", "abdominals", "quadriceps", "hamstrings", "glutes", "calves"]);
    const sug = await suggest();
    expect(sug.some((x) => x.kind === "gap")).toBe(false);
    const fa = sug.find((x) => x.kind === "target");
    expect(fa?.muscle).toBe("forearms");
    expect(fa?.title).toBe("Work your forearms");
    expect(fa?.reason).toBe("Your routines only work your forearms as a helper · add a forearm exercise");
  }, 60000);

  // a workout of a routine that is then archived, moved back by `daysAgo`: trained outside the routines you keep
  async function trainedOutside(muscle: string, daysAgo: number) {
    const e = await call("POST", "/exercises", { name: `Old ${muscle}`, primaryMuscles: [muscle], secondaryMuscles: [], equipment: "dumbbell", category: "strength" });
    const r = (await call("POST", "/routines", { name: "Old", exercises: [{ exerciseId: e.id, sets: [{ reps: 8 }] }] })).id;
    await doWorkout(r);
    await eng.db.admin.query("UPDATE workouts SET started_at = started_at - make_interval(days => $2) WHERE routine_id = $1", [r, daysAgo]);
    await call("PUT", `/routines/${r}`, { archived: true });
  }

  it("gives a muscle no routine works its own tip, which can start a new routine", async () => {
    await personWith(["chest"]);
    await trainedOutside("lats", 12);
    const lats = (await suggest()).find((x) => x.muscle === "lats");
    expect(lats?.kind).toBe("rested");
    expect(lats?.routineId).toBeNull();
    expect(lats?.title).toBe("Work your lats");
  }, 60000);

  it("keeps a muscle's tip when its group's gap tip was cut by the two-gaps limit", async () => {
    await personWith(["chest"]);
    await trainedOutside("quadriceps", 30); // a month ago: legs is still a gap, but the fifth one
    const sug = await suggest();
    expect(sug.filter((x) => x.kind === "gap").map((x) => x.muscle)).toEqual(["back", "shoulders"]);
    const quads = sug.find((x) => x.muscle === "quadriceps");
    expect(quads?.kind).toBe("rested");
    expect(quads?.routineId).toBeNull();
  }, 60000);

  it("says a muscle left out was not worked in the last 7 days", async () => {
    const a = await personWith(["chest", "lats", "shoulders", "biceps"]);
    const tri = await call("POST", "/exercises", { name: "Only triceps", primaryMuscles: ["triceps"], secondaryMuscles: [], equipment: "dumbbell", category: "strength" });
    const b = (await call("POST", "/routines", { name: "Arms", exercises: [{ exerciseId: tri.id, sets: [{ reps: 8 }] }] })).id;
    await doWorkout(b);
    await eng.db.admin.query("UPDATE workouts SET started_at = started_at - interval '8 days' WHERE routine_id = $1", [b]);
    await doWorkout(a);
    const t = (await suggest()).find((x) => x.muscle === "triceps");
    expect(t?.kind).toBe("missed");
    expect(t?.routineId).toBe(b);
    expect(t?.reason).toBe("Triceps: the only one not worked in the last 7 days · works your triceps");
  }, 60000);
});

describe("fixes found in the audit", () => {
  it("aims a body goal from where you are towards the target, so it doesn't count as done at once", async () => {
    await call("POST", "/body", { kind: "weight", value: 70 }).catch(() => eng.db.admin.query("INSERT INTO body_metrics (id, user_id, kind, value, measured_at) VALUES ($1,$2,'weight',70,now())", [uuidv7(), U]));
    const g = await call("POST", "/goals", { metric: "body_weight", target: 80 });
    expect(g.comparator).toBe(">=");
    const got = await call("GET", `/goals/${g.id}`);
    expect(got.status).toBe("active");
  });
  it("refuses an empty target and a missing routine", async () => {
    expect((await eng.handle({ method: "POST", path: "/goals", body: { metric: "workouts", target: "" }, userId: U })).status).toBe(400);
    expect((await eng.handle({ method: "POST", path: "/goals", body: { metric: "routine_count", target: 3 }, userId: U })).status).toBe(400);
  });
  it("keeps a goal's deadline when it is archived", async () => {
    const g = await call("POST", "/goals", { metric: "workouts", target: 5, deadline: "2027-06-30" });
    await call("PUT", `/goals/${g.id}`, { status: "archived" });
    expect((await call("GET", `/goals/${g.id}`)).deadline).toContain("2027-06-30");
  });
});
