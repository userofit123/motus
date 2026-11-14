// Health Connect import: daily steps and sleep, weight and exercise sessions from the phone.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import { overrule } from "../src/sync/core";
import { heartRate, plausibleSteps, exerciseHr, readiness, readHrDay } from "../src/modules/health";

let eng: Engine, U: string;
/** An import that changed nothing. */
const NONE = { steps: 0, sleep: 0, sleepNights: 0, restingHr: 0, spo2: 0, hrv: 0, distance: 0, activeKcal: 0, hydration: 0, vo2max: 0, weight: 0, bodyFat: 0, activities: 0, hrDays: 0 };
const NO_NEW = { vo2max: false, hrDay: false, bodyFat: false, hydration: false };
const call = async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
  const r = await eng.handle({ method, path, body, query, userId: U });
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const send = async (status: number, method: string, path: string, body?: unknown) => {
  const r = await eng.handle({ method, path, body, userId: U });
  expect(r.status).toBe(status);
};
const log = async (q: Record<string, string> = {}) => (await call("GET", "/health/imports", undefined, { tz: "0", ...q }));
const entry = async (key: string) => (await log({ limit: "200" })).items.find((x: any) => x.key === key);
const daily = async (kind: string) => (await call("GET", "/daily", undefined, { from: "2026-10-01", tz: "0" })).filter((x: any) => x.kind === kind);
beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"));
  U = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username) VALUES ($1, 'u')", [U]);
}, 120000);

describe("health connect import", () => {
  it("fills steps and sleep, updates them on the next sync, and never replaces a typed value", async () => {
    await call("PUT", "/daily", { date: "2026-10-02", kind: "steps", value: 1200 }); // typed by hand
    const r = await call("POST", "/health/import", {
      steps: [{ date: "2026-10-01", value: 8000 }, { date: "2026-10-02", value: 9500 }],
      sleep: [{ date: "2026-10-01", hours: 7.34 }],
    });
    expect(r).toMatchObject({ steps: 1, sleep: 1 });
    const steps = await daily("steps");
    expect(steps.find((x: any) => x.date === "2026-10-01")).toMatchObject({ value: 8000, source: "health_connect" });
    expect(steps.find((x: any) => x.date === "2026-10-02")).toMatchObject({ value: 1200, source: "manual" });
    expect(Number((await daily("sleep_h"))[0].value)).toBe(7.3);

    // later in the day the count grew; an unchanged day is not counted as a change
    const again = await call("POST", "/health/import", { steps: [{ date: "2026-10-01", value: 8600 }], sleep: [{ date: "2026-10-01", hours: 7.3 }] });
    expect(again).toMatchObject({ steps: 1, sleep: 0 });
    expect((await daily("steps")).find((x: any) => x.date === "2026-10-01").value).toBe(8600);
  });

  it("adds a weight reading once", async () => {
    const w = { weight: [{ at: "2026-10-03T07:00:00Z", kg: 80.456 }] };
    expect((await call("POST", "/health/import", w)).weight).toBe(1);
    expect((await call("POST", "/health/import", w)).weight).toBe(0);
    const body = await call("GET", "/body", undefined, { kind: "weight" });
    expect(body.map((x: any) => Number(x.value))).toEqual([80.46]);
  });

  it("adds sessions as activities once, keeps edits, and files unknown types under Other", async () => {
    const s = { id: "abc", type: "run", start: "2026-10-04T06:00:00Z", end: "2026-10-04T06:30:00Z", distanceM: 5000, steps: 5200, avgHr: 150, calories: 320 };
    const odd = { id: "def", type: "kitesurf", start: "2026-10-05T10:00:00Z", end: "2026-10-05T11:00:00Z" };
    expect((await call("POST", "/health/import", { sessions: [s, odd] })).activities).toBe(2);
    const list = await call("GET", "/activities", undefined, { from: "2026-10-04" });
    const run = list.find((a: any) => a.type === "run");
    expect(run).toMatchObject({ durationS: 1800, steps: 5200, avgHr: 150, source: "health_connect" });
    expect(list.map((a: any) => a.type).sort()).toEqual(["other", "run"]);

    await call("PUT", `/activities/${run.id}`, { ...run, type: "run", name: "Morning run" });
    expect((await call("POST", "/health/import", { sessions: [s] })).activities).toBe(0);
    expect((await call("GET", `/activities/${run.id}`)).name).toBe("Morning run");
  });

  it("lists what came in, newest first, a page at a time", async () => {
    const all = await log();
    expect(all.items.map((x: any) => x.key)).toEqual([
      "activity:def", "activity:abc", "weight:2026-10-03T07:00:00.000Z", "steps:2026-10-01", "sleep:2026-10-01",
    ]);
    expect(all.cursor).toBeNull();
    const steps = all.items.find((x: any) => x.kind === "steps");
    expect(steps).toMatchObject({ date: "2026-10-01", at: null, value: 8600, activity: null, ref: null, edited: false });
    expect(all.items.find((x: any) => x.kind === "sleep").value).toBe(7.3);
    expect(all.items.find((x: any) => x.kind === "weight")).toMatchObject({ date: "2026-10-03", at: "2026-10-03T07:00:00.000Z", value: 80.46, edited: false });
    const run = all.items.find((x: any) => x.key === "activity:abc");
    expect(run).toMatchObject({ date: "2026-10-04", value: null, activity: { type: "run", name: "Morning run", durationS: 1800, distanceM: 5000, steps: 5200, avgHr: 150 } });
    expect(run.ref).toBe(run.activity.id);
    // the typed day (2026-10-02) was never an import
    expect(all.items.some((x: any) => x.key === "steps:2026-10-02")).toBe(false);

    const p1 = await log({ limit: "2" });
    expect(p1.items.map((x: any) => x.key)).toEqual(["activity:def", "activity:abc"]);
    const p2 = await log({ limit: "2", before: p1.cursor });
    const p3 = await log({ limit: "2", before: p2.cursor });
    expect([...p2.items, ...p3.items].map((x: any) => x.key)).toEqual(all.items.slice(2).map((x: any) => x.key));
    expect(p3.cursor).toBeNull();
  });

  it("keeps a day's steps edited in the log through later syncs", async () => {
    await call("PUT", "/health/imports/steps:2026-10-01", { value: 10000 });
    expect(await entry("steps:2026-10-01")).toMatchObject({ value: 10000, edited: true });
    expect((await call("POST", "/health/import", { steps: [{ date: "2026-10-01", value: 9100 }] })).steps).toBe(0);
    expect((await daily("steps")).find((x: any) => x.date === "2026-10-01")).toMatchObject({ value: 10000, source: "manual" });
    await send(400, "PUT", `/health/imports/${encodeURIComponent("activity:abc")}`, { value: 1 });
    await send(404, "PUT", "/health/imports/steps:1999-01-01", { value: 1 });
  });

  it("edits a weight reading in place", async () => {
    await call("PUT", "/health/imports/weight:2026-10-03T07:00:00.000Z", { value: 79.9 });
    expect((await entry("weight:2026-10-03T07:00:00.000Z")).value).toBe(79.9);
    expect((await call("GET", "/body", undefined, { kind: "weight" })).map((x: any) => Number(x.value))).toEqual([79.9]);
  });

  it("adds a weight reading with a record id once, and links one already logged at that minute", async () => {
    const w = { weight: [{ id: "w1", at: "2026-10-06T07:00:00Z", kg: 81 }] };
    expect((await call("POST", "/health/import", w)).weight).toBe(1);
    expect((await call("POST", "/health/import", w)).weight).toBe(0);
    // the same reading sent again by a newer app, now with its id: not a second entry or a second reading
    expect((await call("POST", "/health/import", { weight: [{ id: "w0", at: "2026-10-03T07:00:30Z", kg: 80.4 }] })).weight).toBe(0);
    expect((await log({ limit: "200" })).items.filter((x: any) => x.kind === "weight").map((x: any) => x.key)).toEqual(["weight:w1", "weight:2026-10-03T07:00:00.000Z"]);
    expect((await call("GET", "/body", undefined, { kind: "weight" })).length).toBe(2);
  });

  it("deletes each kind from the log for good", async () => {
    await call("POST", "/health/import", { steps: [{ date: "2026-10-07", value: 4000 }], sleep: [{ date: "2026-10-07", hours: 6 }], sessions: [{ id: "s7", type: "walk", start: "2026-10-07T06:00:00Z", end: "2026-10-07T06:20:00Z" }] });
    const keys = ["steps:2026-10-07", "sleep:2026-10-07", "weight:w1", "activity:s7"];
    for (const k of keys) expect(await entry(k)).toBeTruthy();
    const act = (await entry("activity:s7")).ref;
    for (const k of keys) await call("DELETE", `/health/imports/${encodeURIComponent(k)}`);
    await send(404, "DELETE", "/health/imports/weight:w1");
    expect((await daily("steps")).some((x: any) => x.date === "2026-10-07")).toBe(false);
    await send(404, "GET", `/activities/${act}`);

    const again = await call("POST", "/health/import", {
      steps: [{ date: "2026-10-07", value: 4500 }], sleep: [{ date: "2026-10-07", hours: 6.5 }],
      weight: [{ id: "w1", at: "2026-10-06T07:00:00Z", kg: 81 }], sessions: [{ id: "s7", type: "walk", start: "2026-10-07T06:00:00Z", end: "2026-10-07T06:20:00Z" }],
    });
    expect(again).toEqual(NONE);
    for (const k of keys) expect(await entry(k)).toBeUndefined();
    expect((await daily("steps")).some((x: any) => x.date === "2026-10-07")).toBe(false);
    expect((await daily("sleep_h")).some((x: any) => x.date === "2026-10-07")).toBe(false);
    expect((await call("GET", "/body", undefined, { kind: "weight" })).length).toBe(1);
  });

  it("doesn't bring back what was deleted elsewhere in the app", async () => {
    const batch = {
      steps: [{ date: "2026-10-08", value: 3000 }], weight: [{ id: "w8", at: "2026-10-08T07:00:00Z", kg: 82 }],
      sessions: [{ id: "s8", type: "run", start: "2026-10-08T06:00:00Z", end: "2026-10-08T06:20:00Z" }],
    };
    expect(await call("POST", "/health/import", batch)).toMatchObject({ steps: 1, weight: 1, activities: 1 });
    await call("PUT", "/daily", { date: "2026-10-08", kind: "steps", value: null });
    await call("DELETE", `/body/${(await entry("weight:w8")).ref}`);
    await call("DELETE", `/activities/${(await entry("activity:s8")).ref}`);
    for (const k of ["steps:2026-10-08", "weight:w8", "activity:s8"]) expect(await entry(k)).toBeUndefined();

    expect(await call("POST", "/health/import", batch)).toEqual(NONE);
    expect((await daily("steps")).some((x: any) => x.date === "2026-10-08")).toBe(false);
    expect((await call("GET", "/body", undefined, { kind: "weight" })).some((x: any) => x.measuredAt.startsWith("2026-10-08"))).toBe(false);
    expect((await call("GET", "/activities", undefined, { from: "2026-10-08" })).some((a: any) => a.startedAt.startsWith("2026-10-08"))).toBe(false);
    const gone = (await eng.db.admin.query("SELECT key FROM health_imports WHERE deleted_at IS NOT NULL ORDER BY key")).rows.map((x: any) => x.key);
    expect(gone).toEqual(expect.arrayContaining(["steps:2026-10-08", "weight:w8", "activity:s8"]));
  });

  it("keeps a deletion when a copy that hadn't heard of it syncs the same key again", () => {
    const row = (deleted: string | null) => ({ user_id: U, key: "steps:2026-10-09", kind: "steps", deleted_at: deleted });
    const c = (deleted: string | null) => ({ tbl: "health_imports", pk: { user_id: U, key: "steps:2026-10-09" }, op: "upsert" as const, at: new Date().toISOString(), row: row(deleted) });
    expect(overrule(c(null), { row: row("2026-10-09T10:00:00Z") })).toBe(false);
    expect(overrule(c("2026-10-09T10:00:00Z"), { row: row(null) })).toBe(true);
    expect(overrule(c(null), { row: row(null) })).toBeNull();
  });
});

