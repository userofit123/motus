// The daily log keeps both of a day's values, typed and synced (039), and the day uses the one chosen (PUT /daily use).
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import { migrate } from "../src/migrate";
import { withUser } from "../src/db";
import { overrule, applyChanges } from "../src/sync/core";

let eng: Engine, U: string;
const call = async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
  const r = await eng.handle({ method, path, body, query, userId: U });
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const day = async (kind: string, date: string) => (await call("GET", "/daily", undefined, { from: "2026-10-01", tz: "0" })).find((x: any) => x.kind === kind && String(x.date).slice(0, 10) === date);
beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"));
  U = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username) VALUES ($1, 'u')", [U]);
}, 120000);

describe("band values in the daily log", () => {
  it("marks a band's day, also once a value is typed over it, and not a day only typed", async () => {
    await call("POST", "/health/import", { steps: [{ date: "2026-11-13", value: 6120 }] });
    expect(await day("steps", "2026-11-13")).toMatchObject({ value: 6120, source: "health_connect", band: true, typed: null, synced: 6120 });
    // a typed value chooses nothing, so the answer says nothing about it
    expect(await call("PUT", "/daily", { date: "2026-11-13", kind: "steps", value: 5774 })).not.toHaveProperty("restored");
    expect(await day("steps", "2026-11-13")).toMatchObject({ value: 5774, source: "manual", band: true, typed: 5774, synced: 6120, chosen: null });
    await call("PUT", "/daily", { date: "2026-11-12", kind: "water_ml", value: 1500 });
    expect(await day("water_ml", "2026-11-12")).toMatchObject({ source: "manual", band: false, typed: 1500, synced: null });
  });

  it("switches between the typed and the synced value, keeping both, and the band keeps updating its own", async () => {
    expect(await call("PUT", "/daily", { date: "2026-11-13", kind: "steps", use: "synced" })).toMatchObject({ restored: true });
    expect(await day("steps", "2026-11-13")).toMatchObject({ value: 6120, source: "health_connect", typed: 5774, synced: 6120, chosen: "synced" });
    await call("POST", "/health/import", { steps: [{ date: "2026-11-13", value: 6400 }] });
    expect(await day("steps", "2026-11-13")).toMatchObject({ value: 6400, typed: 5774, synced: 6400 });
    // the stats read the value the day uses
    const stat = (await call("GET", "/stats", undefined, { from: "2026-11-01T00:00:00Z", to: "2026-12-01T00:00:00Z", tz: "0" })).daily
      .find((x: any) => x.kind === "steps" && String(x.date).slice(0, 10) === "2026-11-13");
    expect(stat.value).toBe(6400);
    // back to the typed one, still stored
    await call("PUT", "/daily", { date: "2026-11-13", kind: "steps", use: "typed" });
    expect(await day("steps", "2026-11-13")).toMatchObject({ value: 5774, source: "manual", synced: 6400, chosen: null });
    // band: true (from before) chooses the synced one; typing again makes the typed one used
    await call("PUT", "/daily", { date: "2026-11-13", kind: "steps", band: true });
    expect((await day("steps", "2026-11-13")).value).toBe(6400);
    await call("PUT", "/daily", { date: "2026-11-13", kind: "steps", value: 6000 });
    expect(await day("steps", "2026-11-13")).toMatchObject({ value: 6000, typed: 6000, synced: 6400, chosen: null });
  });

  it("clears the value the day shows, and the other takes over", async () => {
    await call("POST", "/health/import", { sleep: [{ date: "2026-11-10", hours: 6.5 }] });
    await call("PUT", "/daily", { date: "2026-11-10", kind: "sleep_h", value: 7 });
    // the typed one goes: the synced one is back
    await call("PUT", "/daily", { date: "2026-11-10", kind: "sleep_h", value: null });
    expect(await day("sleep_h", "2026-11-10")).toMatchObject({ value: 6.5, source: "health_connect", typed: null });
    // the synced one goes: removed as from Imported data, and the typed one stays
    await call("PUT", "/daily", { date: "2026-11-10", kind: "sleep_h", value: 7 });
    await call("PUT", "/daily", { date: "2026-11-10", kind: "sleep_h", use: "synced" });
    await call("PUT", "/daily", { date: "2026-11-10", kind: "sleep_h", value: null });
    expect(await day("sleep_h", "2026-11-10")).toMatchObject({ value: 7, source: "manual", synced: null, chosen: null, band: false });
    expect((await call("POST", "/health/import", { sleep: [{ date: "2026-11-10", hours: 6.6 }] })).sleep).toBe(0);
  });

  it("a day typed over before both were kept waits for the band's next read once the synced value is chosen", async () => {
    // as 039 left a steps day typed over the band's: the band's number unknown, its import entry there
    await call("POST", "/health/import", { steps: [{ date: "2026-11-09", value: 4000 }] });
    await eng.db.admin.query("UPDATE daily_logs SET synced = NULL, typed = 4200 WHERE user_id = $1 AND date = '2026-11-09' AND kind = 'steps'", [U]);
    expect(await day("steps", "2026-11-09")).toMatchObject({ value: 4200, synced: null, band: true });
    expect(await call("PUT", "/daily", { date: "2026-11-09", kind: "steps", use: "synced" })).toMatchObject({ restored: false });
    // the typed value stays in use meanwhile
    expect(await day("steps", "2026-11-09")).toMatchObject({ value: 4200, waiting: true });
    await call("POST", "/health/import", { steps: [{ date: "2026-11-09", value: 4100 }] });
    expect(await day("steps", "2026-11-09")).toMatchObject({ value: 4100, source: "health_connect", typed: 4200, waiting: false });
  });

  it("sleep typed over the band's before 039 gets the band's hours back from its night", async () => {
    const db = await pgliteDb("memory://");
    await migrate(db, "038_daily_device");
    const u = uuidv7();
    await db.admin.query("INSERT INTO users (id, username) VALUES ($1, 'm')", [u]);
    await db.admin.query(`INSERT INTO daily_logs (user_id, date, kind, value, source) VALUES ($1, '2026-11-14', 'sleep_h', 6, 'manual'),
      ($1, '2026-11-14', 'steps', 5000, 'health_connect'), ($1, '2026-11-13', 'steps', 300, 'manual')`, [u]);
    await db.admin.query("INSERT INTO sleep_nights (user_id, date, start_at, end_at, asleep_min, awake_min) VALUES ($1, '2026-11-14', '2026-11-13T23:00:00Z', '2026-11-14T07:00:00Z', 468, 12)", [u]);
    await migrate(db);
    const rows = (await db.admin.query("SELECT kind, to_char(date, 'YYYY-MM-DD') AS d, value::float AS value, source, typed::float AS typed, synced::float AS synced FROM daily_logs ORDER BY d, kind")).rows;
    expect(rows).toEqual([
      { kind: "steps", d: "2026-11-13", value: 300, source: "manual", typed: 300, synced: null },
      { kind: "sleep_h", d: "2026-11-14", value: 6, source: "manual", typed: 6, synced: 7.8 },
      { kind: "steps", d: "2026-11-14", value: 5000, source: "health_connect", typed: null, synced: 5000 },
    ]);
    // the backfill travels nowhere: every copy runs it on its own rows
    expect((await db.admin.query("SELECT count(*)::int AS n FROM sync_log WHERE tbl = 'daily_logs'")).rows[0].n).toBe(3);
    await db.close();
  });
});

