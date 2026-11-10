// Offline use: a device works on its own copy of a server account and syncs both ways; the newest change wins.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, replica, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";

let server: Engine, device: Engine, U: string, deviceId = "";
const on = (e: Engine) => async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
  const r = await e.handle({ method, path, body, query, userId: U });
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const S = () => on(server), D = () => on(device);
// one round of what the app does: send what changed here, then fetch what changed elsewhere
async function sync() {
  const out = await replica.localChanges(device.db);
  if (out.changes.length) {
    const res = await S()("POST", "/sync/push", { device: deviceId, changes: out.changes });
    await replica.markSent(device.db, out.upTo);
    if (res.rejected.length) await replica.applyRemote(device.db, U, res.rejected);
  }
  for (;;) {
    const m = await replica.replicaMeta(device.db);
    const p = await S()("GET", "/sync/pull", undefined, { since: String(m.cursor), device: deviceId });
    await replica.applyRemote(device.db, U, p.changes, p.cursor);
    if (!p.more) break;
  }
}

beforeAll(async () => {
  server = await createEngine(await pgliteDb("memory://"), { mode: "server" });
  U = uuidv7();
  await server.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'u','U')", [U]);
  device = await createEngine(await pgliteDb("memory://"), { mode: "local", seed: false });
}, 120000);

describe("sync", () => {
  let routineId = "";
  it("gives a device a full copy, with the server's catalog ids", async () => {
    routineId = (await S()("POST", "/routines", { template: "push" })).id;
    const cat = await S()("GET", "/sync/catalog");
    await replica.loadCatalog(device.db, cat.stamp, cat.rows);
    const meta = await replica.loadSnapshot(device.db, await S()("GET", "/sync/snapshot"));
    deviceId = meta.device;
    const here = await D()("GET", `/routines/${routineId}`);
    expect(here.name).toBe("Push");
    expect(here.exercises.length).toBe(5);
    expect(await replica.waitingCount(device.db)).toBe(0);
  }, 60000);

  it("works offline and sends it all when back", async () => {
    const w = await D()("POST", "/workouts/start", { routineId });
    for (const s of w.exercises[0].sets) await D()("PUT", `/workout-sets/${s.id}`, { weightKg: 60, reps: 10, done: true });
    await D()("POST", `/workouts/${w.id}/finish`, {});
    await D()("POST", "/goals", { metric: "workouts", target: 3, period: "week" });
    expect(await replica.waitingCount(device.db)).toBeGreaterThan(0);
    await sync();
    expect(await replica.waitingCount(device.db)).toBe(0);
    const there = await S()("GET", `/workouts/${w.id}`);
    expect(there.status).toBe("completed");
    expect(there.exercises[0].sets.every((s: any) => s.done && s.weightKg === 60)).toBe(true);
    // this one and the starter goal, which both sides made with the same id, so it isn't doubled
    expect((await S()("GET", "/goals")).length).toBe(2);
  }, 60000);

  it("fetches changes made elsewhere", async () => {
    await S()("PUT", `/routines/${routineId}`, { name: "Push day" });
    await sync();
    expect((await D()("GET", `/routines/${routineId}`)).name).toBe("Push day");
  }, 60000);

  it("takes activity types from an older app that doesn't send has_steps", async () => {
    const types = await S()("GET", "/activity-types");
    const walk = types.find((t: any) => t.slug === "walk");
    const at = new Date().toISOString();
    const old = (row: Record<string, unknown>) => ({ tbl: "activity_types", op: "upsert", pk: { id: row.id }, at, row });
    const id = uuidv7();
    const res = await S()("POST", "/sync/push", { device: deviceId, changes: [
      old({ id, user_id: U, slug: "trail-run", name: "Trail run", icon: "run", has_distance: true, has_gps: true }),
      old({ id: walk.id, user_id: U, slug: "walk", name: "Stroll", icon: "walk", has_distance: true, has_gps: true }),
    ] });
    expect(res).toMatchObject({ applied: 2, failed: [], rejected: [] });
    const after = Object.fromEntries((await S()("GET", "/activity-types")).map((t: any) => [t.slug, t]));
    expect(after["trail-run"]).toMatchObject({ name: "Trail run", hasSteps: false });
    // the existing type keeps its own has_steps
    expect(after.walk).toMatchObject({ name: "Stroll", hasSteps: true });
    expect((await server.db.admin.query("SELECT has_steps FROM activity_types WHERE id = $1", [walk.id])).rows[0].has_steps).toBe(true);
  }, 60000);

  it("keeps the newest of two changes to the same thing", async () => {
    await D()("PUT", `/routines/${routineId}`, { name: "Older, from the device" });
    await new Promise((r) => setTimeout(r, 20));
    await S()("PUT", `/routines/${routineId}`, { name: "Newer, from the server" });
    await sync();
    expect((await D()("GET", `/routines/${routineId}`)).name).toBe("Newer, from the server");
    expect((await S()("GET", `/routines/${routineId}`)).name).toBe("Newer, from the server");
  }, 60000);

  it("sends deletions both ways", async () => {
    for (const g of await D()("GET", "/goals")) await D()("DELETE", `/goals/${g.id}`);
    await sync();
    expect((await S()("GET", "/goals")).length).toBe(0);
    const b = await S()("POST", "/body", { kind: "weight", value: 72 });
    await sync();
    expect((await D()("GET", "/body")).some((x: any) => x.id === b.id || x.value === 72)).toBe(true);
    await S()("DELETE", `/body/${(await S()("GET", "/body"))[0].id}`);
    await sync();
    expect((await D()("GET", "/body")).length).toBe(0);
  }, 60000);

  it("turns an old-shape Progression rule from an old app into Automatic, or into Settings' when the feature is off", async () => {
    const r = await S()("POST", "/routines", { name: "Old app", exercises: [] });
    const ex = (await S()("GET", "/exercises"))[0];
    const push = async (id: string) => {
      const row = { id, user_id: U, routine_id: r.id, exercise_id: ex.id, position: 0, progression: { kind: "linear", incrementKg: 2.5, deloadAfter: 3 } };
      await S()("POST", "/sync/push", { device: "old-app", changes: [{ tbl: "routine_exercises", pk: { id }, op: "upsert", at: new Date().toISOString(), row }] });
      return (await server.db.admin.query("SELECT progression FROM routine_exercises WHERE id = $1", [id])).rows[0]?.progression;
    };
    expect(await push(uuidv7())).toEqual({ mode: "auto", repsMin: null, repsMax: null, stepKg: 2.5, lowerAfter: 3 });
    // the old switch lives in the stored settings (the current app drops it when reading them)
    await server.db.admin.query("INSERT INTO user_settings (user_id, data) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data = $2", [U, JSON.stringify({ features: { progression: false } })]);
    expect(await push(uuidv7())).toBeNull();
  }, 60000);
});