describe("a band's side of what was recorded in Motus", () => {
  const FROM = "2026-11-01T00:00:00Z";
  const T0 = Date.parse("2026-11-02T08:00:00Z") / 1000;
  /** one reading a second for n seconds from the start, 100-159 bpm */
  const series = (start: number, n: number) => Array.from({ length: n }, (_, i) => [start + i, 100 + (i % 60)]);
  const ranges = async () => (await call("GET", "/health/ranges", undefined, { from: FROM })).ranges as any[];
  const walk = async (startedAt: string, minutes: number, extra: Record<string, unknown> = {}) => (await call("POST", "/activities", {
    type: "walk", startedAt, endedAt: new Date(Date.parse(startedAt) + minutes * 60000).toISOString(), source: "gps", ...extra,
  })).id as string;
  const act = (id: string) => call("GET", `/activities/${id}`);
  let gps: string, typed: string, cycle: string, wid: string;

  it("lists the activities and workouts the band may have more for, newest first", async () => {
    gps = await walk("2026-11-02T08:00:00Z", 30, { steps: 3000 });
    typed = await walk("2026-11-03T08:00:00Z", 30, { steps: 2500, source: "manual" }); // logged by hand with a count
    cycle = (await call("POST", "/activities", { type: "cycle", startedAt: "2026-11-04T08:00:00Z", endedAt: "2026-11-04T09:00:00Z", source: "gps" })).id;
    wid = (await call("POST", "/workouts/log", { name: "Legs", startedAt: "2026-11-05T17:00:00Z", endedAt: "2026-11-05T18:00:00Z" })).id;
    await call("POST", "/health/import", { sessions: [{ id: "hc-nov", type: "walk", start: "2026-11-06T08:00:00Z", end: "2026-11-06T08:30:00Z" }] });
    await call("POST", "/activities", { type: "walk", startedAt: "2026-10-20T08:00:00Z", durationS: 600, source: "gps" }); // before from
    const r = await ranges();
    expect(r.map((x) => [x.kind, x.id])).toEqual([["workout", wid], ["activity", cycle], ["activity", typed], ["activity", gps]]);
    expect(r[0]).toMatchObject({ start: "2026-11-05T17:00:00.000Z", end: "2026-11-05T18:00:00.000Z" });
  });

  it("takes the band's steps only when its data covers the whole activity", async () => {
    expect(await call("POST", "/health/ranges", { results: [{ kind: "activity", id: gps, steps: 3400, covered: false }] })).toEqual({ steps: 0, hr: 0 });
    expect(await act(gps)).toMatchObject({ steps: 3000, stepsSource: null, stepsApp: null });
    expect(await call("POST", "/health/ranges", { results: [{ kind: "activity", id: gps, steps: 3400, covered: true }] })).toEqual({ steps: 1, hr: 0 });
    expect(await act(gps)).toMatchObject({ steps: 3400, stepsSource: "band", stepsApp: 3000 });
    // the band's count again, now a little higher: the app's own stays kept aside
    expect((await call("POST", "/health/ranges", { results: [{ kind: "activity", id: gps, steps: 3400, covered: true }] })).steps).toBe(0);
    expect((await call("POST", "/health/ranges", { results: [{ kind: "activity", id: gps, steps: 3450, covered: true }] })).steps).toBe(1);
    expect(await act(gps)).toMatchObject({ steps: 3450, stepsSource: "band", stepsApp: 3000 });
    const listed = (await call("GET", "/activities", undefined, { from: FROM })).find((a: any) => a.id === gps);
    expect(listed).toMatchObject({ stepsSource: "band" });
    expect(listed.hr).toBeUndefined();
  });

  it("never replaces a count typed in, and not a type that doesn't count steps", async () => {
    expect((await call("POST", "/health/ranges", { results: [{ kind: "activity", id: typed, steps: 4000, covered: true }] })).steps).toBe(0);
    expect(await act(typed)).toMatchObject({ steps: 2500, stepsSource: null });
    expect((await call("POST", "/health/ranges", { results: [{ kind: "activity", id: cycle, steps: 900, covered: true }] })).steps).toBe(0);

    // changed by hand after the band's: the person's from then on
    const a = await act(gps);
    await call("PUT", `/activities/${gps}`, { ...a, steps: 3300 });
    expect(await act(gps)).toMatchObject({ steps: 3300, stepsSource: "manual", stepsApp: 3000 });
    expect((await call("POST", "/health/ranges", { results: [{ kind: "activity", id: gps, steps: 3500, covered: true }] })).steps).toBe(0);
    expect((await act(gps)).steps).toBe(3300);
    // saved again with the count untouched: stays as it was
    const other = await walk("2026-11-07T08:00:00Z", 20, { steps: 2000 });
    await call("POST", "/health/ranges", { results: [{ kind: "activity", id: other, steps: 2100, covered: true }] });
    await call("PUT", `/activities/${other}`, { ...(await act(other)), name: "Errands" });
    expect(await act(other)).toMatchObject({ steps: 2100, stepsSource: "band", name: "Errands" });
  });

  it("keeps the app's count when the band's is far from it (a band clock that is off)", async () => {
    expect(plausibleSteps(1000, null)).toBe(true);
    expect(plausibleSteps(5000, 150)).toBe(true);
    expect(plausibleSteps(800, 2000)).toBe(true);
    expect(plausibleSteps(700, 2000)).toBe(false);
    expect(plausibleSteps(5100, 2000)).toBe(false);
    const w = await walk("2026-11-08T08:00:00Z", 30, { steps: 3000 });
    expect((await call("POST", "/health/ranges", { results: [{ kind: "activity", id: w, steps: 400, covered: true }] })).steps).toBe(0);
    expect((await call("POST", "/health/ranges", { results: [{ kind: "activity", id: w, steps: 9000, covered: true }] })).steps).toBe(0);
    expect(await act(w)).toMatchObject({ steps: 3000, stepsSource: null });
    // no count of the app's own: the band's is taken as it is
    const none = await walk("2026-11-08T10:00:00Z", 30);
    expect((await call("POST", "/health/ranges", { results: [{ kind: "activity", id: none, steps: 400, covered: true }] })).steps).toBe(1);
    expect(await act(none)).toMatchObject({ steps: 400, stepsSource: "band", stepsApp: null });
  });

  it("adds heart rate to an activity, thinned to 600 points, without replacing a typed average", async () => {
    const h = heartRate(series(T0, 1800), T0, T0 + 1800)!;
    expect(h.hr.length).toBe(600);
    expect(h.max).toBe(159);
    expect(h.avg).toBe(130);
    expect(heartRate([[T0, 20], [T0 + 1, 300], [T0 + 2, 90]], T0, T0 + 10)).toBeNull(); // glitches out, one reading left
    expect(heartRate(series(T0 - 4000, 10), T0, T0 + 1800)).toBeNull(); // another time

    const r = await call("POST", "/health/ranges", { results: [{ kind: "activity", id: gps, hr: series(T0, 1800) }] });
    expect(r).toEqual({ steps: 0, hr: 1 });
    const a = await act(gps);
    expect(a).toMatchObject({ avgHr: 130, maxHr: 159 });
    expect(a.hr.length).toBe(600);
    expect(a.hr[0][0]).toBeGreaterThanOrEqual(T0);

    const typedHr = await walk("2026-11-09T08:00:00Z", 10, { avgHr: 111 });
    const t = Date.parse("2026-11-09T08:00:00Z") / 1000;
    await call("POST", "/health/ranges", { results: [{ kind: "activity", id: typedHr, hr: [[t, 140], [t + 60, 150]] }] });
    expect(await act(typedHr)).toMatchObject({ avgHr: 111, maxHr: 150, hr: [[t, 140], [t + 60, 150]] });
    expect((await ranges()).some((x) => x.id === gps)).toBe(false); // band steps and heart rate in: nothing more to ask
  });

  it("adds heart rate to a workout", async () => {
    const t = Date.parse("2026-11-05T17:00:00Z") / 1000;
    expect(await call("POST", "/health/ranges", { results: [{ kind: "workout", id: wid, hr: [[t + 10, 90], [t + 600, 150], [t + 1200, 120]] }] })).toEqual({ steps: 0, hr: 1 });
    const w = await call("GET", `/workouts/${wid}`);
    expect(w).toMatchObject({ avgHr: 120, maxHr: 150, hr: [[t + 10, 90], [t + 600, 150], [t + 1200, 120]] });
    const listed = (await call("GET", "/workouts", undefined, { from: FROM })).find((x: any) => x.id === wid);
    expect(listed).toMatchObject({ avgHr: 120, maxHr: 150 });
    expect(listed.hr).toBeUndefined();
    expect((await ranges()).some((x) => x.id === wid)).toBe(false);
    await send(400, "POST", "/health/ranges", { results: [{ kind: "workout", id: "nope" }] });
    await send(400, "POST", "/health/ranges", { results: [{ kind: "set", id: wid }] });
  });

  it("keeps heart rate and the steps' source when a device on an older app syncs the row without them", async () => {
    const { user_id: _u, steps_source: _s, steps_app: _a, max_hr: _m, hr: _h, ...old } = (await eng.db.admin.query("SELECT to_jsonb(a) AS r FROM activities a WHERE id = $1", [gps])).rows[0].r;
    const r = await eng.handle({ method: "POST", path: "/sync/push", userId: U, body: {
      device: "old-phone", changes: [{ tbl: "activities", pk: { id: gps }, op: "upsert", at: new Date(Date.now() + 60000).toISOString(), row: { ...old, name: "Renamed on the old phone" } }],
    } });
    expect(r.status).toBe(200);
    expect((r.body as any).applied).toBe(1);
    const a = await act(gps);
    expect(a).toMatchObject({ name: "Renamed on the old phone", stepsSource: "manual", stepsApp: 3000, maxHr: 159 });
    expect(a.hr.length).toBe(600);
  });
});