// M-230: nothing from the band is skipped, an older app's write keeps the synced value, a deletion can be taken back
describe("both values of a day", () => {
  const row = async (date: string, kind = "steps") => (await eng.db.admin.query(
    "SELECT value::float AS value, source, typed::float AS typed, synced::float AS synced, chosen FROM daily_logs WHERE user_id = $1 AND date = $2 AND kind = $3", [U, date, kind])).rows[0];
  const imports = async () => (await call("GET", "/health/imports", undefined, { tz: "0", limit: "200" })).items as any[];

  it("never skips an import on a typed day, and notes it in the import log", async () => {
    await call("PUT", "/daily", { date: "2026-08-01", kind: "steps", value: 5774 });
    expect((await call("POST", "/health/import", { steps: [{ date: "2026-08-01", value: 5804 }] })).steps).toBe(1);
    expect(await row("2026-08-01")).toEqual({ value: 5774, source: "manual", typed: 5774, synced: 5804, chosen: null });
    // listed, saying the day uses the typed one, and it can be used from there
    expect((await imports()).find((x) => x.key === "steps:2026-08-01")).toMatchObject({ value: 5804, typed: 5774 });
    await call("POST", "/health/imports/steps:2026-08-01/use");
    expect(await row("2026-08-01")).toMatchObject({ value: 5804, source: "health_connect", chosen: "synced" });
    expect((await imports()).find((x) => x.key === "steps:2026-08-01")).toMatchObject({ value: 5804, typed: null });
  });

  it("says when the day's walks count instead of the synced steps, so using them isn't offered", async () => {
    await call("PUT", "/daily", { date: "2026-08-05", kind: "steps", value: 2000 });
    await call("POST", "/health/import", { steps: [{ date: "2026-08-05", value: 3000 }] });
    expect((await imports()).find((x) => x.key === "steps:2026-08-05")).toMatchObject({ value: 3000, typed: 2000, walks: null });
    await call("POST", "/activities", { type: "walk", startedAt: "2026-08-05T09:00:00Z", durationS: 3600, steps: 5000 });
    // typed still counts (a typed day), and choosing the synced count would hand the day to the walks
    expect((await imports()).find((x) => x.key === "steps:2026-08-05")).toMatchObject({ value: 3000, typed: 2000, walks: 5000 });
  });

  it("keeps the synced value when an older app writes the day's value directly", async () => {
    await call("POST", "/health/import", { steps: [{ date: "2026-08-02", value: 8000 }] });
    const push = (value: number, source: string) => withUser(eng.db, U, (q) => applyChanges(q, U, [{
      tbl: "daily_logs", pk: { user_id: U, date: "2026-08-02", kind: "steps" }, op: "upsert", at: new Date().toISOString(),
      row: { user_id: U, date: "2026-08-02", kind: "steps", value, source, worn: true },
    }], { origin: "old-phone" }));
    // an older app typed a number: typed and used, the band's kept
    await push(7500, "manual");
    expect(await row("2026-08-02")).toEqual({ value: 7500, source: "manual", typed: 7500, synced: 8000, chosen: null });
    // an older app's import (its copy thought the band's was in use): the band's number moves on, the typed one stays used
    await push(8200, "health_connect");
    expect(await row("2026-08-02")).toEqual({ value: 7500, source: "manual", typed: 7500, synced: 8200, chosen: null });
    // a newer copy sends the whole row: written as it is
    await withUser(eng.db, U, (q) => applyChanges(q, U, [{
      tbl: "daily_logs", pk: { user_id: U, date: "2026-08-02", kind: "steps" }, op: "upsert", at: new Date().toISOString(),
      row: { user_id: U, date: "2026-08-02", kind: "steps", value: 8200, source: "health_connect", worn: true, typed: 7500, synced: 8200, chosen: "synced" },
    }], { origin: "new-phone" }));
    expect(await row("2026-08-02")).toEqual({ value: 8200, source: "health_connect", typed: 7500, synced: 8200, chosen: "synced" });
  });

  it("lists deleted imports and restores one, so the next read imports it again", async () => {
    await call("POST", "/health/import", { steps: [{ date: "2026-08-03", value: 3000 }] });
    await call("PUT", "/daily", { date: "2026-08-03", kind: "steps", value: 3300 });
    await call("DELETE", "/health/imports/steps:2026-08-03");
    // only the band's number went; the typed one stays
    expect(await row("2026-08-03")).toEqual({ value: 3300, source: "manual", typed: 3300, synced: null, chosen: null });
    expect((await call("POST", "/health/import", { steps: [{ date: "2026-08-03", value: 3100 }] })).steps).toBe(0);
    const deleted = (await call("GET", "/health/imports/deleted")).items;
    expect(deleted.find((x: any) => x.key === "steps:2026-08-03")).toMatchObject({ kind: "steps", date: "2026-08-03" });
    await call("POST", "/health/imports/steps:2026-08-03/restore");
    // listed as coming back until the read brings it
    expect((await call("GET", "/health/imports/deleted")).items.find((x: any) => x.key === "steps:2026-08-03")).toMatchObject({ restored: true, deletedAt: null });
    expect((await eng.handle({ method: "POST", path: "/health/imports/steps:2026-08-03/restore", userId: U })).status).toBe(404);
    expect((await call("POST", "/health/import", { steps: [{ date: "2026-08-03", value: 3100 }] })).steps).toBe(1);
    expect(await row("2026-08-03")).toEqual({ value: 3300, source: "manual", typed: 3300, synced: 3100, chosen: null });
    expect((await imports()).find((x) => x.key === "steps:2026-08-03")).toMatchObject({ value: 3100, typed: 3300 });
    expect((await call("GET", "/health/imports/deleted")).items.some((x: any) => x.key === "steps:2026-08-03")).toBe(false);
  });

  it("a restore wins over a copy that still has the deletion, and a later deletion wins over the restore", () => {
    const r = (deleted: string | null, restored: string | null) => ({ user_id: U, key: "steps:2026-08-04", kind: "steps", deleted_at: deleted, restored_at: restored });
    const c = (deleted: string | null, restored: string | null) => ({ tbl: "health_imports", pk: { user_id: U, key: "steps:2026-08-04" }, op: "upsert" as const, at: new Date().toISOString(), row: r(deleted, restored) });
    const D = "2026-08-04T10:00:00Z", R = "2026-08-05T10:00:00Z", D2 = "2026-08-06T10:00:00Z";
    // here restored, a copy sends the old deletion: the restore stays
    expect(overrule(c(D, null), { row: r(null, R) })).toBe(false);
    // here still deleted, the restore arrives: it wins
    expect(overrule(c(null, R), { row: r(D, null) })).toBe(true);
    // deleted again after the restore: the deletion wins, on either side
    expect(overrule(c(D2, R), { row: r(null, R) })).toBe(true);
    expect(overrule(c(null, R), { row: r(D2, R) })).toBe(false);
  });

  it("restores a deleted weight and activity: listed as coming back, and the next read brings them in again", async () => {
    const w = { weight: [{ at: "2026-08-05T07:00:00Z", kg: 81.2, id: "w-805" }] };
    const sess = { sessions: [{ id: "s-805", type: "walk", start: "2026-08-05T08:00:00Z", end: "2026-08-05T08:30:00Z", steps: 3000 }] };
    expect((await call("POST", "/health/import", { ...w, ...sess })).weight).toBe(1);
    await call("DELETE", "/health/imports/weight:w-805");
    await call("DELETE", "/health/imports/activity:s-805");
    expect((await call("POST", "/health/import", { ...w, ...sess })).weight).toBe(0);
    await call("POST", "/health/imports/weight:w-805/restore");
    await call("POST", "/health/imports/activity:s-805/restore");
    // gone from Imported data until the read, so the Deleted list keeps them, saying they come back
    const waiting = (await call("GET", "/health/imports/deleted")).items.filter((x: any) => x.key.endsWith("-805"));
    expect(waiting).toHaveLength(2);
    expect(waiting.every((x: any) => x.restored && x.deletedAt == null)).toBe(true);
    const res = await call("POST", "/health/import", { ...w, ...sess });
    expect(res).toMatchObject({ weight: 1, activities: 1 });
    const items = await imports();
    expect(items.find((x) => x.key === "weight:w-805")).toMatchObject({ value: 81.2 });
    expect(items.find((x) => x.key === "activity:s-805")?.activity).toMatchObject({ steps: 3000 });
    expect((await call("GET", "/health/imports/deleted")).items.some((x: any) => x.key.endsWith("-805"))).toBe(false);
    // and only once
    expect(await call("POST", "/health/import", { ...w, ...sess })).toMatchObject({ weight: 0, activities: 0 });
  });
});

