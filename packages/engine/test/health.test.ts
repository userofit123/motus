// Health Connect import: daily steps and sleep, weight and exercise sessions from the phone.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import { overrule } from "../src/sync/core";
import { heartRate, plausibleSteps } from "../src/modules/health";

let eng: Engine, U: string;
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
    expect(again).toEqual({ steps: 0, sleep: 0, restingHr: 0, spo2: 0, hrv: 0, weight: 0, activities: 0 });
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

    expect(await call("POST", "/health/import", batch)).toEqual({ steps: 0, sleep: 0, restingHr: 0, spo2: 0, hrv: 0, weight: 0, activities: 0 });
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