describe("daily resting heart rate, SpO2 and HRV from a band", () => {
  it("imports, lists, keeps typed values, edits and deletes for good", async () => {
    await call("PUT", "/daily", { date: "2026-11-11", kind: "resting_hr", value: 50 }); // typed by hand
    const batch = {
      restingHr: [{ date: "2026-11-10", value: 58 }, { date: "2026-11-11", value: 61 }, { date: "2026-11-12", value: 300 }],
      spo2: [{ date: "2026-11-10", value: 96.44 }], hrv: [{ date: "2026-11-10", value: 42.6 }],
    };
    expect(await call("POST", "/health/import", batch)).toMatchObject({ restingHr: 1, spo2: 1, hrv: 1 });
    const d = await call("GET", "/daily", undefined, { from: "2026-11-01", tz: "0" });
    // a day comes back as text or as a date, depending on the database
    const day = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
    const at = (kind: string, date: string) => d.find((x: any) => x.kind === kind && day(x.date) === date);
    expect(Number(at("resting_hr", "2026-11-10").value)).toBe(58);
    expect(Number(at("resting_hr", "2026-11-11").value)).toBe(50);
    expect(Number(at("spo2", "2026-11-10").value)).toBe(96.4);
    expect(Number(at("hrv", "2026-11-10").value)).toBe(43);
    expect(await call("POST", "/health/import", batch)).toMatchObject({ restingHr: 0, spo2: 0, hrv: 0 });

    expect(await entry("resting_hr:2026-11-10")).toMatchObject({ kind: "resting_hr", date: "2026-11-10", value: 58, edited: false });
    expect(await entry("spo2:2026-11-10")).toMatchObject({ kind: "spo2", value: 96.4 });
    expect(await entry("hrv:2026-11-10")).toMatchObject({ kind: "hrv", value: 43 });
    expect(await entry("resting_hr:2026-11-11")).toBeUndefined();

    await call("PUT", "/health/imports/resting_hr:2026-11-10", { value: 57 });
    expect(await entry("resting_hr:2026-11-10")).toMatchObject({ value: 57, edited: true });
    await send(400, "PUT", "/health/imports/spo2:2026-11-10", { value: 20 });
    expect((await call("POST", "/health/import", { restingHr: [{ date: "2026-11-10", value: 59 }] })).restingHr).toBe(0);
    expect((await entry("resting_hr:2026-11-10")).value).toBe(57);

    await call("DELETE", "/health/imports/hrv:2026-11-10");
    expect((await call("POST", "/health/import", { hrv: [{ date: "2026-11-10", value: 45 }] })).hrv).toBe(0);
    expect(await entry("hrv:2026-11-10")).toBeUndefined();
    expect((await call("GET", "/daily", undefined, { from: "2026-11-01", tz: "0" })).some((x: any) => x.kind === "hrv")).toBe(false);
  });
});