// M-230: sync merges a day per column: the typed value and choice from where they changed last (typed_at), the synced
// value from the newest import; a day written other than as sent goes back to the sender
describe("a day's number through sync", () => {
  const pk = (date: string) => ({ user_id: U, date, kind: "steps" });
  const server = async (date: string) => (await eng.db.admin.query(
    "SELECT to_jsonb(x) AS r FROM daily_logs x WHERE user_id = $1 AND date = $2 AND kind = 'steps'", [U, date])).rows[0]?.r;
  const push = (rows: Record<string, unknown>[]) => call("POST", "/sync/push", {
    device: "phone-b", changes: rows.map((row) => ({ tbl: "daily_logs", pk: pk(String(row.date)), op: "upsert", at: new Date().toISOString(), row })) });

  it("keeps a value typed on another device when a stale copy imports, on the server and on a device", async () => {
    // both copies had T1; device A then types T2 (here, the server)
    await call("PUT", "/daily", { date: "2026-07-01", kind: "steps", value: 5000 });
    const stale = await server("2026-07-01");
    await new Promise((r) => setTimeout(r, 5));
    await call("PUT", "/daily", { date: "2026-07-01", kind: "steps", value: 6000 });
    // device B, still on T1, imports its watch's count and sends the whole row
    const res = await push([{ ...stale, synced: 7000, worn: true, device: "watch" }]);
    expect(res.applied).toBe(1);
    expect(await server("2026-07-01")).toMatchObject({ value: 6000, typed: 6000, synced: 7000, source: "manual", device: "watch" });
    // B gets the merged row back, with T2
    expect(res.rejected).toMatchObject([{ tbl: "daily_logs", op: "upsert", row: { typed: 6000, synced: 7000, value: 6000 } }]);

    // a device applying the server's rows: the same merge
    const dev = await createEngine(await pgliteDb("memory://"));
    await dev.db.admin.query("INSERT INTO users (id, username) VALUES ($1, 'u')", [U]);
    const apply = async (row: Record<string, unknown>) => dev.db.tx((q) => applyChanges(q, U, [{ tbl: "daily_logs", pk: pk("2026-07-01"), op: "upsert", at: new Date().toISOString(), row }], { apply: true }));
    const onDev = async () => (await dev.db.admin.query("SELECT to_jsonb(x) AS r FROM daily_logs x WHERE date = '2026-07-01'")).rows[0]?.r;
    await apply(stale);
    // the device's copy is stale; the server's row with T2 arrives: taken, T2 used
    await apply(await server("2026-07-01"));
    expect(await onDev()).toMatchObject({ value: 6000, typed: 6000, synced: 7000 });
    // the device chooses the synced value after that; an older server row (T2 stamp) arriving later keeps the choice
    // here, takes its synced value, and says so (kept: the device sends its row again)
    await dev.db.tx((q) => q.query("UPDATE daily_logs SET chosen = 'synced' WHERE date = '2026-07-01'"));
    const r = await apply({ ...(await server("2026-07-01")), synced: 7100 });
    expect(await onDev()).toMatchObject({ value: 7100, typed: 6000, synced: 7100, chosen: "synced", source: "health_connect" });
    expect(r.kept).toHaveLength(1);
    expect(r.applied).toBe(1);
  });

  it("sends an older app its day back when its value was filed beside a typed one", async () => {
    await call("PUT", "/daily", { date: "2026-07-02", kind: "steps", value: 5000 });
    // an app from before 039 thinks the band's count is the day's
    const res = await push([{ user_id: U, date: "2026-07-02", kind: "steps", value: 8000, source: "health_connect", worn: true }]);
    expect(res.applied).toBe(1);
    expect(await server("2026-07-02")).toMatchObject({ value: 5000, source: "manual", typed: 5000, synced: 8000 });
    expect(res.rejected).toMatchObject([{ tbl: "daily_logs", op: "upsert", row: { value: 5000, source: "manual" } }]);
    // one written as sent comes back with nothing
    const ok = await push([{ user_id: U, date: "2026-07-03", kind: "steps", value: 4000, source: "health_connect", worn: true }]);
    expect(ok).toMatchObject({ applied: 1, rejected: [] });
  });
});

