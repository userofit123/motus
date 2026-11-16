// M-257: goals twice on the phone after a restore with Replace. A restore done inside the phone's copy (before restores
// went to the server) wrote rows whose ids another account on the server already had (a backup restored there too):
// the server refused them when they were sent, so they stayed only in the copy. A later restore on the server gave those
// rows new ids, the copy fetched them as changes, and showed both. Now a row the server refuses goes back off the
// device, a restore with Replace has every device make its copy again from the server, and a copy from before this is
// made again once.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, replica, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import type { Sql } from "../src/db";

let server: Engine, U: string, O: string;
const on = (e: Engine, user: string) => async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
  const r = await e.handle({ method, path, body, query, userId: user });
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const S = () => on(server, U);
type Dev = { e: Engine; id: string };
const goals = async (e: Engine) => (await e.db.admin.query("SELECT id, target FROM goals WHERE user_id = $1 ORDER BY target, id", [U])).rows as any[];
const goal = (target: number) => ({ title: `G${target}`, scope: "activity", metric: "steps_avg", target, period: "day" });
const pull = async (d: Dev) => S()("GET", "/sync/pull", undefined, { since: String((await replica.replicaMeta(d.e.db)).cursor), device: d.id });
async function newDevice(): Promise<Dev> {
  const e = await createEngine(await pgliteDb("memory://"), { mode: "local", seed: false });
  const cat = await S()("GET", "/sync/catalog");
  await replica.loadCatalog(e.db, cat.stamp, cat.rows);
  return { e, id: (await replica.loadSnapshot(e.db, await S()("GET", "/sync/snapshot"))).device };
}
/** A row only this copy has, as an older app left it (written as the server's, so never sent). */
async function strayGoal(d: Dev) {
  await d.e.db.tx(async (q) => {
    await q.query("SELECT set_config('motus.sync_apply', '1', true)");
    await q.query("INSERT INTO goals (id, user_id, title, scope, metric, target, period) VALUES ($1, $2, 'Stray', 'activity', 'steps_avg', 1, 'day')", [uuidv7(), U]);
  });
}
/**
 * One round of what the app does (apps/web api/replica.ts run): send (taking back what the server sends back), then
 * fetch, or make the copy again on a reset, unless something is waiting (it goes first, on the next round).
 */
async function sync(d: Dev) {
  const pushed: any[] = [];
  for (;;) {
    const out = await replica.localChanges(d.e.db);
    if (!out.changes.length) break;
    const res = await S()("POST", "/sync/push", { device: d.id, changes: out.changes });
    pushed.push(res);
    await replica.markSent(d.e.db, out.upTo);
    if (res.rejected.length) await replica.applyRemote(d.e.db, U, res.rejected);
  }
  let remade = false;
  for (;;) {
    const p = await pull(d);
    if (p.reset) {
      if (await replica.waitingCount(d.e.db)) break;
      remade = !!(await replica.remakeCopy(d.e.db, await S()("GET", "/sync/catalog"), await S()("GET", "/sync/snapshot")));
      break;
    }
    await replica.applyRemote(d.e.db, U, p.changes, p.cursor);
    if (!p.more) break;
  }
  return { pushed, remade };
}

let file: any, phone: Dev, empty: Dev;
beforeAll(async () => {
  server = await createEngine(await pgliteDb("memory://"), { mode: "server" });
  U = uuidv7(); O = uuidv7();
  await server.db.admin.query("INSERT INTO users (id, username) VALUES ($1,'me'), ($2,'other')", [U, O]);
  // a copy made while the account had nothing: its place in the log is 0
  empty = await newDevice();
  // the backup, restored into a second account on the same server too: that account has the same goal ids
  await on(server, O)("POST", "/goals", { title: "Gym", scope: "activity", scopeId: "workout", metric: "sessions", target: 5, period: "week" });
  await on(server, O)("POST", "/goals", { title: "Weight", scope: "body", scopeId: "weight", metric: "body_weight", target: 80, period: "once" });
  file = await on(server, O)("GET", "/export");
  phone = await newDevice();
}, 120000);

describe("a row the server refuses", () => {
  it("goes back off the device, which is never sent another account's row", async () => {
    // the old app restored inside the copy: its goals keep the file's ids, another account's on the server
    await on(phone.e, U)("POST", "/import", { data: file, mode: "replace" });
    expect((await goals(phone.e)).length).toBe(2);
    const { pushed } = await sync(phone);
    const failed = pushed.flatMap((r) => r.failed), back = pushed.flatMap((r) => r.rejected).filter((c: any) => c.tbl === "goals");
    expect(failed.filter((f: any) => f.tbl === "goals").length).toBe(2);
    // sent back as deletions, never as the other account's rows
    expect(back.length).toBe(2);
    expect(back.every((c: any) => c.op === "delete" && c.row == null)).toBe(true);
    expect(await goals(phone.e)).toEqual([]);
    expect(await goals(server)).toEqual([]);
    expect((await server.db.admin.query("SELECT 1 FROM goals WHERE user_id = $1", [O])).rows.length).toBe(2);
    expect(await replica.waitingCount(phone.e.db)).toBe(0);
  }, 120000);
});

