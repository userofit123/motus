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
  async function personWith(muscles: string[]) {
    U = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,$2,'G')", [U, `g${U.slice(-6)}`]);
    const exercises = [];
    for (const m of muscles) {
      const e = await call("POST", "/exercises", { name: `Only ${m}`, primaryMuscles: [m], secondaryMuscles: m === "biceps" ? ["forearms"] : [], equipment: "dumbbell", category: "strength" });
      exercises.push({ exerciseId: e.id, sets: [{ reps: 8 }] });
    }
    await call("POST", "/routines", { name: "Mine", exercises });
    return (await call("GET", "/home")).suggest as any[];
  }

  it("points out a muscle group none of your routines works, at most two gaps", async () => {
    const sug = await personWith(["chest"]);
    const gaps = sug.filter((x) => x.kind === "gap" || x.kind === "target");
    // groups in their usual order: back and shoulders are the first ones nothing works
    expect(gaps.map((x) => x.muscle)).toEqual(["back", "shoulders"]);
    expect(gaps[0].routineId).toBeNull();
    expect(gaps[0].title).toBe("No routine works your back");
    expect(gaps[0].muscles).toContain("lats");
  }, 60000);

  it("points out a muscle only ever worked as a helper once every group is covered", async () => {
    const sug = await personWith(["chest", "lats", "middle back", "shoulders", "biceps", "triceps", "abdominals", "quadriceps", "hamstrings", "glutes", "calves"]);
    expect(sug.some((x) => x.kind === "gap")).toBe(false);
    const fa = sug.find((x) => x.kind === "target");
    expect(fa?.muscle).toBe("forearms");
    expect(fa?.reason).toBe("Your routines only work your forearms as a helper");
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