describe("nights of sleep, daily distance and active calories from a band", () => {
  const T = (iso: string) => Date.parse(iso) / 1000;
  /** a reading every 30 s through the night, 50-69 bpm */
  const nightHr = (start: string, n: number) => Array.from({ length: n }, (_, i) => [T(start) + i * 30, 50 + (i % 20)]);
  const n20 = {
    date: "2026-11-20", start: "2026-11-19T23:00:00Z", end: "2026-11-20T07:00:00Z", asleepMin: 450, awakeMin: 30,
    lightMin: 250, deepMin: 90, remMin: 110, hr: nightHr("2026-11-19T23:00:00Z", 900), avgSpo2: 95.66, minSpo2: 89, respRate: 14.2,
  };
  const nights = async (q: Record<string, string>) => (await call("GET", "/health/sleep", undefined, q)).nights as any[];

  it("adds a night with its day's sleep, updates it only when it changed, and lists nights newest first", async () => {
    const r = await call("POST", "/health/import", { sleep: [{ date: "2026-11-20", hours: 7.5 }], sleepNights: [n20] });
    expect(r).toMatchObject({ sleep: 1, sleepNights: 1 });
    expect((await call("POST", "/health/import", { sleep: [{ date: "2026-11-20", hours: 7.5 }], sleepNights: [n20] })).sleepNights).toBe(0);
    expect((await call("POST", "/health/import", { sleepNights: [{ ...n20, deepMin: 95 }] })).sleepNights).toBe(1);

    // the day's sleep typed by hand: the night's detail still comes in, the typed hours stay
    await call("PUT", "/daily", { date: "2026-11-21", kind: "sleep_h", value: 8 });
    // no hours sent alongside: the night's asleep time becomes the day's sleep
    const r2 = await call("POST", "/health/import", { sleepNights: [
      { date: "2026-11-21", start: "2026-11-20T23:30:00Z", end: "2026-11-21T06:30:00Z", asleepMin: 400, awakeMin: 20, avgSpo2: 30, respRate: 99 },
      { date: "2026-11-22", start: "2026-11-21T23:00:00Z", end: "2026-11-22T06:45:00Z", asleepMin: 445, awakeMin: 20, avgHr: 58, minHr: 49 },
      { date: "2026-11-23", start: "2026-11-23T07:00:00Z", end: "2026-11-22T23:00:00Z", asleepMin: 400, awakeMin: 0 }, // backwards: skipped
      { date: "2026-11-24", start: "2026-11-23T23:00:00Z", end: "2026-11-24T07:00:00Z" }, // no asleep time: skipped
    ] });
    expect(r2).toMatchObject({ sleepNights: 2 });
    const d = await daily("sleep_h");
    expect(d.find((x: any) => String(x.date).includes("2026-11-21") || (x.date instanceof Date && x.date.toISOString().startsWith("2026-11-21")))).toBeTruthy();
    expect(await entry("sleep:2026-11-21")).toMatchObject({ kind: "sleep", value: 8, edited: true });
    expect(await entry("sleep:2026-11-22")).toMatchObject({ kind: "sleep", value: 7.4, edited: false });

    const all = await nights({ from: "2026-11-01" });
    expect(all.map((x) => x.date)).toEqual(["2026-11-22", "2026-11-21", "2026-11-20"]);
    expect(all[2]).toMatchObject({
      startAt: "2026-11-19T23:00:00.000Z", endAt: "2026-11-20T07:00:00.000Z", asleepMin: 450, awakeMin: 30, lightMin: 250, deepMin: 95, remMin: 110,
      avgHr: 60, minHr: 50, avgSpo2: 95.7, minSpo2: 89, respRate: 14.2, edited: false, sleepH: 7.5,
    });
    expect(all[2].hr).toBeUndefined();
    // out of range values are dropped, not the night; no stages: null
    expect(all[1]).toMatchObject({ lightMin: null, deepMin: null, remMin: null, avgHr: null, avgSpo2: null, respRate: null, edited: true, sleepH: 8 });
    expect(all[0]).toMatchObject({ avgHr: 58, minHr: 49 });
    expect((await nights({ from: "2026-11-20", to: "2026-11-22" })).map((x) => x.date)).toEqual(["2026-11-21", "2026-11-20"]);

    const one = await call("GET", "/health/sleep/2026-11-20");
    expect(one).toMatchObject({ date: "2026-11-20", asleepMin: 450 });
    expect(one.hr.length).toBe(300);
    await send(404, "GET", "/health/sleep/2026-11-24");
  });

  it("fills in a night for a day synced before nights were, once, on a read of the past", async () => {
    // someone else, so this test's nights stay out of the other tests' lists and backups
    const W = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username) VALUES ($1, 'backfill')", [W]);
    const as = async (method: string, path: string, body?: unknown, query?: Record<string, string>) => (await eng.handle({ method, path, body, query, userId: W })).body as any;
    // an app from before nights handed over the day's hours only; a later read of the same days sends hours and night
    expect(await as("POST", "/health/import", { sleep: [{ date: "2026-10-05", hours: 7.5 }, { date: "2026-10-06", hours: 6 }] })).toMatchObject({ sleep: 2 });
    await as("PUT", "/daily", { date: "2026-10-06", kind: "sleep_h", value: 6.5 });
    const again = { sleep: [{ date: "2026-10-05", hours: 7.5 }, { date: "2026-10-06", hours: 6 }], sleepNights: [
      { date: "2026-10-05", start: "2026-10-04T23:00:00Z", end: "2026-10-05T07:00:00Z", asleepMin: 450, awakeMin: 30 },
      { date: "2026-10-06", start: "2026-10-05T23:30:00Z", end: "2026-10-06T06:00:00Z", asleepMin: 360, awakeMin: 30 },
    ] };
    expect(await as("POST", "/health/import", again)).toMatchObject({ sleep: 0, sleepNights: 2 });
    expect(await as("POST", "/health/import", again)).toMatchObject({ sleep: 0, sleepNights: 0 });
    // one entry per day in the log, the typed hours kept
    const items = (await as("GET", "/health/imports", undefined, { tz: "0", limit: "200" })).items.filter((x: any) => x.kind === "sleep");
    expect(items.map((x: any) => x.date).sort()).toEqual(["2026-10-05", "2026-10-06"]);
    expect(items.find((x: any) => x.date === "2026-10-06")).toMatchObject({ value: 6.5, edited: true });
    expect((await as("GET", "/health/sleep", undefined, { from: "2026-10-01" })).nights.map((x: any) => x.date)).toEqual(["2026-10-06", "2026-10-05"]);
  });

  it("deletes a night with its day's sleep for good, from the log or elsewhere", async () => {
    await call("DELETE", "/health/imports/sleep:2026-11-20");
    await send(404, "GET", "/health/sleep/2026-11-20");
    expect(await call("POST", "/health/import", { sleep: [{ date: "2026-11-20", hours: 7.5 }], sleepNights: [n20] })).toMatchObject({ sleep: 0, sleepNights: 0 });
    // a copy that hadn't heard of the deletion synced the night back: the next import clears it
    await eng.db.admin.query("INSERT INTO sleep_nights (user_id, date, start_at, end_at, asleep_min, awake_min) VALUES ($1, '2026-11-20', $2, $3, 450, 30)", [U, n20.start, n20.end]);
    await call("POST", "/health/import", {});
    expect((await eng.db.admin.query("SELECT 1 FROM sleep_nights WHERE user_id = $1 AND date = '2026-11-20'", [U])).rows.length).toBe(0);

    // the day's sleep cleared in the daily log: the night is no longer shown, and the next sync notes the deletion
    await call("PUT", "/daily", { date: "2026-11-22", kind: "sleep_h", value: null });
    expect((await nights({ from: "2026-11-01" })).map((x) => x.date)).toEqual(["2026-11-21"]);
    const again = await call("POST", "/health/import", { sleepNights: [{ date: "2026-11-22", start: "2026-11-21T23:00:00Z", end: "2026-11-22T06:45:00Z", asleepMin: 445, awakeMin: 20 }] });
    expect(again).toMatchObject({ sleep: 0, sleepNights: 0 });
    expect(await entry("sleep:2026-11-22")).toBeUndefined();
    expect((await eng.db.admin.query("SELECT 1 FROM sleep_nights WHERE user_id = $1 AND date = '2026-11-22'", [U])).rows.length).toBe(0);
  });

  it("imports daily distance and active calories like steps: typed days stay, edits and deletions stick", async () => {
    await call("PUT", "/daily", { date: "2026-11-21", kind: "distance_m", value: 3000 }); // typed by hand
    const batch = {
      distance: [{ date: "2026-11-20", value: 6123.4 }, { date: "2026-11-21", value: 7000 }, { date: "2026-11-22", value: 600000 }],
      activeKcal: [{ date: "2026-11-20", value: 412.6 }, { date: "2026-11-22", value: 30000 }],
    };
    expect(await call("POST", "/health/import", batch)).toMatchObject({ distance: 1, activeKcal: 1 });
    expect(await call("POST", "/health/import", batch)).toMatchObject({ distance: 0, activeKcal: 0 });
    const d = await call("GET", "/daily", undefined, { from: "2026-11-01", tz: "0" });
    const day = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
    const at = (kind: string, date: string) => d.find((x: any) => x.kind === kind && day(x.date) === date);
    expect(Number(at("distance_m", "2026-11-20").value)).toBe(6123);
    expect(Number(at("distance_m", "2026-11-21").value)).toBe(3000);
    expect(Number(at("active_kcal", "2026-11-20").value)).toBe(413);
    expect(at("distance_m", "2026-11-22")).toBeUndefined();

    expect(await entry("distance:2026-11-20")).toMatchObject({ kind: "distance", date: "2026-11-20", value: 6123, edited: false });
    expect(await entry("active_kcal:2026-11-20")).toMatchObject({ kind: "active_kcal", value: 413 });
    expect(await entry("distance:2026-11-21")).toBeUndefined();

    await call("PUT", "/health/imports/distance:2026-11-20", { value: 6500 });
    expect(await entry("distance:2026-11-20")).toMatchObject({ value: 6500, edited: true });
    await send(400, "PUT", "/health/imports/active_kcal:2026-11-20", { value: 25000 });
    expect((await call("POST", "/health/import", { distance: [{ date: "2026-11-20", value: 7000 }] })).distance).toBe(0);
    expect((await entry("distance:2026-11-20")).value).toBe(6500);

    await call("DELETE", "/health/imports/active_kcal:2026-11-20");
    expect((await call("POST", "/health/import", { activeKcal: [{ date: "2026-11-20", value: 450 }] })).activeKcal).toBe(0);
    expect(await entry("active_kcal:2026-11-20")).toBeUndefined();
  });

  it("goes into backups", async () => {
    const x = await call("GET", "/export");
    expect(x.tables.sleep_nights.map((n: any) => n.date instanceof Date ? n.date.toISOString().slice(0, 10) : String(n.date).slice(0, 10))).toEqual(["2026-11-21"]);
    expect(x.tables.sleep_nights[0].user_id).toBeUndefined();
  });

  it("says which kinds of band data there are", async () => {
    expect(await call("GET", "/health/available")).toEqual({ sleep: true, heart: true, distance: true, calories: false, ...NO_NEW });
    const V = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username) VALUES ($1, 'v')", [V]);
    const as = async (method: string, path: string, body?: unknown) => (await eng.handle({ method, path, body, userId: V })).body as any;
    expect(await as("GET", "/health/available")).toEqual({ sleep: false, heart: false, distance: false, calories: false, ...NO_NEW });
    // typed by hand, not from a band
    await as("PUT", "/daily", { date: "2026-11-20", kind: "sleep_h", value: 8 });
    expect((await as("GET", "/health/available")).sleep).toBe(false);
    await as("POST", "/health/import", { activeKcal: [{ date: "2026-11-20", value: 300 }], sleepNights: [n20] });
    expect(await as("GET", "/health/available")).toEqual({ sleep: true, heart: false, distance: false, calories: true, ...NO_NEW });
    // the other person's nights are not this one's
    expect((await as("GET", "/health/sleep")).nights.map((n: any) => n.date)).toEqual(["2026-11-20"]);
  });
});

