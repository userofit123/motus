// Home suggestions come from what you do: your usual order of routines, and muscles left out.
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
});