describe("a restore with Replace and the devices' copies", () => {
  let second: Dev;
  beforeAll(async () => {
    second = await newDevice();
    // what an older app's copy may still hold: a row the server never got
    await strayGoal(phone);
    await strayGoal(second);
    expect((await pull(phone)).reset).toBeUndefined();
    expect((await replica.replicaMeta(empty.e.db)).cursor).toBe(0);
    await S()("POST", "/import", { data: file, mode: "replace" });
    expect((await goals(server)).length).toBe(2);
  }, 120000);

  it("tells a copy whose place in the log is 0 too", async () => {
    expect((await pull(empty)).reset).toBe(true);
    expect((await sync(empty)).remade).toBe(true);
    expect(await goals(empty.e)).toEqual(await goals(server));
    expect((await pull(empty)).reset).toBeUndefined();
  }, 60000);

  it("keeps a change made while the snapshot downloads, and sends it before the copy is made again", async () => {
    expect((await pull(phone)).reset).toBe(true);
    const cat = await S()("GET", "/sync/catalog"), snap = await S()("GET", "/sync/snapshot");
    // made here between the check and the download's end
    await on(phone.e, U)("POST", "/goals", goal(1000));
    expect(await replica.remakeCopy(phone.e.db, cat, snap)).toBeNull();
    expect((await goals(phone.e)).map((g) => Number(g.target))).toContain(1000);
    expect(await replica.waitingCount(phone.e.db)).toBeGreaterThan(0);
    // the next round sends it, then makes the copy again with it in
    expect((await sync(phone)).remade).toBe(true);
    expect((await goals(server)).map((g) => Number(g.target))).toContain(1000);
    expect(await goals(phone.e)).toEqual(await goals(server));
    expect((await goals(phone.e)).length).toBe(3);
  }, 120000);

  it("never marks sent a change made just as the copy is made again", async () => {
    await S()("POST", "/import", { data: file, mode: "replace" });
    const cat = await S()("GET", "/sync/catalog"), snap = await S()("GET", "/sync/snapshot");
    // a change landing right after the copy's rows are written (the app's screens keep writing meanwhile)
    const tx = phone.e.db.tx, run = tx.bind(phone.e.db), n = { at: 0 };
    phone.e.db.tx = async <T>(fn: (q: Sql) => Promise<T>): Promise<T> => {
      const r = await run(fn);
      if (++n.at === 2) { phone.e.db.tx = tx; await on(phone.e, U)("POST", "/goals", goal(2000)); }
      return r;
    };
    try { expect(await replica.remakeCopy(phone.e.db, cat, snap)).not.toBeNull(); } finally { phone.e.db.tx = tx; }
    expect(await replica.waitingCount(phone.e.db)).toBeGreaterThan(0);
    await sync(phone);
    expect((await goals(server)).map((g) => Number(g.target))).toContain(2000);
  }, 120000);

  it("has a second device make its copy again once, without the row only it had", async () => {
    expect((await goals(second.e)).some((g) => Number(g.target) === 1)).toBe(true);
    expect((await sync(second)).remade).toBe(true);
    expect(await goals(second.e)).toEqual(await goals(server));
    // made again: not told again, and it keeps syncing as before
    expect((await pull(second)).reset).toBeUndefined();
    await S()("POST", "/goals", goal(3000));
    expect((await sync(second)).remade).toBe(false);
    expect(await goals(second.e)).toEqual(await goals(server));
  }, 120000);

  it("tells only copies from before the restore; a merge tells none", async () => {
    await sync(phone);
    expect((await pull(phone)).reset).toBeUndefined();
    await S()("POST", "/import", { data: file, mode: "merge" }); // a merge adds; it deletes nothing a copy could keep
    expect((await pull(phone)).reset).toBeUndefined();
  }, 60000);
});

describe("a copy from before this fix (version 1)", () => {
  it("is made again once, without the row only it had, unless something waits to be sent", async () => {
    const d = await newDevice();
    await strayGoal(d);
    await d.e.db.admin.query("UPDATE app_meta SET value = jsonb_set(value, '{v}', '1') WHERE key = 'replica'");
    expect(replica.outdated(await replica.replicaMeta(d.e.db))).toBe(true);
    const fetch = async () => [await S()("GET", "/sync/catalog"), await S()("GET", "/sync/snapshot")] as const;
    // something waiting: left as it is, still outdated
    await on(d.e, U)("POST", "/goals", goal(4000));
    expect(await replica.remakeCopy(d.e.db, ...(await fetch()))).toBeNull();
    expect(replica.outdated(await replica.replicaMeta(d.e.db))).toBe(true);
    await sync(d);
    const m = (await replica.remakeCopy(d.e.db, ...(await fetch())))!;
    expect(m.v).toBe(replica.COPY_VERSION);
    expect(replica.outdated(m)).toBe(false);
    expect(await goals(d.e)).toEqual(await goals(server));
    expect((await goals(d.e)).some((g) => Number(g.target) === 1)).toBe(false);
  }, 120000);
});

// The server gives a row whose id another account has an id of this account's own, the same one each time
// (modules/data.ts importAll), so a merge never adds a row twice there; duplicates on a device came from rows the
// server refused, which now go back off the device (above).
describe("merging a backup", () => {
  it("twice, or after a replace, adds nothing twice, on the server or a device", async () => {
    const d = await newDevice();
    const count = async () => (await S()("GET", "/export")).tables;
    const sizes = (t: any) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, (v as unknown[]).length]));
    await S()("POST", "/import", { data: file, mode: "merge" });
    const once = sizes(await count());
    await S()("POST", "/import", { data: file, mode: "merge" });
    expect(sizes(await count())).toEqual(once);
    await S()("POST", "/import", { data: file, mode: "replace" });
    const replaced = sizes(await count());
    await S()("POST", "/import", { data: file, mode: "merge" });
    expect(sizes(await count())).toEqual(replaced);
    // this account's own backup merged into it adds nothing either
    const own = await S()("GET", "/export");
    await S()("POST", "/import", { data: own, mode: "merge" });
    expect(sizes(await count())).toEqual(replaced);
    await sync(d);
    await sync(d);
    expect(await goals(d.e)).toEqual(await goals(server));
    const titles = (await goals(server)).map((g) => g.id);
    expect(new Set(titles).size).toBe(titles.length);
  }, 180000);
});