describe("body fat, water, VO2 max and a day's heart rate from Health Connect", () => {
  const body = async (kind: string) => (await call("GET", "/body", undefined, { kind })) as any[];
  const dayOf = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
  const dailyAt = async (kind: string, date: string) => (await call("GET", "/daily", undefined, { from: "2026-12-01", tz: "0" })).find((x: any) => x.kind === kind && dayOf(x.date) === date);

  it("adds a body fat reading once, links one typed at that minute, edits and deletes it for good", async () => {
    const batch = { bodyFat: [{ id: "bf1", at: "2026-12-01T07:00:00Z", pct: 18.46 }, { id: "bf2", at: "2026-12-02T07:00:00Z", pct: 90 }] };
    expect(await call("POST", "/health/import", batch)).toMatchObject({ bodyFat: 1 });
    expect(await call("POST", "/health/import", batch)).toEqual(NONE);
    expect((await body("body_fat")).map((x) => Number(x.value))).toEqual([18.5]);
    expect(await entry("body_fat:bf1")).toMatchObject({ kind: "body_fat", date: "2026-12-01", at: "2026-12-01T07:00:00.000Z", value: 18.5, edited: false });
    // typed at the same minute as a reading sent without an id: one reading, now in the log
    await call("POST", "/body", { kind: "body_fat", value: 19, measuredAt: "2026-12-03T07:00:00Z" });
    expect((await call("POST", "/health/import", { bodyFat: [{ at: "2026-12-03T07:00:20Z", pct: 19.2 }] })).bodyFat).toBe(0);
    expect(await entry("body_fat:2026-12-03T07:00:20.000Z")).toMatchObject({ value: 19 });
    expect((await body("body_fat")).length).toBe(2);
    // a weight at the same minute is another kind of reading
    expect((await call("POST", "/health/import", { weight: [{ id: "w-dec", at: "2026-12-01T07:00:00Z", kg: 80 }] })).weight).toBe(1);

    await call("PUT", "/health/imports/body_fat:bf1", { value: 17.04 });
    expect((await entry("body_fat:bf1")).value).toBe(17);
    await send(400, "PUT", "/health/imports/body_fat:bf1", { value: 80 });
    await call("DELETE", "/health/imports/body_fat:bf1");
    expect(await call("POST", "/health/import", batch)).toEqual(NONE);
    expect(await entry("body_fat:bf1")).toBeUndefined();
    expect((await body("body_fat")).map((x) => Number(x.value))).toEqual([19]);
  });

  it("imports water and VO2 max like steps: typed days stay, edits and deletions stick", async () => {
    await call("PUT", "/daily", { date: "2026-12-02", kind: "water_ml", value: 500 }); // typed by hand
    const batch = {
      hydration: [{ date: "2026-12-01", ml: 1500.4 }, { date: "2026-12-02", ml: 2000 }, { date: "2026-12-03", ml: 30000 }],
      vo2max: [{ date: "2026-12-01", value: 45.26 }, { date: "2026-12-02", value: 5 }],
    };
    expect(await call("POST", "/health/import", batch)).toMatchObject({ hydration: 1, vo2max: 1 });
    expect(await call("POST", "/health/import", batch)).toEqual(NONE);
    expect(await dailyAt("water_ml", "2026-12-01")).toMatchObject({ source: "health_connect" });
    expect(Number((await dailyAt("water_ml", "2026-12-01")).value)).toBe(1500);
    expect(Number((await dailyAt("water_ml", "2026-12-02")).value)).toBe(500);
    expect(await dailyAt("water_ml", "2026-12-03")).toBeUndefined();
    expect(Number((await dailyAt("vo2max", "2026-12-01")).value)).toBe(45.3);
    expect(await entry("water:2026-12-01")).toMatchObject({ kind: "water", value: 1500, edited: false });
    expect(await entry("vo2max:2026-12-01")).toMatchObject({ kind: "vo2max", value: 45.3 });
    expect(await entry("water:2026-12-02")).toBeUndefined();

    await call("PUT", "/health/imports/vo2max:2026-12-01", { value: 46 });
    expect(await entry("vo2max:2026-12-01")).toMatchObject({ value: 46, edited: true });
    expect((await call("POST", "/health/import", { vo2max: [{ date: "2026-12-01", value: 47 }] })).vo2max).toBe(0);
    await call("DELETE", "/health/imports/water:2026-12-01");
    expect((await call("POST", "/health/import", { hydration: [{ date: "2026-12-01", ml: 1800 }] })).hydration).toBe(0);
    expect(await dailyAt("water_ml", "2026-12-01")).toBeUndefined();
  });

  it("keeps a day's heart rate, written again when it changed, outside the import log", async () => {
    const t = Date.parse("2026-12-01T00:00:00Z") / 1000;
    const hr = Array.from({ length: 1440 }, (_, i) => [t + i * 60, 60 + (i % 40)]);
    expect(readHrDay({ date: "2026-12-01" })).toBeNull();
    expect(readHrDay({ date: "nope", min: 50 })).toBeNull();
    expect(readHrDay({ date: "2026-12-01", hr })).toMatchObject({ min: 60, max: 99, avg: 80 });
    const r = await call("POST", "/health/import", { hrDays: [{ date: "2026-12-01", min: 48, max: 162, avg: 71.4, hr }, { date: "2026-12-02" }] });
    expect(r).toMatchObject({ hrDays: 1 });
    expect((await call("POST", "/health/import", { hrDays: [{ date: "2026-12-01", min: 48, max: 162, avg: 71.4, hr }] })).hrDays).toBe(0);
    expect((await call("POST", "/health/import", { hrDays: [{ date: "2026-12-01", min: 47, max: 162, avg: 71, hr }] })).hrDays).toBe(1);
    expect((await log({ limit: "200" })).items.some((x: any) => x.key.includes("2026-12-01") && x.kind === "hr")).toBe(false);
    const row = (await eng.db.admin.query("SELECT min_hr, max_hr, avg_hr, hr FROM hr_days WHERE user_id = $1", [U])).rows[0];
    expect(row).toMatchObject({ min_hr: 47, max_hr: 162, avg_hr: 71 });
    expect(row.hr.length).toBe(288);
    const x = await call("GET", "/export");
    expect(x.tables.hr_days.length).toBe(1);
    expect(x.tables.hr_days[0].user_id).toBeUndefined();
  });

  it("gives everything for one day, nulls where there is nothing", async () => {
    await call("POST", "/health/import", {
      steps: [{ date: "2026-12-01", value: 9000 }], restingHr: [{ date: "2026-12-01", value: 55 }], hrv: [{ date: "2026-12-01", value: 48 }],
      spo2: [{ date: "2026-12-01", value: 97 }], distance: [{ date: "2026-12-01", value: 6500 }], activeKcal: [{ date: "2026-12-01", value: 420 }],
      sleepNights: [{ date: "2026-12-01", start: "2026-11-30T23:00:00Z", end: "2026-12-01T06:30:00Z", asleepMin: 420, awakeMin: 30, deepMin: 80 }],
    });
    const d = await call("GET", "/health/day/2026-12-01", undefined, { tz: "0" });
    expect(d).toMatchObject({
      date: "2026-12-01", restingHr: 55, hrv: 48, spo2: 97, vo2max: 46, steps: 9000, distanceM: 6500, activeKcal: 420, waterMl: null,
      sleep: { date: "2026-12-01", asleepMin: 420, deepMin: 80, sleepH: 7 }, sleepH: 7, hr: { min: 47, max: 162, avg: 71 },
    });
    expect(d.hr.series.length).toBe(288);
    expect(d.sleep.hr).toBeUndefined();
    expect(await call("GET", "/health/day/2026-12-09", undefined, { tz: "0" })).toEqual({
      date: "2026-12-09", sleep: null, sleepH: null, hr: null, restingHr: null, hrv: null, spo2: null, vo2max: null, steps: null, distanceM: null, activeKcal: null, waterMl: null,
    });
    // a day with only its sleep hours (synced before nights came in, or typed) still has its sleep
    await call("POST", "/health/import", { sleep: [{ date: "2026-12-08", hours: 6.5 }] });
    expect(await call("GET", "/health/day/2026-12-08", undefined, { tz: "0" })).toMatchObject({ sleep: null, sleepH: 6.5 });
    await send(400, "GET", "/health/day/nope");
  });

  it("says which of these there are", async () => {
    expect(await call("GET", "/health/available")).toMatchObject({ vo2max: true, hrDay: true, bodyFat: true, hydration: false });
    // water typed by hand is not from Health Connect; the import's water was deleted above
    await call("POST", "/health/import", { hydration: [{ date: "2026-12-04", ml: 1200 }] });
    expect((await call("GET", "/health/available")).hydration).toBe(true);
  });
});

