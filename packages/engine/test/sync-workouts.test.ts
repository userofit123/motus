// A running workout on a device with an offline copy: finishing and cancelling must stick, whatever order the
// server and the device see the changes in (the bug: a finished or cancelled workout came back as "in progress").
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createEngine, replica, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";

let server: Engine, device: Engine, U: string, deviceId = "";
const on = (e: Engine) => async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
  const r = await e.handle({ method, path, body, query, userId: U });
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const raw = (e: Engine, method: string, path: string, body?: unknown) => e.handle({ method, path, body, userId: U });
const S = () => on(server), D = () => on(device);
const tick = () => new Promise((r) => setTimeout(r, 15));
// what the app does: send what changed here, then fetch what changed elsewhere
async function push() {
  const out = await replica.localChanges(device.db);
  if (!out.changes.length) return;
  const res = await S()("POST", "/sync/push", { device: deviceId, changes: out.changes });
  await replica.markSent(device.db, out.upTo);
  if (res.rejected.length) await replica.applyRemote(device.db, U, res.rejected);
}
async function pull() {
  for (;;) {
    const m = await replica.replicaMeta(device.db);
    const p = await S()("GET", "/sync/pull", undefined, { since: String(m.cursor), device: deviceId });
    await replica.applyRemote(device.db, U, p.changes, p.cursor);
    if (!p.more) break;
  }
}
async function sync() { await push(); await pull(); await push(); await pull(); }
const statusOn = async (e: Engine, id: string) => (await e.db.admin.query("SELECT status FROM workouts WHERE id = $1", [id])).rows[0]?.status ?? null;
const activeOn = async (e: Engine) => (await on(e)("GET", "/workouts/active"))?.id ?? null;

let routineId = "";
beforeAll(async () => {
  server = await createEngine(await pgliteDb("memory://"), { mode: "server" });
  U = uuidv7();
  await server.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'u','U')", [U]);
  device = await createEngine(await pgliteDb("memory://"), { mode: "local", seed: false });
  routineId = (await S()("POST", "/routines", { template: "push" })).id;
  const cat = await S()("GET", "/sync/catalog");
  await replica.loadCatalog(device.db, cat.stamp, cat.rows);
  deviceId = (await replica.loadSnapshot(device.db, await S()("GET", "/sync/snapshot"))).device;
}, 120000);

// each case on its own: a workout left running by a failed case is removed on both sides, quietly (not synced)
beforeEach(async () => {
  for (const e of [server, device]) await e.db.tx(async (q) => {
    await q.query("SELECT set_config('motus.sync_apply', '1', true)");
    await q.query("DELETE FROM workouts WHERE status = 'in_progress'");
  });
});

/** A workout started on the device, with every set of its first exercise ticked, and synced to the server. */
async function started() {
  const w = await D()("POST", "/workouts/start", { routineId });
  for (const s of w.exercises[0].sets) await D()("PUT", `/workout-sets/${s.id}`, { weightKg: 50, reps: 8, done: true });
  await sync();
  expect(await statusOn(server, w.id)).toBe("in_progress");
  return w;
}

