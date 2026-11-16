// M-257: goals twice on the phone after a restore with Replace. A restore done inside the phone's copy (before restores
// went to the server) wrote rows whose ids another account on the server already had (a backup restored there too):
// the server refused them when they were sent, so they stayed only in the copy. A later restore on the server gave those
// rows new ids, the copy fetched them as changes, and showed both. A restore with Replace now has every device make its
// copy again from the server, and a copy from before this is made again once.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, replica, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";

let server: Engine, device: Engine, U: string, O: string, deviceId = "";
const on = (e: Engine, user: string) => async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
  const r = await e.handle({ method, path, body, query, userId: user });
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const S = () => on(server, U), D = () => on(device, U);
const goals = async (e: Engine) => (await e.db.admin.query("SELECT id, target FROM goals WHERE user_id = $1 ORDER BY target", [U])).rows as any[];
/** One round of what the app does (apps/web api/replica.ts run): send, then fetch, or make the copy again on a reset. */
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
    if (p.reset) { await replica.remakeCopy(device.db, await S()("GET", "/sync/catalog"), await S()("GET", "/sync/snapshot")); break; }
    await replica.applyRemote(device.db, U, p.changes, p.cursor);
    if (!p.more) break;
  }
}

let file: any;
beforeAll(async () => {
  server = await createEngine(await pgliteDb("memory://"), { mode: "server" });
  U = uuidv7(); O = uuidv7();
  await server.db.admin.query("INSERT INTO users (id, username) VALUES ($1,'me'), ($2,'other')", [U, O]);
  // the backup, restored into a second account on the same server too: that account has the same goal ids
  await on(server, O)("POST", "/goals", { title: "Gym", scope: "activity", scopeId: "workout", metric: "sessions", target: 5, period: "week" });
  await on(server, O)("POST", "/goals", { title: "Weight", scope: "body", scopeId: "weight", metric: "body_weight", target: 80, period: "once" });
  file = await on(server, O)("GET", "/export");
  device = await createEngine(await pgliteDb("memory://"), { mode: "local", seed: false });
  const cat = await S()("GET", "/sync/catalog");
  await replica.loadCatalog(device.db, cat.stamp, cat.rows);
  deviceId = (await replica.loadSnapshot(device.db, await S()("GET", "/sync/snapshot"))).device;
}, 120000);

describe("a restore with Replace and a device's copy", () => {
  it("leaves the copy with the restored goals once, not beside rows the server refused", async () => {
    // the old app restored inside the copy: its goals keep the file's ids, which the server refuses when sent
    await D()("POST", "/import", { data: file, mode: "replace" });
    await sync();
    expect((await goals(device)).length).toBe(2);
    expect((await goals(server)).length).toBe(0);
    // restored again, on the server: the goals get ids of this account's own there
    await S()("POST", "/import", { data: file, mode: "replace" });
    expect((await goals(server)).length).toBe(2);
    await sync();
    expect(await goals(device)).toEqual(await goals(server));
    expect(await replica.waitingCount(device.db)).toBe(0);
    // and the copy keeps syncing as before
    await S()("POST", "/goals", { title: "Steps", scope: "activity", metric: "steps_avg", target: 8000, period: "day" });
    await sync();
    expect((await goals(device)).length).toBe(3);
  }, 120000);

  it("tells only copies from before the restore to make themselves again", async () => {
    const m = await replica.replicaMeta(device.db);
    expect((await S()("GET", "/sync/pull", undefined, { since: String(m.cursor), device: deviceId })).reset).toBeUndefined();
    await S()("POST", "/import", { data: file, mode: "merge" }); // a merge adds; it deletes nothing a copy could keep
    expect((await S()("GET", "/sync/pull", undefined, { since: String(m.cursor), device: deviceId })).reset).toBeUndefined();
  }, 60000);

  it("makes a copy from before this fix again once (it may still hold such rows)", () => {
    expect(replica.outdated({ cursor: 1, pushed: 0, device: "d", catalog: "", ready: true, v: 1 })).toBe(true);
    expect(replica.outdated({ cursor: 1, pushed: 0, device: "d", catalog: "", ready: true, v: replica.COPY_VERSION })).toBe(false);
  });
});