describe("readiness", () => {
  const P = (key: "sleep" | "restingHr" | "hrv", value: number, base: number, n = 10) => ({ key, value, history: Array.from({ length: n }, () => base) });

  it("starts at 70 and moves with sleep, resting heart rate and HRV against the person's usual", () => {
    expect(readiness([P("sleep", 7, 7), P("restingHr", 55, 55), P("hrv", 50, 50)])).toMatchObject({ score: 70, label: "Normal" });
    // an hour more sleep, a lower resting rate, a higher HRV: each at its most
    const good = readiness([P("sleep", 8, 7), P("restingHr", 50, 55), P("hrv", 60, 50)]);
    expect(good).toMatchObject({ score: 100, label: "Ready" });
    expect(good.parts).toEqual([
      { key: "sleep", value: 8, baseline: 7, change: 60, effect: "up" },
      { key: "restingHr", value: 50, baseline: 55, change: -9.1, effect: "up" },
      { key: "hrv", value: 60, baseline: 50, change: 20, effect: "up" },
    ]);
    // two hours short and a resting rate 10 % up
    const bad = readiness([P("sleep", 5, 7), P("restingHr", 60.5, 55), P("hrv", 50, 50)]);
    expect(bad).toMatchObject({ score: 30, label: "Take it easy" });
    expect(bad.parts.map((p) => p.effect)).toEqual(["down", "down", "flat"]);
    // the median, so one odd night doesn't move the usual
    expect(readiness([{ key: "sleep", value: 7, history: [7, 7, 7, 7, 7, 7, 2] }, P("hrv", 50, 50)]).parts[0]!.baseline).toBe(7);
  });

  it("needs a week of history per part and two parts for a score", () => {
    expect(readiness([P("sleep", 8, 7, 6), P("hrv", 60, 50)])).toMatchObject({ score: null, label: null });
    expect(readiness([P("sleep", 8, 7, 6), P("hrv", 60, 50)]).parts.map((p) => p.key)).toEqual(["hrv"]);
  });

  it("says which parts are still building their usual, and how far", () => {
    // the developer's case: a month of sleep, a new band's 5 days of resting heart rate, no HRV
    const r = readiness([P("sleep", 7.8, 7.2, 28), P("restingHr", 57, 58, 5)]);
    expect(r).toMatchObject({ score: null, need: 7, building: [{ key: "restingHr", value: 57, days: 5 }] });
    expect(r.parts.map((p) => p.key)).toEqual(["sleep"]);
    // a score with one part still building keeps telling about it
    expect(readiness([P("sleep", 8, 7), P("hrv", 60, 50), P("restingHr", 55, 55, 2)])).toMatchObject({ score: 90, building: [{ key: "restingHr", days: 2 }] });
    expect(readiness([P("sleep", 8, 7), P("hrv", 60, 50)]).building).toEqual([]);
  });

  it("does not list a part with a full history but a zero usual as building", () => {
    const r = readiness([P("sleep", 8, 7), P("hrv", 60, 50), P("restingHr", 55, 0, 28)]);
    expect(r.building).toEqual([]);
    expect(r.parts.map((p) => p.key)).toEqual(["sleep", "hrv"]);
  });

  it("reads today's values, else yesterday's, against the 28 days before", async () => {
    const W = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username) VALUES ($1, 'w')", [W]);
    const as = async (method: string, path: string, body?: unknown, query?: Record<string, string>) => (await eng.handle({ method, path, body, query, userId: W })).body as any;
    const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    expect(await as("GET", "/health/readiness", undefined, { tz: "0" })).toEqual({ score: null, label: null, parts: [], building: [], need: 7, date: day(0) });
    const entries = [];
    for (let i = 1; i <= 20; i++) entries.push({ date: day(i), kind: "sleep_h", value: 7 }, { date: day(i + 1), kind: "resting_hr", value: 55 });
    // long before: not part of the usual
    entries.push({ date: day(40), kind: "sleep_h", value: 3 });
    entries.push({ date: day(0), kind: "sleep_h", value: 8 }, { date: day(1), kind: "resting_hr", value: 55 });
    await as("PUT", "/daily", { entries });
    const r = await as("GET", "/health/readiness", undefined, { tz: "0" });
    expect(r).toMatchObject({ score: 80, label: "Ready", date: day(0) });
    expect(r.parts).toEqual([
      { key: "sleep", value: 8, baseline: 7, change: 60, effect: "up" },
      { key: "restingHr", value: 55, baseline: 55, change: 0, effect: "flat" },
    ]);
  });
});