describe("finishing and cancelling a workout stick through sync", () => {
  it("finish on the device, then sync", async () => {
    const w = await started();
    await D()("POST", `/workouts/${w.id}/finish`, {});
    await sync();
    expect(await statusOn(device, w.id)).toBe("completed");
    expect(await statusOn(server, w.id)).toBe("completed");
    expect(await activeOn(device)).toBe(null);
  }, 60000);

  it("finish on the device while the server still saw a later edit of the running workout", async () => {
    // e.g. the app's first seconds talk to the server directly, or another tab: a set changed there after the
    // device finished (but before the device's finish reached the server)
    const w = await started();
    await D()("POST", `/workouts/${w.id}/finish`, {});
    await tick();
    await S()("PUT", `/workout-sets/${w.exercises[1].sets[0].id}`, { reps: 12 });
    await sync();
    expect(await statusOn(device, w.id)).toBe("completed");
    expect(await statusOn(server, w.id)).toBe("completed");
    expect(await activeOn(device)).toBe(null);
    expect(await activeOn(server)).toBe(null);
  }, 60000);

  it("finish on the server while the device, offline, kept ticking sets", async () => {
    const w = await started();
    await S()("POST", `/workouts/${w.id}/finish`, {});
    await tick();
    // the device didn't know yet: a later change to the running workout (touches the workout row too)
    await D()("PUT", `/workout-sets/${w.exercises[0].sets[0].id}`, { reps: 9 });
    await sync();
    expect(await statusOn(server, w.id)).toBe("completed");
    expect(await statusOn(device, w.id)).toBe("completed");
    expect(await activeOn(device)).toBe(null);
  }, 60000);

  it("the server's later 'still running' version arrives before the device has sent its finish", async () => {
    const w = await started();
    await D()("POST", `/workouts/${w.id}/finish`, {});
    await tick();
    await S()("PUT", `/workout-sets/${w.exercises[0].sets[0].id}`, { reps: 7 });
    await pull(); // fetched first (a live update), the finish not sent yet
    expect(await statusOn(device, w.id)).toBe("completed");
    expect(await activeOn(device)).toBe(null);
    await push(); await pull();
    expect(await statusOn(server, w.id)).toBe("completed");
    expect(await replica.waitingCount(device.db)).toBe(0);
  }, 60000);

  it("the server's later version of a workout cancelled here arrives before the cancel is sent", async () => {
    const w = await started();
    await D()("POST", `/workouts/${w.id}/discard`);
    await tick();
    await S()("PUT", `/workouts/${w.id}`, { name: "Renamed on the server" });
    await pull();
    expect(await statusOn(device, w.id)).toBe(null);
    await push(); await pull();
    expect(await statusOn(server, w.id)).toBe(null);
  }, 60000);

  it("cancelling a finished workout says so instead of pretending", async () => {
    const w = await started();
    await D()("POST", `/workouts/${w.id}/finish`, {});
    const r = await raw(device, "POST", `/workouts/${w.id}/discard`);
    expect(r.status).toBe(409);
    expect(await statusOn(device, w.id)).toBe("completed");
    await sync();
  }, 60000);

  it("cancel on the device while the server saw a later edit of the workout", async () => {
    const w = await started();
    await D()("POST", `/workouts/${w.id}/discard`);
    await tick();
    await S()("PUT", `/workout-sets/${w.exercises[1].sets[0].id}`, { reps: 12 });
    await sync();
    expect(await statusOn(device, w.id)).toBe(null);
    expect(await statusOn(server, w.id)).toBe(null);
    expect(await activeOn(device)).toBe(null);
  }, 60000);

  it("cancel elsewhere while the device, offline, kept changing the workout", async () => {
    const w = await started();
    await S()("POST", `/workouts/${w.id}/discard`);
    await tick();
    await D()("PUT", `/workout-sets/${w.exercises[0].sets[0].id}`, { reps: 9 });
    await D()("PUT", `/workouts/${w.id}`, { name: "Renamed later" });
    await sync();
    expect(await statusOn(server, w.id)).toBe(null);
    expect(await statusOn(device, w.id)).toBe(null);
    expect(await activeOn(device)).toBe(null);
  }, 60000);

  it("set changes for a cancelled workout arriving late are refused, not a new workout", async () => {
    const w = await started();
    await D()("POST", `/workouts/${w.id}/discard`);
    const r = await raw(device, "PUT", `/workout-sets/${w.exercises[0].sets[0].id}`, { done: true });
    expect(r.status).toBe(404);
    await sync();
    expect(await statusOn(server, w.id)).toBe(null);
  }, 60000);

  it("finishing twice changes nothing the second time", async () => {
    const w = await started();
    await D()("POST", `/workouts/${w.id}/finish`, {});
    const first = (await device.db.admin.query("SELECT ended_at FROM workouts WHERE id = $1", [w.id])).rows[0].ended_at;
    await tick();
    await D()("POST", `/workouts/${w.id}/finish`, {});
    const second = (await device.db.admin.query("SELECT ended_at FROM workouts WHERE id = $1", [w.id])).rows[0].ended_at;
    expect(second).toEqual(first);
    await sync();
  }, 60000);

  it("after finishing, an empty workout starts a new one (no 'already in progress')", async () => {
    const w = await started();
    await D()("POST", `/workouts/${w.id}/finish`, {});
    await tick();
    await S()("PUT", `/workouts/${w.id}`, { notes: "edited on the server meanwhile" });
    await sync();
    const n = await D()("POST", "/workouts/start", { name: "Workout" });
    expect(n.id).not.toBe(w.id);
    expect(n.status).toBe("in_progress");
    await D()("POST", `/workouts/${n.id}/discard`);
    await sync();
    expect(await statusOn(server, n.id)).toBe(null);
  }, 60000);
});
