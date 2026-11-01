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
    expect((await S()("GET", "/goals")).length).toBe(1);
  }, 60000);

  it("fetches changes made elsewhere", async () => {
    await S()("PUT", `/routines/${routineId}`, { name: "Push day" });
    await sync();
    expect((await D()("GET", `/routines/${routineId}`)).name).toBe("Push day");
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
    const g = (await D()("GET", "/goals"))[0];
    await D()("DELETE", `/goals/${g.id}`);
    await sync();
    expect((await S()("GET", "/goals")).length).toBe(0);
    const b = await S()("POST", "/body", { kind: "weight", value: 72 });
    await sync();
    expect((await D()("GET", "/body")).some((x: any) => x.id === b.id || x.value === 72)).toBe(true);
    await S()("DELETE", `/body/${(await S()("GET", "/body"))[0].id}`);
    await sync();
    expect((await D()("GET", "/body")).length).toBe(0);
  }, 60000);
});
