// M-184: a device's rows may only point at its own person's rows. A copy that once held another account's rows sent
// workouts, plans and reminders naming that account's routines; the server took them because foreign keys are
// checked without row-level security. The server now checks every reference a device sends, refuses a sync from a
// copy that isn't the signed-in person's, and 032_own_references repairs what got in before.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, replica, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { migrate } from "../src/migrate";
import { uuidv7 } from "../src/ids";

let server: Engine, A: string, B: string;
const as = (user: string) => async (method: string, path: string, body?: unknown, query?: Record<string, string>) =>
  server.handle({ method, path, body, query, userId: user });
const ok = async (p: Promise<{ status: number; body: unknown }>) => {
  const r = await p;
  if (r.status !== 200) throw new Error(`${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const at = () => new Date().toISOString();
const upsert = (tbl: string, row: Record<string, unknown>) => ({ tbl, pk: { id: row.id }, op: "upsert", at: at(), row });

beforeAll(async () => {
  server = await createEngine(await pgliteDb("memory://"), { mode: "server" });
  [A, B] = [uuidv7(), uuidv7()];
  await server.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'a','A'), ($2,'b','B')", [A, B]);
}, 120000);

describe("references in a device's changes", () => {
  let mine = "", theirs = "", theirEx = "", snap: any;
  beforeAll(async () => {
    mine = (await ok(as(A)("POST", "/routines", { template: "push" }))).id;
    theirs = (await ok(as(B)("POST", "/routines", { template: "pull" }))).id;
    theirEx = (await ok(as(B)("GET", `/routines/${theirs}`))).exercises[0].id;
    await ok(as(A)("POST", "/schedules", { routineId: mine, rule: "weekly", days: [1] }));
    snap = (await ok(as(A)("GET", "/sync/snapshot"))).tables;
  }, 60000);

  it("still takes a normal push", async () => {
    const s = { ...snap.schedules[0], id: uuidv7(), days: [2] };
    const res = await ok(as(A)("POST", "/sync/push", { device: "d1", user: A, changes: [upsert("schedules", s)] }));
    expect(res).toMatchObject({ applied: 1, failed: [], rejected: [] });
    expect((await server.db.admin.query("SELECT routine_id FROM schedules WHERE id = $1", [s.id])).rows[0].routine_id).toBe(mine);
  });

  it("clears an optional reference to someone else's row and sends the device the row as written", async () => {
    const s = { ...snap.schedules[0], id: uuidv7(), routine_id: theirs };
    const w = { id: uuidv7(), user_id: A, name: "Pull", routine_id: theirs, status: "completed", started_at: at(), finished_at: at() };
    const res = await ok(as(A)("POST", "/sync/push", { device: "d1", user: A, changes: [upsert("schedules", s), upsert("workouts", w)] }));
    expect(res.applied).toBe(2);
    expect(res.rejected.map((c: any) => [c.tbl, c.row.routine_id])).toEqual([["schedules", null], ["workouts", null]]);
    const rows = (await server.db.admin.query("SELECT routine_id FROM schedules WHERE id = $1 UNION ALL SELECT routine_id FROM workouts WHERE id = $2", [s.id, w.id])).rows;
    expect(rows).toEqual([{ routine_id: null }, { routine_id: null }]);
    // the other account's routine is untouched and still only theirs
    expect((await ok(as(B)("GET", `/routines/${theirs}`))).name).toBe("Pull");
  });

  it("refuses a row that means nothing without someone else's row", async () => {
    const reminder = { id: uuidv7(), user_id: A, target_type: "routine", target_id: theirs, body: "x", trigger: "next", status: "pending" };
    const re = { id: uuidv7(), user_id: A, routine_id: theirs, exercise_id: (await ok(as(A)("GET", `/routines/${mine}`))).exercises[0].exerciseId, position: 9 };
    const set = { id: uuidv7(), user_id: A, routine_exercise_id: theirEx, position: 0, kind: "normal", reps: 5 };
    const res = await ok(as(A)("POST", "/sync/push", { device: "d1", user: A, changes: [upsert("reminders", reminder), upsert("routine_exercises", re), upsert("routine_sets", set)] }));
    expect(res.applied).toBe(0);
    expect(res.failed.map((f: any) => f.tbl).sort()).toEqual(["reminders", "routine_exercises", "routine_sets"]);
    expect((await server.db.admin.query("SELECT count(*)::int AS n FROM routine_exercises WHERE routine_id = $1 AND user_id = $2", [theirs, A])).rows[0].n).toBe(0);
  });

  it("leaves someone else's routines out of a program's days", async () => {
    const p = { id: uuidv7(), user_id: A, name: "P", weeks: [{ days: [mine, theirs, mine], deload: false }], deload_pct: 40, start_date: at().slice(0, 10), active: false };
    const res = await ok(as(A)("POST", "/sync/push", { device: "d1", user: A, changes: [upsert("programs", p)] }));
    expect(res.applied).toBe(1);
    expect(res.rejected[0].row.weeks).toEqual([{ days: [mine, mine], deload: false }]);
  });

  it("takes references to the person's own rows sent later in the same push: a workout finished offline", async () => {
    // rows go table by table, so the routine's new version comes before the workout it names
    const w = { id: uuidv7(), user_id: A, name: "Push", routine_id: mine, status: "completed", started_at: at(), finished_at: at() };
    const v = { id: uuidv7(), user_id: A, routine_id: mine, snapshot: {}, reason: "workout", workout_id: w.id };
    const note = { id: uuidv7(), user_id: A, target_type: "workout", target_id: w.id, body: "Felt strong" };
    const res = await ok(as(A)("POST", "/sync/push", { device: "d1", user: A, changes: [upsert("notes", note), upsert("routine_versions", v), upsert("workouts", w)] }));
    expect(res).toMatchObject({ applied: 3, failed: [], rejected: [] });
    expect((await server.db.admin.query("SELECT workout_id FROM routine_versions WHERE id = $1", [v.id])).rows[0].workout_id).toBe(w.id);
    expect((await server.db.admin.query("SELECT target_id FROM notes WHERE id = $1", [note.id])).rows[0].target_id).toBe(w.id);
  });

  it("keeps a program's day naming a routine of the person's sent in the same push or a later one", async () => {
    const r1 = { id: uuidv7(), user_id: A, name: "New" }, r2 = { id: uuidv7(), user_id: A, name: "Later" };
    const p = { id: uuidv7(), user_id: A, name: "P2", weeks: [{ days: [r1.id, r2.id, theirs], deload: false }], deload_pct: 40, start_date: at().slice(0, 10), active: false };
    const res = await ok(as(A)("POST", "/sync/push", { device: "d1", user: A, changes: [upsert("programs", p), upsert("routines", r1)] }));
    expect(res.applied).toBe(2);
    // only someone else's routine goes; the one not sent yet (the next page) stays
    expect(res.rejected[0].row.weeks).toEqual([{ days: [r1.id, r2.id], deload: false }]);
    await ok(as(A)("POST", "/sync/push", { device: "d1", user: A, changes: [upsert("routines", r2)] }));
    expect((await server.db.admin.query("SELECT weeks FROM programs WHERE id = $1", [p.id])).rows[0].weeks).toEqual([{ days: [r1.id, r2.id], deload: false }]);
  });

  it("refuses to sync a copy that isn't the signed-in person's", async () => {
    expect((await as(A)("GET", "/sync/pull", undefined, { since: "0", device: "d1", user: B })).status).toBe(409);
    expect((await as(A)("GET", "/sync/snapshot", undefined, { user: B })).status).toBe(409);
    const s = { ...snap.schedules[0], id: uuidv7() };
    expect((await as(A)("POST", "/sync/push", { device: "d1", user: B, changes: [upsert("schedules", s)] })).status).toBe(409);
    expect((await server.db.admin.query("SELECT 1 FROM schedules WHERE id = $1", [s.id])).rows.length).toBe(0);
  });
});

describe("a copy made before M-184", () => {
  it("is emptied and made again from the server", async () => {
    const dev = await createEngine(await pgliteDb("memory://"), { mode: "local", seed: false });
    const cat = await ok(as(A)("GET", "/sync/catalog"));
    await replica.loadCatalog(dev.db, cat.stamp, cat.rows);
    await replica.loadSnapshot(dev.db, await ok(as(A)("GET", "/sync/snapshot", undefined, { user: A })));
    // what an older app's copy looks like: no version, and a routine of someone else's pulled in under this person
    await dev.db.admin.query("UPDATE app_meta SET value = value - 'v' WHERE key = 'replica'");
    await dev.db.admin.query("SELECT set_config('motus.sync_apply', '1', false)");
    await dev.db.admin.query("INSERT INTO routines (id, user_id, name) VALUES ($1, $2, 'Foreign')", [uuidv7(), A]);
    const m = await replica.replicaMeta(dev.db);
    expect(replica.outdated(m)).toBe(true);
    expect(await replica.waitingCount(dev.db)).toBe(0);
    await replica.clearCopy(dev.db);
    expect((await replica.replicaMeta(dev.db)).ready).toBe(false);
    const again = await replica.loadSnapshot(dev.db, await ok(as(A)("GET", "/sync/snapshot", undefined, { user: A })));
    expect(replica.outdated(again)).toBe(false);
    expect(again.device).toBe(m.device);
    const names = (await dev.db.admin.query("SELECT name FROM routines")).rows.map((r: any) => r.name);
    expect(names).not.toContain("Foreign");
    expect(names.length).toBe((await server.db.admin.query("SELECT 1 FROM routines WHERE user_id = $1", [A])).rows.length);
    await dev.db.close();
  }, 60000);
});

describe("032_own_references", () => {
  it("clears or removes rows pointing at another account's rows, and never touches that account's rows", async () => {
    const db = await pgliteDb("memory://");
    await migrate(db, "031_health_deletions_stick");
    const q = (sql: string, p: unknown[] = []) => db.admin.query<any>(sql, p);
    const [a, b, ex, ra, rb, reA, reB, s, w, m, pr] = Array.from({ length: 11 }, () => uuidv7());
    await q("INSERT INTO users (id, username, display_name) VALUES ($1,'a','A'), ($2,'b','B')", [a, b]);
    await q("INSERT INTO exercises (id, owner_id, name) VALUES ($1,$2,'Row')", [ex, b]);
    await q("INSERT INTO routines (id, user_id, name) VALUES ($1,$2,'Mine'), ($3,$4,'Theirs')", [ra, a, rb, b]);
    await q("INSERT INTO routine_exercises (id, user_id, routine_id, exercise_id, position) VALUES ($1,$2,$3,$4,0), ($5,$6,$7,$4,0)", [reA, a, rb, ex, reB, b, rb]);
    await q("INSERT INTO schedules (id, user_id, routine_id, rule, days, start_date) VALUES ($1,$2,$3,'weekly','{1}','2026-11-01')", [s, a, rb]);
    await q("INSERT INTO workouts (id, user_id, name, routine_id, status, started_at) VALUES ($1,$2,'W',$3,'completed',now())", [w, a, rb]);
    await q("INSERT INTO reminders (id, user_id, target_type, target_id, body) VALUES ($1,$2,'routine',$3,'x')", [m, a, rb]);
    await q("INSERT INTO programs (id, user_id, name, weeks) VALUES ($1,$2,'P',$3)", [pr, a, JSON.stringify([{ days: [ra, rb], deload: false }])]);
    await migrate(db);
    expect((await q("SELECT routine_id FROM schedules WHERE id = $1", [s])).rows[0].routine_id).toBeNull();
    expect((await q("SELECT routine_id FROM workouts WHERE id = $1", [w])).rows[0].routine_id).toBeNull();
    expect((await q("SELECT weeks FROM programs WHERE id = $1", [pr])).rows[0].weeks).toEqual([{ days: [ra], deload: false }]);
    expect((await q("SELECT id FROM reminders")).rows).toEqual([]);
    expect((await q("SELECT id FROM routine_exercises ORDER BY id")).rows).toEqual([{ id: reB }]);
    expect((await q("SELECT count(*)::int AS n FROM routines")).rows[0].n).toBe(2);
    expect((await q("SELECT count(*)::int AS n FROM exercises WHERE id = $1", [ex])).rows[0].n).toBe(1);
    await db.close();
  }, 60000);
});
