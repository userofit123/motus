// M-257: goals twice on the phone after a restore with Replace. A restore done inside the phone's copy (before restores
// went to the server) wrote rows whose ids another account on the server already had (a backup restored there too):
// the server refused them when they were sent, so they stayed only in the copy. A later restore on the server gave those
// rows new ids, the copy fetched them as changes, and showed both. Now such a row is moved to an id of the person's own
// on the server and on the device (never dropped: it is their data), a row the server can't write this time stays on
// the device and is sent again, a restore with Replace has every device make its copy again from the server, and a
// copy from before this is made again once.
// Every test makes its own server and devices: none depends on another having run.
import { describe, it, expect } from "vitest";
import { createEngine, replica, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7, ownCopyId } from "../src/ids";
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
   * One round of what the app does (apps/web api/replica.ts run): send (replica.pushAll), then fetch, or on a reset make
   * the copy again, sending what was made meanwhile and trying again with the same snapshot.
   */
  async function sync(d: Dev) {
    const pushed = await replica.pushAll(d.e.db, U, push);
    let remade = false;
    for (;;) {
      const p = await pull(d);
      if (p.reset) {
        if (await replica.waitingCount(d.e.db)) break;
        const cat = await S("GET", "/sync/catalog"), snap = await S("GET", "/sync/snapshot");
        let made = await replica.remakeCopy(d.e.db, cat, snap);
        for (let i = 0; !made && i < 5; i++) { pushed.push(...(await replica.pushAll(d.e.db, U, push))); made = await replica.remakeCopy(d.e.db, cat, snap); }
        remade = !!made;
        break;
      }
      await replica.applyRemote(d.e.db, U, p.changes, p.cursor);
      if (!p.more) break;
    }
    return { pushed, remade };
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

describe("a row the server can't take as sent", () => {
  it("whose id is another account's is moved to an id of the person's own, with the rows under it, and shown once", async () => {
    const w = await world();
    const file = await w.backup();
    const phone = await w.device();
    // the old app restored inside the copy: its rows keep the file's ids, another account's on the server
    await on(phone.e, w.U)("POST", "/import", { data: file, mode: "replace" });
    const before = await w.goals(phone.e);
    expect(before.length).toBe(2);
    const { pushed } = await w.sync(phone);
    expect(pushed.flatMap((r) => r.failed)).toEqual([]);
    // on the server under ids of the person's own, the same ones a restore here gives them
    const ids = await Promise.all(before.map((g) => w.server.db.tx((q) => ownCopyId(q, w.U, g.id))));
    expect((await w.goals(w.server)).map((g) => g.id).sort()).toEqual(ids.sort());
    // the device was sent the deletion of each old id and the person's own row under the new one, never the other's
    const back = pushed.flatMap((r) => r.rejected).filter((c: any) => c.tbl === "goals");
    expect(back.filter((c: any) => c.op === "delete").map((c: any) => c.pk.id).sort()).toEqual(before.map((g) => g.id).sort());
    expect(back.filter((c: any) => c.op === "upsert").every((c: any) => c.row.user_id === w.U && ids.includes(c.pk.id))).toBe(true);
    // each once on the device, as on the server, and the routine's exercise and set point at its new id there too
    expect(await w.goals(phone.e)).toEqual(await w.goals(w.server));
    for (const t of ["routines", "routine_exercises", "routine_sets"]) {
      expect((await w.rows(w.server, t)).length).toBe(1);
      expect(await w.rows(phone.e, t)).toEqual(await w.rows(w.server, t));
    }
    const [re] = await w.rows(w.server, "routine_exercises", "id, routine_id");
    expect(re.routine_id).toBe((await w.rows(w.server, "routines"))[0].id);
    expect(await replica.waitingCount(phone.e.db)).toBe(0);
    // the other account's rows are untouched
    expect((await w.server.db.admin.query("SELECT 1 FROM goals WHERE user_id = $1", [w.O])).rows.length).toBe(2);
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

  it("that failed for a passing reason stays on the device and is sent later", async () => {
    const w = await world();
    const phone = await w.device();
    const off = await w.flaky("goals", "40P01");
    await on(phone.e, w.U)("POST", "/goals", goal(20));
    const { pushed } = await w.sync(phone);
    expect(pushed.flatMap((r) => r.failed)).toMatchObject([{ tbl: "goals", retry: true }]);
    expect(pushed.flatMap((r) => r.rejected)).toEqual([]);
    expect((await w.goals(phone.e)).map((g) => Number(g.target))).toEqual([20]);
    expect(await replica.waitingCount(phone.e.db)).toBe(1);
    await off();
    await w.sync(phone);
    expect((await w.goals(w.server)).map((g) => Number(g.target))).toEqual([20]);
    expect(await replica.waitingCount(phone.e.db)).toBe(0);
  }, 120000);

  it("that is the parent of others in the same send keeps them too", async () => {
    const w = await world();
    const phone = await w.device();
    const off = await w.flaky("routines", "40001");
    const cat = (await phone.e.db.admin.query("SELECT id FROM exercises WHERE owner_id IS NULL ORDER BY id LIMIT 1")).rows[0].id;
    await on(phone.e, w.U)("POST", "/routines", { name: "Legs", exercises: [{ exerciseId: cat, sets: [{ reps: 5 }, { reps: 6 }] }] });
    const { pushed } = await w.sync(phone);
    const failed = pushed.flatMap((r) => r.failed);
    expect(failed.some((f: any) => f.tbl === "routine_exercises")).toBe(true);
    expect(failed.every((f: any) => f.retry)).toBe(true);
    expect(pushed.flatMap((r) => r.rejected)).toEqual([]);
    expect((await w.rows(phone.e, "routine_sets")).length).toBe(2);
    await off();
    await w.sync(phone);
    for (const t of ["routines", "routine_exercises", "routine_sets"]) expect(await w.rows(w.server, t)).toEqual(await w.rows(phone.e, t));
    expect((await w.rows(w.server, "routine_sets")).length).toBe(2);
    expect(await replica.waitingCount(phone.e.db)).toBe(0);
  }, 120000);

  it("whose parent was deleted on the server goes back off the device", async () => {
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
    const { pushed } = await w.sync(phone);
    expect(pushed.flatMap((r) => r.failed)).toEqual([]);
    expect((await w.rows(phone.e, "routines")).length).toBe(0);
    expect((await w.rows(phone.e, "routine_sets")).length).toBe(0);
    expect(await replica.waitingCount(phone.e.db)).toBe(0);
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

  it("keeps a change made while the snapshot downloads, sends it, and makes the copy from the same snapshot", async () => {
    const w = await restored();
    expect((await w.pull(w.phone)).reset).toBe(true);
    const cat = await w.S("GET", "/sync/catalog"), snap = await w.S("GET", "/sync/snapshot");
    // made here between the check and the download's end
    await on(w.phone.e, w.U)("POST", "/goals", goal(1000));
    const name = await w.phone.id();
    expect(await replica.remakeCopy(w.phone.e.db, cat, snap)).toBeNull();
    expect((await w.goals(w.phone.e)).map((g) => Number(g.target))).toContain(1000);
    await replica.pushAll(w.phone.e.db, w.U, w.push);
    expect((await w.goals(w.server)).map((g) => Number(g.target))).toContain(1000);
    // the snapshot is from before that send: the copy takes a new name, so the next fetch brings the change back in
    expect(await replica.remakeCopy(w.phone.e.db, cat, snap)).not.toBeNull();
    expect(await w.phone.id()).not.toBe(name);
    expect((await w.sync(w.phone)).remade).toBe(false);
    expect(await w.goals(w.phone.e)).toEqual(await w.goals(w.server));
    expect((await w.goals(w.phone.e)).length).toBe(3);
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
    try { expect(await replica.remakeCopy(db, cat, snap)).not.toBeNull(); } finally { db.tx = tx; }
    expect(await replica.waitingCount(db)).toBeGreaterThan(0);
    await w.sync(w.phone);
    expect((await w.goals(w.server)).map((g) => Number(g.target))).toContain(2000);
  }, 180000);
});

describe("a copy from before this fix (version 1)", () => {
  it("is made again once, without the row only it had, unless something waits to be sent", async () => {
    const w = await world();
    const d = await w.device();
    await w.strayGoal(d);
    await d.e.db.admin.query("UPDATE app_meta SET value = jsonb_set(value, '{v}', '1') WHERE key = 'replica'");
    expect(replica.outdated(await replica.replicaMeta(d.e.db))).toBe(true);
    const fetch = async () => [await w.S("GET", "/sync/catalog"), await w.S("GET", "/sync/snapshot")] as const;
    // something waiting: left as it is, still outdated
    await on(d.e, w.U)("POST", "/goals", goal(4000));
    expect(await replica.remakeCopy(d.e.db, ...(await fetch()))).toBeNull();
    expect(replica.outdated(await replica.replicaMeta(d.e.db))).toBe(true);
    await w.sync(d);
    const m = (await replica.remakeCopy(d.e.db, ...(await fetch())))!;
    expect(m.v).toBe(replica.COPY_VERSION);
    expect(replica.outdated(m)).toBe(false);
    expect(await w.goals(d.e)).toEqual(await w.goals(w.server));
    expect((await w.goals(d.e)).some((g) => Number(g.target) === 1)).toBe(false);
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