describe("heart rate in training: per exercise, per routine, in an exercise's history and in reports", () => {
  let wid: string, bench: string, row: string, routineId: string, benchWe: string, rowWe: string;
  const T0 = Date.parse("2027-01-10T17:00:00Z") / 1000;
  const iso = (s: number) => new Date(s * 1000).toISOString();

  it("splits a workout's heart rate by exercise from when each set was ticked", () => {
    // a reading every 10 s: 100 bpm during the first exercise's sets, 140 during the second's
    const hr = Array.from({ length: 180 }, (_, i) => [T0 + i * 10, i * 10 <= 600 ? 100 + (i % 5) : 140]);
    const sets = [{ weId: "a", doneS: T0 + 300 }, { weId: "a", doneS: T0 + 600 }, { weId: "b", doneS: T0 + 900 }, { weId: "b", doneS: T0 + 1200 }];
    expect(exerciseHr(hr, T0, sets)).toEqual([{ workoutExerciseId: "a", avgHr: 102, maxHr: 104 }, { workoutExerciseId: "b", avgHr: 140, maxHr: 140 }]);
    // every set ticked at once (typed in afterwards): nothing per exercise, unless the exercise has its own times
    expect(exerciseHr(hr, T0, sets.map((s) => ({ ...s, doneS: T0 + 1200 })))).toEqual([]);
    expect(exerciseHr(hr, T0, [{ weId: "a", doneS: T0 + 1200 }, { weId: "b", doneS: T0 + 1200 }], new Map([["b", [T0 + 700, T0 + 1000]]]))).toEqual([{ workoutExerciseId: "b", avgHr: 140, maxHr: 140 }]);
    // a long break before a set: only the last 10 minutes count
    expect(exerciseHr([[T0 + 10, 180], [T0 + 3000, 120]], T0, [{ weId: "a", doneS: T0 + 3000 }])).toEqual([{ workoutExerciseId: "a", avgHr: 120, maxHr: 120 }]);
    expect(exerciseHr(null, T0, sets)).toEqual([]);
  });

  it("adds it to the workout's detail, the routine and the exercise's history", async () => {
    bench = (await call("POST", "/exercises", { name: "HR bench" })).id;
    row = (await call("POST", "/exercises", { name: "HR row" })).id;
    routineId = (await call("POST", "/routines", { name: "HR day", exercises: [{ exerciseId: bench, sets: [{ reps: 5 }] }] })).id;
    wid = (await call("POST", "/workouts/log", {
      routineId, startedAt: iso(T0), endedAt: iso(T0 + 1800),
      exercises: [{ exerciseId: bench, sets: [{ reps: 5, weightKg: 60 }, { reps: 5, weightKg: 60 }] }, { exerciseId: row, sets: [{ reps: 8, weightKg: 50 }] }],
    })).id;
    const w0 = await call("GET", `/workouts/${wid}`);
    expect(w0.exerciseHr).toEqual([]);
    [benchWe, rowWe] = w0.exercises.map((e: any) => e.id);
    // as if ticked during the workout
    const sets = w0.exercises.flatMap((e: any) => e.sets.map((s: any) => s.id));
    for (const [i, sid] of sets.entries()) await eng.db.admin.query("UPDATE workout_sets SET done_at = $2 WHERE id = $1", [sid, iso(T0 + 300 * (i + 1))]);
    const hr = Array.from({ length: 180 }, (_, i) => [T0 + i * 10, i * 10 <= 600 ? 110 : 150]);
    await call("POST", "/health/ranges", { results: [{ kind: "workout", id: wid, hr }] });

    const w = await call("GET", `/workouts/${wid}`);
    expect(w.exerciseHr).toEqual([{ workoutExerciseId: benchWe, avgHr: 110, maxHr: 110 }, { workoutExerciseId: rowWe, avgHr: 150, maxHr: 150 }]);

    const h = (await call("GET", `/exercises/${row}/history`)).sessions;
    expect(h[0]).toMatchObject({ workoutId: wid, workoutExerciseId: rowWe, avgHr: 150, maxHr: 150 });

    const r = await call("GET", `/routines/${routineId}`);
    expect(r.hr).toEqual({ avg: w.avgHr, max: 150, sessions: [{ workoutId: wid, date: iso(T0), avgHr: w.avgHr, maxHr: 150 }] });
    const other = (await call("POST", "/routines", { name: "No band" })).id;
    expect((await call("GET", `/routines/${other}`)).hr).toBeNull();
  });

  it("puts sleep, resting heart rate, HRV and workout heart rate in a month's report", async () => {
    await call("PUT", "/daily", { entries: [
      { date: "2027-01-05", kind: "sleep_h", value: 7 }, { date: "2027-01-06", kind: "sleep_h", value: 8 },
      { date: "2027-01-05", kind: "resting_hr", value: 54 }, { date: "2027-01-06", kind: "hrv", value: 41 },
    ] });
    const s = await call("GET", "/stats", undefined, { from: "2027-01-01T00:00:00Z", to: "2027-02-01T00:00:00Z", tz: "0" });
    const w = await call("GET", `/workouts/${wid}`);
    expect(s.health).toEqual({ sleepAvgMin: 450, sleepNights: 2, restingHrAvg: 54, hrvAvg: 41, workoutAvgHr: w.avgHr });
    const none = await call("GET", "/stats", undefined, { from: "2027-03-01T00:00:00Z", to: "2027-04-01T00:00:00Z", tz: "0" });
    expect(none.health).toEqual({ sleepAvgMin: null, sleepNights: 0, restingHrAvg: null, hrvAvg: null, workoutAvgHr: null });
  });
});
