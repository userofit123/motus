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

  it("keeps a day's band word when an older app sends the row without it (M-220)", async () => {
    await S()("POST", "/health/import", { steps: [{ date: "2026-08-03", value: 4100, worn: false }] });
    await sync();
    const worn = async (e: Engine) => (await e.db.admin.query("SELECT worn FROM daily_logs WHERE user_id = $1 AND date = '2026-08-03' AND kind = 'steps'", [U])).rows[0]?.worn;
    expect(await worn(device)).toBe(false);
    // an app from before 036 doesn't know the column: its row changes the number and leaves the word as it is
    const at = new Date().toISOString();
    const res = await S()("POST", "/sync/push", { device: deviceId, changes: [{ tbl: "daily_logs", op: "upsert", pk: { user_id: U, date: "2026-08-03", kind: "steps" }, at,
      row: { user_id: U, date: "2026-08-03", kind: "steps", value: 4200, source: "health_connect" } }] });
    expect(res).toMatchObject({ applied: 1, failed: [] });
    expect(await worn(server)).toBe(false);
    // and a new row from it is taken as a band's, as that app has always shown it
    await S()("POST", "/sync/push", { device: deviceId, changes: [{ tbl: "daily_logs", op: "upsert", pk: { user_id: U, date: "2026-08-04", kind: "steps" }, at,
      row: { user_id: U, date: "2026-08-04", kind: "steps", value: 5000, source: "health_connect" } }] });
    expect((await server.db.admin.query("SELECT worn FROM daily_logs WHERE user_id = $1 AND date = '2026-08-04' AND kind = 'steps'", [U])).rows[0].worn).toBe(true);
  }, 60000);

  it("a phone's read on its stale copy names the worn device without undoing settings changed elsewhere (M-227)", async () => {
    await sync();
    // changed on another device after this phone's last sync
    await S()("PUT", "/settings", { firstDay: 1 });
    const settingsRows = async () => Number((await server.db.admin.query("SELECT count(*) AS n FROM sync_log WHERE tbl = 'user_settings'")).rows[0].n);
    const before = await settingsRows();
    // the phone reads Health Connect on its own copy, which still has the old settings row
    await D()("POST", "/health/import", { steps: [{ date: "2026-08-10", value: 6000, device: "watch" }, { date: "2026-08-11", value: 6500, device: "watch" }],
      device: { kind: "watch" } });
    expect((await D()("GET", "/health/device")).kind).toBe("watch");
    await sync();
    expect((await S()("GET", "/me")).settings.firstDay).toBe(1);
    expect(await settingsRows()).toBe(before);
    expect((await S()("GET", "/health/device")).kind).toBe("watch");
    expect((await D()("GET", "/me")).settings.firstDay).toBe(1);
    // an app from before 038 sends the day's row without the column: the day keeps its kind
    const at = new Date().toISOString();
    await S()("POST", "/sync/push", { device: deviceId, changes: [{ tbl: "daily_logs", op: "upsert", pk: { user_id: U, date: "2026-08-10", kind: "steps" }, at,
      row: { user_id: U, date: "2026-08-10", kind: "steps", value: 6100, source: "health_connect", worn: true } }] });
    expect((await server.db.admin.query("SELECT device FROM daily_logs WHERE user_id = $1 AND date = '2026-08-10' AND kind = 'steps'", [U])).rows[0].device).toBe("watch");
    await S()("PUT", "/settings", { firstDay: 0 });
    await sync();
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
  // a server account's backup and restore are done on the server (apps/web api/replica.ts sends what's waiting first):
  // a replace there deletes and writes every row again, and the device's copy follows through the ordinary pull
  it("brings a restore done on the server to the device's copy, with what the device had sent first", async () => {
    const before = (await D()("POST", "/goals", { metric: "workouts", target: 4, period: "week" })).id;
    await sync(); // what the app does before a backup
    expect(await replica.waitingCount(device.db)).toBe(0);
    const file = await S()("GET", "/export");
    expect(file.tables.goals.some((g: any) => g.id === before)).toBe(true);
    // after the backup: a routine added on the device (sent), one renamed on the server
    const later = (await D()("POST", "/routines", { name: "After the backup", exercises: [] })).id;
    await sync();
    await S()("PUT", `/routines/${routineId}`, { name: "Renamed after the backup" });
    await S()("POST", "/import", { data: file, mode: "replace" });
    await sync();
    const rows = async (e: Engine) => {
      const t = (await on(e)("GET", "/export")).tables as Record<string, any[]>;
      return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.map((r) => JSON.stringify(r)).sort()]));
    };
    expect(await rows(device)).toEqual(await rows(server));
    expect((await D()("GET", "/routines")).some((r: any) => r.id === later)).toBe(false);
    expect((await D()("GET", `/routines/${routineId}`)).name).not.toBe("Renamed after the backup");
    expect((await D()("GET", "/goals")).some((g: any) => g.id === before)).toBe(true);
    expect(await replica.waitingCount(device.db)).toBe(0);
  }, 120000);
  // M-230: a day's number is merged per column, not newest-row-wins: web types at 10:00, the phone imported its watch's
  // count offline at 09:59 and sends later; the server keeps the typed value and takes the phone's synced one, and a
  // pull before the phone has sent keeps the phone's synced value
  it("keeps a value typed on the web and the phone's offline import of the same day, whichever way it syncs", async () => {
    const steps = async (e: Engine, date: string) => (await e.db.admin.query(
      "SELECT typed::float AS typed, synced::float AS synced, value::float AS value, device FROM daily_logs WHERE user_id = $1 AND date = $2 AND kind = 'steps'", [U, date])).rows[0];
    const phoneImports = async (date: string, n: number) => {
      await device.db.tx((q) => q.query("UPDATE daily_logs SET synced = $3, worn = true, device = 'watch' WHERE user_id = $1 AND date = $2 AND kind = 'steps'", [U, date, n]));
      // imported at 09:59, before the web's edit at 10:00
      await device.db.admin.query("UPDATE sync_log SET at = now() - interval '1 minute' WHERE tbl = 'daily_logs'");
    };
    for (const date of ["2026-07-10", "2026-07-11"]) await S()("PUT", "/daily", { date, kind: "steps", value: 5000 });
    await sync();

    // the phone sends first (sync() pushes, then pulls)
    await phoneImports("2026-07-10", 7000);
    await S()("PUT", "/daily", { date: "2026-07-10", kind: "steps", value: 6000 });
    await sync();
    expect(await steps(server, "2026-07-10")).toMatchObject({ typed: 6000, synced: 7000, value: 6000, device: "watch" });
    expect(await steps(device, "2026-07-10")).toMatchObject({ typed: 6000, synced: 7000, value: 6000, device: "watch" });

    // the phone pulls before it has sent
    await phoneImports("2026-07-11", 7100);
    await S()("PUT", "/daily", { date: "2026-07-11", kind: "steps", value: 6100 });
    const m = await replica.replicaMeta(device.db);
    const p = await S()("GET", "/sync/pull", undefined, { since: String(m.cursor), device: deviceId });
    await replica.applyRemote(device.db, U, p.changes, p.cursor);
    expect(await steps(device, "2026-07-11")).toMatchObject({ typed: 6100, synced: 7100, value: 6100, device: "watch" });
    expect(await replica.waitingCount(device.db)).toBeGreaterThan(0);
    await sync();
    expect(await steps(server, "2026-07-11")).toMatchObject({ typed: 6100, synced: 7100, value: 6100, device: "watch" });
    expect(await steps(device, "2026-07-11")).toMatchObject({ typed: 6100, synced: 7100 });
    expect(await replica.waitingCount(device.db)).toBe(0);
  }, 60000);
  // M-230: the web clears a typed-only day (the row is deleted at t1); the phone, not yet told, imports its watch's count
  // into its old copy of the day at t2. Whichever way it syncs, both end with only the watch's count, the cleared typed
  // value never coming back. A day that used the watch's count and was cleared stays cleared (its import marked deleted, 034).
  it("doesn't bring back a typed value cleared on the web through the phone's later import, whichever way it syncs", async () => {
    const day = async (e: Engine, date: string) => (await e.db.admin.query(
      "SELECT typed::float AS typed, synced::float AS synced, value::float AS value, source, chosen FROM daily_logs WHERE user_id = $1 AND date = $2 AND kind = 'steps'", [U, date])).rows[0];
    const phoneImports = (date: string, n: number) =>
      device.db.tx((q) => q.query("UPDATE daily_logs SET synced = $3, worn = true, device = 'watch' WHERE user_id = $1 AND date = $2 AND kind = 'steps'", [U, date, n]));
    for (const date of ["2026-07-12", "2026-07-13"]) await S()("PUT", "/daily", { date, kind: "steps", value: 5000 });
    await S()("PUT", "/daily", { date: "2026-07-14", kind: "steps", value: 4000, source: "health_connect" });
    await server.db.admin.query("INSERT INTO health_imports (user_id, key, kind, date) VALUES ($1, 'steps:2026-07-14', 'steps', '2026-07-14')", [U]);
    await sync();
    expect(await day(device, "2026-07-14")).toMatchObject({ synced: 4000, value: 4000 });

    // the phone sends first
    await S()("PUT", "/daily", { date: "2026-07-12", kind: "steps", value: null });
    expect(await day(server, "2026-07-12")).toBeUndefined();
    await phoneImports("2026-07-12", 7000);
    await sync();
    expect(await day(server, "2026-07-12")).toMatchObject({ typed: null, chosen: null, synced: 7000, value: 7000, source: "health_connect" });
    expect(await day(device, "2026-07-12")).toMatchObject({ typed: null, chosen: null, synced: 7000, value: 7000, source: "health_connect" });
    expect(await replica.waitingCount(device.db)).toBe(0);

    // the phone pulls before it has sent
    await S()("PUT", "/daily", { date: "2026-07-13", kind: "steps", value: null });
    await phoneImports("2026-07-13", 7100);
    const m = await replica.replicaMeta(device.db);
    const p = await S()("GET", "/sync/pull", undefined, { since: String(m.cursor), device: deviceId });
    await replica.applyRemote(device.db, U, p.changes, p.cursor);
    expect(await day(device, "2026-07-13")).toMatchObject({ typed: null, chosen: null, synced: 7100, value: 7100 });
    await sync();
    expect(await day(server, "2026-07-13")).toMatchObject({ typed: null, synced: 7100, value: 7100, source: "health_connect" });
    expect(await day(device, "2026-07-13")).toMatchObject({ typed: null, synced: 7100, value: 7100 });
    expect(await replica.waitingCount(device.db)).toBe(0);

    // a day that used the watch's count, cleared on the web: its import is marked deleted, and the phone's later
    // import of it doesn't bring it back
    await S()("PUT", "/daily", { date: "2026-07-14", kind: "steps", value: null });
    expect(await day(server, "2026-07-14")).toBeUndefined();
    await phoneImports("2026-07-14", 4500);
    await sync();
    expect(await day(server, "2026-07-14")).toBeUndefined();
    expect(await day(device, "2026-07-14")).toBeUndefined();
    expect(await replica.waitingCount(device.db)).toBe(0);
  }, 60000);
});
