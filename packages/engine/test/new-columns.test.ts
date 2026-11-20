// A program changed to strength still trained for muscle size on a device whose copy was made before programs had a
// goal (053): it took the server's row without the column, the update then gave the column its default, and the
// server's value never came again. A copy now fills the columns an app update adds from the server, once.
import { describe, it, expect } from "vitest";
import { createEngine, replica, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";

const on = (e: Engine, user: string) => async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
  const r = await e.handle({ method, path, body, query, userId: user });
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

async function world() {
  const server = await createEngine(await pgliteDb("memory://"), { mode: "server" });
  const U = uuidv7();
  await server.db.admin.query("INSERT INTO users (id, username) VALUES ($1,'me')", [U]);
  const S = on(server, U);
  const e = await createEngine(await pgliteDb("memory://"), { mode: "local", seed: false });
  const cat = await S("GET", "/sync/catalog");
  await replica.loadCatalog(e.db, cat.stamp, cat.rows);
  let snapshots = 0;
  const sync = () => replica.syncRound(e.db, U, {
    push: (body) => S("POST", "/sync/push", body),
    pull: (m) => S("GET", "/sync/pull", undefined, { since: String(m.cursor), device: m.device }),
    catalog: () => S("GET", "/sync/catalog"),
    snapshot: () => { snapshots++; return S("GET", "/sync/snapshot"); },
  });
  const pid = (await S("POST", "/programs", { name: "Test", weeks: [] })).id as string;
  await replica.loadSnapshot(e.db, await S("GET", "/sync/snapshot"));
  const goalHere = async () => (await e.db.admin.query("SELECT goal FROM programs WHERE id = $1", [pid])).rows[0].goal;
  /** the copy as an app from before 053 left it: the column's default, and a schema without it */
  async function beforeGoal() {
    await e.db.tx(async (q) => {
      await q.query("SELECT set_config('motus.sync_apply', '1', true)");
      await q.query("UPDATE programs SET goal = 'size' WHERE id = $1", [pid]);
    });
    const m = await replica.replicaMeta(e.db);
    const cols = { ...m.cols!, programs: m.cols!.programs!.filter((c) => c !== "goal") };
    await e.db.admin.query("UPDATE app_meta SET value = jsonb_set(value::jsonb, '{cols}', $1::jsonb) WHERE key = 'replica'", [JSON.stringify(cols)]);
  }
  return { S, e, pid, sync, goalHere, beforeGoal, snapshots: () => snapshots, local: on(e, U) };
}

describe("columns an app update adds", () => {
  it("a new copy knows its columns, so a sync fetches nothing extra", async () => {
    const w = await world();
    expect(replica.newColumns((await replica.replicaMeta(w.e.db)).cols, (await replica.replicaMeta(w.e.db)).cols!)).toEqual({});
    await w.sync();
    expect(w.snapshots()).toBe(0);
  });

  it("takes the server's goal for a copy made before programs had one, once", async () => {
    const w = await world();
    await w.S("PUT", `/programs/${w.pid}`, { goal: "strength" });
    await w.beforeGoal();
    // the change itself was already fetched (dropped by the old app): only the fill brings it
    expect(await w.goalHere()).toBe("size");
    await w.sync();
    expect(await w.goalHere()).toBe("strength");
    expect((await w.local("GET", `/programs/${w.pid}`)).goal).toBe("strength");
    await w.sync();
    expect(w.snapshots()).toBe(1);
  });

  it("a copy from before the columns were noted fills every column once", async () => {
    const w = await world();
    await w.S("PUT", `/programs/${w.pid}`, { goal: "endurance" });
    await w.beforeGoal();
    await w.e.db.admin.query("UPDATE app_meta SET value = value::jsonb - 'cols' WHERE key = 'replica'");
    await w.sync();
    expect(await w.goalHere()).toBe("endurance");
    await w.sync();
    expect(w.snapshots()).toBe(1);
  });

  it("a goal changed on this device after the update stays and reaches the server", async () => {
    const w = await world();
    await w.beforeGoal();
    await w.local("PUT", `/programs/${w.pid}`, { goal: "fatLoss" });
    await w.sync();
    expect(await w.goalHere()).toBe("fatLoss");
    expect((await w.S("GET", `/programs/${w.pid}`)).goal).toBe("fatLoss");
  });
});