// M-220: a day Health Connect had only from the phone's own counter or Google Fit (no band, watch or ring) is said so
describe("whether a band counted the day", () => {
  const stats = async () => (await call("GET", "/stats", undefined, { from: "2026-09-01T00:00:00Z", to: "2026-10-01T00:00:00Z", tz: "0" })).daily as any[];
  const dayIn = (rows: any[], kind: string, date: string) => rows.find((x) => x.kind === kind && String(x.date).slice(0, 10) === date);

  it("keeps the phone's word per day for steps, distance and active calories, and takes a missing one as a band", async () => {
    const r = await call("POST", "/health/import", {
      steps: [{ date: "2026-09-10", value: 4000, worn: false }, { date: "2026-09-11", value: 9000, worn: true }, { date: "2026-09-12", value: 7000 }],
      distance: [{ date: "2026-09-10", value: 2900, worn: false }], activeKcal: [{ date: "2026-09-10", value: 210, worn: false }],
      restingHr: [{ date: "2026-09-10", value: 58 }],
    });
    expect(r).toMatchObject({ steps: 3, distance: 1, activeKcal: 1 });
    const daily = await call("GET", "/daily", undefined, { from: "2026-09-01", tz: "0" });
    expect(dayIn(daily, "steps", "2026-09-10")).toMatchObject({ value: 4000, source: "health_connect", band: true, worn: false });
    expect(dayIn(daily, "steps", "2026-09-11")).toMatchObject({ worn: true });
    expect(dayIn(daily, "steps", "2026-09-12")).toMatchObject({ worn: true });
    expect(dayIn(daily, "resting_hr", "2026-09-10")).toMatchObject({ worn: true });
    const s = await stats();
    expect(dayIn(s, "steps", "2026-09-10")).toMatchObject({ worn: false });
    expect(dayIn(s, "distance_m", "2026-09-10")).toMatchObject({ worn: false });
    expect(dayIn(s, "active_kcal", "2026-09-10")).toMatchObject({ worn: false });
    expect((await call("GET", "/health/day/2026-09-10", undefined, { tz: "0" })).worn).toBe(false);
    expect((await call("GET", "/health/day/2026-09-11", undefined, { tz: "0" })).worn).toBe(true);
  });

  it("a later read that the band counted updates the day, with the same number too", async () => {
    expect((await call("POST", "/health/import", { steps: [{ date: "2026-09-10", value: 4000, worn: true }] })).steps).toBe(1);
    expect(dayIn(await stats(), "steps", "2026-09-10")).toMatchObject({ value: 4000, worn: true });
    // the same day and word again changes nothing
    expect((await call("POST", "/health/import", { steps: [{ date: "2026-09-10", value: 4000, worn: true }] })).steps).toBe(0);
  });

  it("a value typed over the day stays in use, and the band's later read is kept beside it with its word", async () => {
    await call("POST", "/health/import", { steps: [{ date: "2026-09-13", value: 3000, worn: false }] });
    await call("PUT", "/daily", { date: "2026-09-13", kind: "steps", value: 3500 });
    expect((await call("POST", "/health/import", { steps: [{ date: "2026-09-13", value: 3100, worn: true }] })).steps).toBe(1);
    const daily = await call("GET", "/daily", undefined, { from: "2026-09-01", tz: "0" });
    expect(dayIn(daily, "steps", "2026-09-13")).toMatchObject({ value: 3500, source: "manual", band: true, synced: 3100, worn: true });
  });
});

// 039 gained typed_at after a development copy had run it: such a copy gets it on the next start
describe("039 recorded before typed_at", () => {
  it("adds typed_at and its stamping, once", async () => {
    const db = await pgliteDb("memory://");
    await migrate(db);
    // as the copy that ran 039 without it: no column, the trigger from then (which doesn't stamp)
    await db.admin.query("ALTER TABLE daily_logs DROP COLUMN typed_at");
    expect(await migrate(db)).toEqual([]);
    const u = uuidv7();
    await db.admin.query("INSERT INTO users (id, username) VALUES ($1, 'x')", [u]);
    await db.admin.query("INSERT INTO daily_logs (user_id, date, kind, value, source) VALUES ($1, '2026-07-01', 'steps', 5000, 'manual')", [u]);
    expect((await db.admin.query("SELECT typed_at IS NOT NULL AS stamped FROM daily_logs WHERE user_id = $1", [u])).rows[0].stamped).toBe(true);
    expect(await migrate(db)).toEqual([]);
  });
});
