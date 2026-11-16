// M-257: goals twice on the phone after a restore with Replace. A restore done inside the phone's copy (before restores
// went to the server) wrote rows whose ids another account on the server already had (a backup restored there too):
// the server refused them when they were sent, so they stayed only in the copy. A later restore on the server gave those
// rows new ids, the copy fetched them as changes, and showed both. Now a restore with Replace has every device make its
// copy again from the server (keeping what waits to be sent there, leaving out what the server refused for good), a row
// the server can't take this time stays on the device and is sent again later (never in a loop), and a copy from before
// this is made again once.
// Every test makes its own server and devices: none depends on another having run.
import { describe, it, expect } from "vitest";
import { createEngine, replica, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import type { Sql } from "../src/db";

type Dev = { e: Engine; id: () => Promise<string> };
const on = (e: Engine, user: string) => async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
  const r = await e.handle({ method, path, body, query, userId: user });
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const goal = (target: number) => ({ title: `G${target}`, scope: "activity", metric: "steps_avg", target, period: "day" });

/** A server with two accounts: U (the person) and O (another account the same backup was restored into). */
async function world() {
  const server = await createEngine(await pgliteDb("memory://"), { mode: "server" });
  const U = uuidv7(), O = uuidv7();
  await server.db.admin.query("INSERT INTO users (id, username) VALUES ($1,'me'), ($2,'other')", [U, O]);
  const S = on(server, U), other = on(server, O);
  const rows = async (e: Engine, t: string, cols = "id") => (await e.db.admin.query(`SELECT ${cols} FROM ${t} WHERE user_id = $1 ORDER BY ${cols}`, [U])).rows as any[];
  const goals = (e: Engine) => rows(e, "goals", "id, target");
  const pull = async (d: Dev) => S("GET", "/sync/pull", undefined, { since: String((await replica.replicaMeta(d.e.db)).cursor), device: await d.id() });
  const push = (body: unknown) => S("POST", "/sync/push", body);
  async function device(): Promise<Dev> {
    const e = await createEngine(await pgliteDb("memory://"), { mode: "local", seed: false });
    const cat = await S("GET", "/sync/catalog");
    await replica.loadCatalog(e.db, cat.stamp, cat.rows);
    await replica.loadSnapshot(e.db, await S("GET", "/sync/snapshot"));
    return { e, id: async () => (await replica.replicaMeta(e.db)).device };
  }
  /**
   * One round of what the app does (apps/web api/replica.ts run calls the same replica.syncRound). posts: every send.
   * now: the time the round takes for its retries; snapshot: run after the snapshot is fetched, before the copy is made.
   */
  async function sync(d: Dev, opts: { now?: number; snapshot?: () => Promise<void> } = {}) {
    const posts: any[] = [];
    const r = await replica.syncRound(d.e.db, U, {
      push: async (body) => { posts.push(body); return push(body); },
      pull: (m) => S("GET", "/sync/pull", undefined, { since: String(m.cursor), device: m.device }),
      catalog: () => S("GET", "/sync/catalog"),
      snapshot: async () => { const snap = await S("GET", "/sync/snapshot"); await opts.snapshot?.(); return snap; },
    }, { now: opts.now });
    return { ...r, pushed: r.answers, posts };
  }
  /** A row only this copy has, as an older app left it (written as the server's, so never sent). */
  async function strayGoal(d: Dev) {
    await d.e.db.tx(async (q) => {
      await q.query("SELECT set_config('motus.sync_apply', '1', true)");
      await q.query("INSERT INTO goals (id, user_id, title, scope, metric, target, period) VALUES ($1, $2, 'Stray', 'activity', 'steps_avg', 1, 'day')", [uuidv7(), U]);
    });
  }
  /** The backup: the other account's goals and a routine (with its exercise and set), restored there too. */
  async function backup() {
    await other("POST", "/goals", { title: "Gym", scope: "activity", scopeId: "workout", metric: "sessions", target: 5, period: "week" });
    await other("POST", "/goals", { title: "Weight", scope: "body", scopeId: "weight", metric: "body_weight", target: 80, period: "once" });
    const cat = (await server.db.admin.query("SELECT id FROM exercises WHERE owner_id IS NULL ORDER BY id LIMIT 1")).rows[0].id;
    await other("POST", "/routines", { name: "Push", exercises: [{ exerciseId: cat, sets: [{ reps: 5 }] }] });
    return other("GET", "/export");
  }
  /** Makes the server fail writes to a table with a SQLSTATE while `on` (a deadlock, say), as a passing failure would. */
  async function flaky(t: string, code: string) {
    await server.db.admin.exec(`CREATE TABLE IF NOT EXISTS flaky (t text PRIMARY KEY);
      CREATE OR REPLACE FUNCTION flaky_fail() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
        IF EXISTS (SELECT 1 FROM flaky WHERE flaky.t = TG_TABLE_NAME) THEN RAISE EXCEPTION 'test failure' USING ERRCODE = '${code}'; END IF;
        RETURN NEW; END $f$;
      GRANT SELECT ON flaky TO motus_app;
      CREATE TRIGGER flaky_${t} BEFORE INSERT OR UPDATE ON ${t} FOR EACH ROW EXECUTE FUNCTION flaky_fail();
      INSERT INTO flaky VALUES ('${t}');`);
    return () => server.db.admin.query("DELETE FROM flaky WHERE t = $1", [t]);
  }
  return { server, U, O, S, other, rows, goals, pull, push, device, sync, strayGoal, backup, flaky };
}

const LATER = () => Date.now() + 60 * 60_000; // past any wait before a retry (replica.retryWait)
const failedOf = (r: { pushed: any[] }) => r.pushed.flatMap((a) => a.failed);
const sentKeys = (r: { posts: any[] }) => r.posts.flatMap((b) => b.changes.map((c: any) => c.tbl + ":" + JSON.stringify(c.pk)));

describe("a row the server can't take as sent", () => {
  it("for good stays on the device, marked, and is sent again only when changed there", async () => {
    const w = await world();
    const phone = await w.device();
    const off = await w.flaky("goals", "23514"); // a check the row breaks: the same every time
    const { id } = await on(phone.e, w.U)("POST", "/goals", goal(20));
    const r = await w.sync(phone);
    expect(failedOf(r)).toMatchObject([{ tbl: "goals", pk: { id }, retry: false }]);
    expect(r.refused.length).toBe(1);
    expect(Object.values(await replica.holds(phone.e.db))).toMatchObject([{ tbl: "goals", pk: { id }, refused: true }]);
    expect((await w.goals(phone.e)).map((g) => Number(g.target))).toEqual([20]);
    expect(await w.goals(w.server)).toEqual([]);
    expect(await replica.waitingCount(phone.e.db)).toBe(0);
    // not sent again, however often the app syncs or however late it is
    for (let i = 0; i < 3; i++) expect((await w.sync(phone, { now: LATER() })).posts).toEqual([]);
    // changed here: sent again (still refused while the server can't take it, then taken)
    await on(phone.e, w.U)("PUT", `/goals/${id}`, goal(21));
    expect(sentKeys(await w.sync(phone))).toEqual([`goals:${JSON.stringify({ id })}`]);
    await off();
    await on(phone.e, w.U)("PUT", `/goals/${id}`, goal(22));
    expect(failedOf(await w.sync(phone))).toEqual([]);
    expect((await w.goals(w.server)).map((g) => Number(g.target))).toEqual([22]);
    expect(await replica.holds(phone.e.db)).toEqual({});
  }, 120000);

  it("for a passing reason is sent again later, waiting longer each time, while everything else goes on", async () => {
    const w = await world();
    const phone = await w.device();
    const off = await w.flaky("goals", "40P01");
    const { id } = await on(phone.e, w.U)("POST", "/goals", goal(20));
    await on(phone.e, w.U)("POST", "/routines", { name: "Legs", exercises: [] });
    const t0 = Date.now();
    const r = await w.sync(phone, { now: t0 });
    expect(r.posts.length).toBe(1);
    expect(failedOf(r)).toMatchObject([{ tbl: "goals", pk: { id }, retry: true }]);
    expect(r.refused).toEqual([]);
    // the routine sent with it is there
    expect((await w.rows(w.server, "routines")).length).toBe(1);
    expect(Object.values(await replica.holds(phone.e.db))).toMatchObject([{ tbl: "goals", tries: 1, next: t0 + replica.retryWait(1) }]);
    expect(await replica.waitingCount(phone.e.db)).toBe(1);
    // before its time: not sent, and what changed elsewhere still comes in
    await off();
    await w.S("POST", "/goals", goal(99));
    await w.server.db.admin.query("INSERT INTO flaky VALUES ('goals')");
    const r2 = await w.sync(phone, { now: t0 + 1000 });
    expect(r2.posts).toEqual([]);
    expect((await w.goals(phone.e)).map((g) => Number(g.target)).sort()).toEqual([20, 99]);
    // its time come: sent again, failing again, waiting twice as long
    const r3 = await w.sync(phone, { now: t0 + replica.retryWait(1) });
    expect(sentKeys(r3)).toEqual([`goals:${JSON.stringify({ id })}`]);
    expect(Object.values(await replica.holds(phone.e.db))).toMatchObject([{ tries: 2, next: t0 + replica.retryWait(1) + replica.retryWait(2) }]);
    expect(replica.retryWait(2)).toBe(2 * replica.retryWait(1));
    expect(replica.retryWait(50)).toBe(10 * 60_000);
    await off();
    await w.sync(phone, { now: LATER() });
    expect((await w.goals(w.server)).map((g) => Number(g.target)).sort()).toEqual([20, 99]);
    expect(await replica.holds(phone.e.db)).toEqual({});
    expect(await replica.waitingCount(phone.e.db)).toBe(0);
  }, 120000);

  it("that is the parent of others in the same send keeps them too", async () => {
    const w = await world();
    const phone = await w.device();
    const off = await w.flaky("routines", "40001");
    const cat = (await phone.e.db.admin.query("SELECT id FROM exercises WHERE owner_id IS NULL ORDER BY id LIMIT 1")).rows[0].id;
    await on(phone.e, w.U)("POST", "/routines", { name: "Legs", exercises: [{ exerciseId: cat, sets: [{ reps: 5 }, { reps: 6 }] }] });
    const r = await w.sync(phone);
    const failed = failedOf(r);
    expect(failed.some((f: any) => f.tbl === "routine_exercises")).toBe(true);
    expect(failed.every((f: any) => f.retry)).toBe(true);
    expect(r.pushed.flatMap((a) => a.rejected)).toEqual([]);
    expect((await w.rows(phone.e, "routine_sets")).length).toBe(2);
    await off();
    await w.sync(phone, { now: LATER() });
    for (const t of ["routines", "routine_exercises", "routine_sets"]) expect(await w.rows(w.server, t)).toEqual(await w.rows(phone.e, t));
    expect((await w.rows(w.server, "routine_sets")).length).toBe(2);
    expect(await replica.waitingCount(phone.e.db)).toBe(0);
  }, 120000);

  it("whose parent waits on the device after a passing failure is sent again, not refused, and gets there after it", async () => {
    const w = await world();
    const phone = await w.device();
    const off = await w.flaky("routines", "40001");
    const cat = (await phone.e.db.admin.query("SELECT id FROM exercises WHERE owner_id IS NULL ORDER BY id LIMIT 1")).rows[0].id;
    await on(phone.e, w.U)("POST", "/routines", { name: "Legs", exercises: [{ exerciseId: cat, sets: [{ reps: 5 }] }] });
    const t0 = Date.now();
    expect(failedOf(await w.sync(phone, { now: t0 })).every((f: any) => f.retry)).toBe(true);
    // the set edited here while its routine waits for its time: sent alone, where its routine's exercise isn't yet
    await phone.e.db.admin.query("UPDATE routine_sets SET reps = 9");
    const r = await w.sync(phone, { now: t0 + 1000 });
    expect(sentKeys(r).map((k) => k.split(":")[0])).toEqual(["routine_sets"]);
    expect(failedOf(r)).toMatchObject([{ tbl: "routine_sets", code: "23503", retry: true }]);
    expect(r.refused).toEqual([]);
    expect(Object.values(await replica.holds(phone.e.db)).some((h) => h.refused)).toBe(false);
    await off();
    await w.sync(phone, { now: LATER() });
    for (const t of ["routines", "routine_exercises", "routine_sets"]) expect(await w.rows(w.server, t)).toEqual(await w.rows(phone.e, t));
    expect((await w.rows(w.server, "routine_sets", "reps")).map((x) => x.reps)).toEqual([9]);
    expect(await replica.holds(phone.e.db)).toEqual({});
    expect(await replica.waitingCount(phone.e.db)).toBe(0);
  }, 120000);

  it("whose parent failed for a passing reason in an earlier page of the same send is sent again, not refused", async () => {
    const w = await world();
    const phone = await w.device();
    const off = await w.flaky("routines", "40001");
    const cat = (await phone.e.db.admin.query("SELECT id FROM exercises WHERE owner_id IS NULL ORDER BY id LIMIT 1")).rows[0].id;
    await on(phone.e, w.U)("POST", "/routines", { name: "Legs", exercises: [{ exerciseId: cat, sets: [{ reps: 5 }] }] });
    // the first page full (500 changes), the set's edit alone in the second
    const n = Number((await phone.e.db.admin.query("SELECT count(*) AS n FROM sync_log")).rows[0].n);
    await phone.e.db.admin.query(`INSERT INTO goals (id, user_id, title, scope, metric, target, period)
      SELECT gen_random_uuid(), $1, 'G', 'activity', 'steps_avg', g, 'day' FROM generate_series(1, $2::int) g`, [w.U, 500 - n]);
    await phone.e.db.admin.query("UPDATE routine_sets SET reps = 9");
    const r = await w.sync(phone);
    expect(r.posts.length).toBe(2);
    expect(r.posts[1].changes.map((c: any) => c.tbl)).toEqual(["routine_sets"]);
    expect(r.pushed[1].failed).toMatchObject([{ tbl: "routine_sets", code: "23503", retry: true }]);
    expect(r.refused).toEqual([]);
    await off();
    await w.sync(phone, { now: LATER() });
    expect((await w.rows(w.server, "routine_sets", "reps")).map((x) => x.reps)).toEqual([9]);
    expect(await replica.waitingCount(phone.e.db)).toBe(0);
  }, 180000);

  it("older than the server's comes back as the person's own row", async () => {
    const w = await world();
    const phone = await w.device();
    const { id } = await on(phone.e, w.U)("POST", "/goals", goal(10));
    await w.sync(phone);
    await on(phone.e, w.U)("PUT", `/goals/${id}`, goal(11));
    await w.S("PUT", `/goals/${id}`, goal(12)); // later, elsewhere
    const { pushed } = await w.sync(phone);
    const back = pushed.flatMap((r) => r.rejected);
    expect(back).toMatchObject([{ tbl: "goals", pk: { id }, op: "upsert", row: { id, user_id: w.U } }]);
    expect((await w.goals(phone.e)).map((g) => Number(g.target))).toEqual([12]);
  }, 120000);

  it("whose parent was deleted on the server is refused, and goes with its parent when the deletion comes in", async () => {
    const w = await world();
    const phone = await w.device();
    const cat = (await phone.e.db.admin.query("SELECT id FROM exercises WHERE owner_id IS NULL ORDER BY id LIMIT 1")).rows[0].id;
    const { id } = await on(phone.e, w.U)("POST", "/routines", { name: "Arms", exercises: [{ exerciseId: cat, sets: [{ reps: 5 }] }] });
    await w.sync(phone);
    // a set added here while the routine was deleted elsewhere
    const re = (await w.rows(phone.e, "routine_exercises"))[0].id;
    await phone.e.db.admin.query("INSERT INTO routine_sets (id, user_id, routine_exercise_id, position) VALUES ($1, $2, $3, 9)", [uuidv7(), w.U, re]);
    // deleted for good (the Routines page only archives): its exercises go with it
    await w.server.db.admin.query("DELETE FROM routines WHERE id = $1", [id]);
    const r = await w.sync(phone);
    expect(failedOf(r)).toMatchObject([{ tbl: "routine_sets", retry: false }]);
    expect((await w.rows(phone.e, "routines")).length).toBe(0);
    expect((await w.rows(phone.e, "routine_sets")).length).toBe(0);
    expect(await replica.waitingCount(phone.e.db)).toBe(0);
  }, 120000);

  it("a deletion the server can't make (something there still uses the row) brings the row back", async () => {
    const w = await world();
    const phone = await w.device();
    const { id } = await on(phone.e, w.U)("POST", "/exercises", { name: "Mine", tracking: "weight_reps", primaryMuscles: ["chest"] });
    await w.sync(phone);
    // used in a routine made elsewhere, not yet heard of here, where it is deleted (unused here)
    await w.S("POST", "/routines", { name: "Chest", exercises: [{ exerciseId: id, sets: [{ reps: 5 }] }] });
    await on(phone.e, w.U)("DELETE", `/exercises/${id}`);
    expect((await phone.e.db.admin.query("SELECT 1 FROM exercises WHERE id = $1", [id])).rows.length).toBe(0);
    const r = await w.sync(phone);
    expect(failedOf(r)).toEqual([]);
    expect(r.pushed.flatMap((a) => a.rejected)).toMatchObject([{ tbl: "exercises", pk: { id }, op: "upsert", row: { id, owner_id: w.U } }]);
    // back here, still the person's own, with the routine that uses it
    expect((await phone.e.db.admin.query("SELECT owner_id FROM exercises WHERE id = $1", [id])).rows).toEqual([{ owner_id: w.U }]);
    expect((await w.rows(phone.e, "routine_exercises", "exercise_id")).map((x) => x.exercise_id)).toEqual([id]);
    expect(await replica.waitingCount(phone.e.db)).toBe(0);
    expect((await w.sync(phone)).posts).toEqual([]);
  }, 120000);

  it("comes back stamped with when it changed there, so an edit made here during the send stays", async () => {
    const w = await world();
    const phone = await w.device();
    const { id } = await on(phone.e, w.U)("POST", "/goals", goal(30));
    await w.sync(phone);
    await on(phone.e, w.U)("PUT", `/goals/${id}`, goal(31));
    await w.S("PUT", `/goals/${id}`, goal(32)); // newer than 31: the server's wins and goes back
    await new Promise((ok) => setTimeout(ok, 5));
    // an edit on the device while the send is on its way (after what is sent was read, before the server answers):
    // newer than both
    let edited = false;
    const post = async (body: unknown) => {
      if (!edited) { edited = true; await on(phone.e, w.U)("PUT", `/goals/${id}`, goal(33)); }
      return w.push(body);
    };
    const res = await replica.pushAll(phone.e.db, w.U, post);
    expect(res.flatMap((r) => r.rejected)).toMatchObject([{ pk: { id }, op: "upsert" }]);
    expect((await w.goals(phone.e)).map((g) => Number(g.target))).toEqual([33]);
    await w.sync(phone);
    expect((await w.goals(w.server)).map((g) => Number(g.target))).toEqual([33]);
  }, 120000);
});

describe("an app from before this", () => {
  it("sends and takes in the answer as it always did: a refused row stays there", async () => {
    const w = await world();
    const phone = await w.device();
    const off = await w.flaky("goals", "23514");
    await on(phone.e, w.U)("POST", "/goals", goal(40));
    // what that app did: send, forget what was sent, write what came back
    const out = await replica.localChanges(phone.e.db);
    const res = await w.push({ device: await phone.id(), user: w.U, changes: out.changes });
    expect(Object.keys(res).sort()).toEqual(["applied", "failed", "rejected"]);
    expect(res.failed).toMatchObject([{ tbl: "goals" }]);
    expect(res.rejected).toEqual([]);
    await replica.markSent(phone.e.db, out.upTo);
    await replica.applyRemote(phone.e.db, w.U, res.rejected);
    expect((await w.goals(phone.e)).map((g) => Number(g.target))).toEqual([40]);
    await off();
  }, 120000);
});

describe("the shared catalog on a device", () => {
  it("stays the catalog's when the server sends a row of it back", async () => {
    const w = await world();
    const phone = await w.device();
    const row = (await phone.e.db.admin.query("SELECT to_jsonb(x) AS r FROM exercises x WHERE owner_id IS NULL ORDER BY id LIMIT 1")).rows[0].r;
    await replica.applyRemote(phone.e.db, w.U, [{ tbl: "exercises", pk: { id: row.id }, op: "upsert", at: new Date().toISOString(), row }]);
    expect((await phone.e.db.admin.query("SELECT owner_id FROM exercises WHERE id = $1", [row.id])).rows[0].owner_id).toBeNull();
  }, 60000);
});

describe("a restore with Replace and the devices' copies", () => {
  /** A world where a backup was restored with Replace on the server after the devices made their copies. */
  async function restored() {
    const w = await world();
    const empty = await w.device(); // made while the account had nothing: its place in the log is 0
    const file = await w.backup();
    const phone = await w.device();
    await w.strayGoal(phone); // what an older app's copy may still hold: a row the server never got
    expect((await w.pull(phone)).reset).toBeUndefined();
    await w.S("POST", "/import", { data: file, mode: "replace" });
    expect((await w.goals(w.server)).length).toBe(2);
    return { ...w, empty, phone, file };
  }

  it("tells a copy whose place in the log is 0 too", async () => {
    const w = await restored();
    expect((await replica.replicaMeta(w.empty.e.db)).cursor).toBe(0);
    expect((await w.pull(w.empty)).reset).toBe(true);
    expect((await w.sync(w.empty)).remade).toBe(true);
    expect(await w.goals(w.empty.e)).toEqual(await w.goals(w.server));
    expect((await w.pull(w.empty)).reset).toBeUndefined();
  }, 180000);

  it("makes the copy again without the row only it had, once", async () => {
    const w = await restored();
    expect((await w.goals(w.phone.e)).some((g) => Number(g.target) === 1)).toBe(true);
    expect((await w.sync(w.phone)).remade).toBe(true);
    expect(await w.goals(w.phone.e)).toEqual(await w.goals(w.server));
    expect((await w.pull(w.phone)).reset).toBeUndefined();
    await w.S("POST", "/goals", goal(3000));
    expect((await w.sync(w.phone)).remade).toBe(false);
    expect(await w.goals(w.phone.e)).toEqual(await w.goals(w.server));
    // a merge adds; it deletes nothing a copy could keep: no copy is told
    await w.S("POST", "/import", { data: w.file, mode: "merge" });
    expect((await w.pull(w.phone)).reset).toBeUndefined();
  }, 180000);

  it("shows each row once after a restore done inside the copy that the server refused (M-257)", async () => {
    const w = await world();
    const file = await w.backup();
    const phone = await w.device();
    // the old app restored inside the copy: its rows keep the file's ids, another account's on the server
    await on(phone.e, w.U)("POST", "/import", { data: file, mode: "replace" });
    expect((await w.goals(phone.e)).length).toBe(2);
    const r = await w.sync(phone);
    expect(failedOf(r).length).toBeGreaterThan(0);
    expect(failedOf(r).every((f: any) => !f.retry)).toBe(true);
    expect(await w.goals(w.server)).toEqual([]);
    expect(await replica.waitingCount(phone.e.db)).toBe(0);
    expect((await w.sync(phone, { now: LATER() })).posts).toEqual([]);
    // the same backup restored with Replace on the server: the rows get ids of the person's own there
    await w.S("POST", "/import", { data: file, mode: "replace" });
    const r2 = await w.sync(phone);
    expect(r2.remade).toBe(true);
    // each refused row is said to be gone from the device
    expect(r2.removed.length).toBe(failedOf(r).length);
    expect((await w.goals(phone.e)).length).toBe(2);
    expect(await w.goals(phone.e)).toEqual(await w.goals(w.server));
    for (const t of ["routines", "routine_exercises", "routine_sets"]) {
      expect((await w.rows(w.server, t)).length).toBe(1);
      expect(await w.rows(phone.e, t)).toEqual(await w.rows(w.server, t));
    }
    expect(await replica.holds(phone.e.db)).toEqual({});
    expect(await replica.waitingCount(phone.e.db)).toBe(0);
    // the other account's rows are untouched
    expect((await w.server.db.admin.query("SELECT 1 FROM goals WHERE user_id = $1", [w.O])).rows.length).toBe(2);
  }, 180000);

  it("keeps a change made while the snapshot downloads, and sends it", async () => {
    const w = await restored();
    await w.sync(w.phone);
    const [g] = await w.goals(w.server);
    // the same backup restored again: the copy is told again, and something is changed here meanwhile
    await w.S("POST", "/import", { data: w.file, mode: "replace" });
    const r = await w.sync(w.phone, {
      snapshot: async () => {
        await on(w.phone.e, w.U)("PUT", `/goals/${g.id}`, goal(777));
        await on(w.phone.e, w.U)("POST", "/goals", goal(1000));
      },
    });
    expect(r.remade).toBe(true);
    const targets = (await w.goals(w.server)).map((x) => Number(x.target));
    expect(targets).toContain(777);
    expect(targets).toContain(1000);
    expect(await w.goals(w.phone.e)).toEqual(await w.goals(w.server));
    expect((await w.goals(w.phone.e)).length).toBe(3);
    expect(await replica.waitingCount(w.phone.e.db)).toBe(0);
  }, 180000);

  it("never loops: the copy is made again with a row refused for good and one the server keeps failing on", async () => {
    const w = await world();
    const file = await w.backup();
    const phone = await w.device();
    // refused for good: a goal whose id is the other account's
    const theirs = (await w.server.db.admin.query("SELECT id FROM goals WHERE user_id = $1 LIMIT 1", [w.O])).rows[0].id;
    await phone.e.db.admin.query("INSERT INTO goals (id, user_id, title, scope, metric, target, period) VALUES ($1, $2, 'Theirs', 'activity', 'steps_avg', 5, 'day')", [theirs, w.U]);
    // failing every time for a passing reason
    const off = await w.flaky("routines", "40P01");
    await on(phone.e, w.U)("POST", "/routines", { name: "Kept", exercises: [] });
    const t0 = Date.now();
    const r = await w.sync(phone, { now: t0 });
    // (the routine's first version, under it, fails with it and is tried again with it)
    expect(failedOf(r).filter((f: any) => !f.retry).map((f: any) => f.tbl)).toEqual(["goals"]);
    expect(failedOf(r).filter((f: any) => f.retry).map((f: any) => f.tbl).sort()).toEqual(["routine_versions", "routines"]);
    // (the restore itself must get through)
    await off();
    await w.S("POST", "/import", { data: file, mode: "replace" });
    await w.server.db.admin.query("INSERT INTO flaky VALUES ('routines')");
    // the copy is made again at once, though a row waits to be sent; that row is sent once with what waited
    const r2 = await w.sync(phone, { now: t0 + 1000 });
    expect(r2.remade).toBe(true);
    expect(sentKeys(r2).filter((k) => k.startsWith("routines:")).length).toBe(1);
    expect(r2.posts.length).toBe(1);
    expect(sentKeys(r2).some((k) => k.startsWith("goals:"))).toBe(false);
    expect(await w.goals(phone.e)).toEqual(await w.goals(w.server));
    expect((await w.goals(phone.e)).some((g) => g.id === theirs)).toBe(false);
    expect((await w.rows(phone.e, "routines", "name")).map((x) => x.name).sort()).toEqual(["Kept", "Push"]);
    // later syncs before the row's time: nothing sent, nothing made again
    for (let i = 0; i < 5; i++) {
      const again = await w.sync(phone, { now: t0 + 2000 });
      expect(again.posts).toEqual([]);
      expect(again.remade).toBe(false);
    }
    await off();
    await w.sync(phone, { now: LATER() });
    expect((await w.rows(w.server, "routines", "name")).map((x) => x.name).sort()).toEqual(["Kept", "Push"]);
    expect(await replica.waitingCount(phone.e.db)).toBe(0);
  }, 180000);

  it("keeps a workout's routine that gets in only once its removed folder is cleared", async () => {
    const w = await world();
    const phone = await w.device();
    const { id: folder } = await on(phone.e, w.U)("POST", "/folders", { name: "Old" });
    await w.sync(phone);
    await w.S("POST", "/import", { data: await w.backup(), mode: "replace" }); // the folder goes on the server
    // made here while the snapshot downloads: a routine in that folder and a workout of it
    let routine = "";
    const workout = uuidv7();
    const r = await w.sync(phone, {
      snapshot: async () => {
        routine = (await on(phone.e, w.U)("POST", "/routines", { name: "Mine", folderId: folder, exercises: [] })).id;
        await phone.e.db.admin.query("INSERT INTO workouts (id, user_id, routine_id, name, status, started_at, ended_at) VALUES ($1, $2, $3, 'Mine', 'completed', now(), now())", [workout, w.U, routine]);
      },
    });
    expect(r.remade).toBe(true);
    expect(r.removed).toEqual([]);
    expect((await phone.e.db.admin.query("SELECT folder_id FROM routines WHERE id = $1", [routine])).rows).toEqual([{ folder_id: null }]);
    for (const e of [phone.e, w.server]) expect((await e.db.admin.query("SELECT routine_id FROM workouts WHERE id = $1", [workout])).rows).toEqual([{ routine_id: routine }]);
    expect(await replica.waitingCount(phone.e.db)).toBe(0);
  }, 180000);

  it("says what it removed from the copy: a row refused for good, and a change that no longer fits", async () => {
    const w = await world();
    const phone = await w.device();
    const cat = (await phone.e.db.admin.query("SELECT id FROM exercises WHERE owner_id IS NULL ORDER BY id LIMIT 1")).rows[0].id;
    await on(phone.e, w.U)("POST", "/routines", { name: "Arms", exercises: [{ exerciseId: cat, sets: [{ reps: 5 }] }] });
    await w.sync(phone);
    const set = (await w.rows(phone.e, "routine_sets"))[0].id;
    const off = await w.flaky("goals", "23514");
    const { id: g } = await on(phone.e, w.U)("POST", "/goals", goal(20));
    expect((await w.sync(phone)).refused.length).toBe(1);
    await off();
    await w.S("POST", "/import", { data: await w.backup(), mode: "replace" }); // the routine goes on the server
    // the set changed here while the snapshot downloads: its routine's exercise is in neither the snapshot nor what waits
    const r = await w.sync(phone, { snapshot: async () => { await phone.e.db.admin.query("UPDATE routine_sets SET reps = 9 WHERE id = $1", [set]); } });
    expect(r.remade).toBe(true);
    expect(r.removed).toMatchObject([{ tbl: "goals", pk: { id: g }, op: "upsert" }, { tbl: "routine_sets", pk: { id: set }, op: "upsert" }]);
    expect(await w.goals(phone.e)).toEqual(await w.goals(w.server));
    expect(await w.rows(phone.e, "routine_sets")).toEqual(await w.rows(w.server, "routine_sets"));
    expect(await replica.waitingCount(phone.e.db)).toBe(0);
  }, 180000);

  it("keeps a row refused for good that changed here since, and sends it", async () => {
    const w = await world();
    const phone = await w.device();
    const off = await w.flaky("goals", "23514");
    const { id } = await on(phone.e, w.U)("POST", "/goals", goal(20));
    expect((await w.sync(phone)).refused.length).toBe(1);
    await off();
    await w.S("POST", "/import", { data: await w.backup(), mode: "replace" });
    // changed after its refusal, before the copy is made again
    const r = await w.sync(phone, { snapshot: async () => { await on(phone.e, w.U)("PUT", `/goals/${id}`, goal(21)); } });
    expect(r.remade).toBe(true);
    expect(r.removed).toEqual([]);
    expect(Number((await w.goals(w.server)).find((x) => x.id === id)?.target)).toBe(21);
    expect(await w.goals(phone.e)).toEqual(await w.goals(w.server));
    expect(await replica.holds(phone.e.db)).toEqual({});
  }, 180000);

  it("never marks sent a change made just as the copy is made again", async () => {
    const w = await restored();
    const cat = await w.S("GET", "/sync/catalog"), snap = await w.S("GET", "/sync/snapshot");
    // a change landing right after the copy's rows are written (the app's screens keep writing meanwhile): after the
    // first transaction that leaves the copy at the snapshot's place, however many come before it
    const db = w.phone.e.db, tx = db.tx, run = tx.bind(db);
    db.tx = async <T>(fn: (q: Sql) => Promise<T>): Promise<T> => {
      const r = await run(fn);
      if ((await replica.replicaMeta(db)).cursor === snap.cursor) { db.tx = tx; await on(w.phone.e, w.U)("POST", "/goals", goal(2000)); }
      return r;
    };
    try { await replica.remakeCopy(db, cat, snap); } finally { db.tx = tx; }
    expect(await replica.waitingCount(db)).toBeGreaterThan(0);
    await w.sync(w.phone);
    expect((await w.goals(w.server)).map((g) => Number(g.target))).toContain(2000);
  }, 180000);
});

describe("a copy from before this fix (version 1)", () => {
  it("is made again once, without the row only it had, keeping what waits to be sent", async () => {
    const w = await world();
    const d = await w.device();
    await w.strayGoal(d);
    await d.e.db.admin.query("UPDATE app_meta SET value = jsonb_set(value, '{v}', '1') WHERE key = 'replica'");
    expect(replica.outdated(await replica.replicaMeta(d.e.db))).toBe(true);
    await on(d.e, w.U)("POST", "/goals", goal(4000));
    const m = await replica.remakeCopy(d.e.db, await w.S("GET", "/sync/catalog"), await w.S("GET", "/sync/snapshot"));
    expect(m.v).toBe(replica.COPY_VERSION);
    expect(replica.outdated(m)).toBe(false);
    expect(m.dropped).toEqual([]);
    expect((await w.goals(d.e)).map((g) => Number(g.target))).toEqual([4000]);
    expect(await replica.waitingCount(d.e.db)).toBe(1);
    await w.sync(d);
    expect(await w.goals(d.e)).toEqual(await w.goals(w.server));
    expect((await w.goals(w.server)).map((g) => Number(g.target))).toEqual([4000]);
  }, 120000);
});

// The server gives a row whose id another account has an id of this account's own, the same one each time
// (modules/data.ts importAll), so a merge never adds a row twice there.
describe("merging a backup", () => {
  it("twice, or after a replace, adds nothing twice, on the server or a device", async () => {
    const w = await world();
    const file = await w.backup();
    const d = await w.device();
    const count = async () => (await w.S("GET", "/export")).tables;
    const sizes = (t: any) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, (v as unknown[]).length]));
    await w.S("POST", "/import", { data: file, mode: "merge" });
    const once = sizes(await count());
    await w.S("POST", "/import", { data: file, mode: "merge" });
    expect(sizes(await count())).toEqual(once);
    await w.S("POST", "/import", { data: file, mode: "replace" });
    const replaced = sizes(await count());
    await w.S("POST", "/import", { data: file, mode: "merge" });
    expect(sizes(await count())).toEqual(replaced);
    // this account's own backup merged into it adds nothing either
    await w.S("POST", "/import", { data: await w.S("GET", "/export"), mode: "merge" });
    expect(sizes(await count())).toEqual(replaced);
    await w.sync(d);
    await w.sync(d);
    expect(await w.goals(d.e)).toEqual(await w.goals(w.server));
    const ids = (await w.goals(w.server)).map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  }, 180000);
});
