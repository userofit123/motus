// No band data counted twice (M-250): the same steps, heart rate, sleep or session arriving again (a read overlapping
// the one before, a record re-written with a newer change time, the same records under new ids from a second phone or
// Gadgetbridge installed again), or from two apps at once (the band's app beside Gadgetbridge, the phone's own step
// counter beside the band) never adds to a day's total, its hours, a night or the activities.
// Gadgetbridge's pattern as it writes to Health Connect: a steps record per stretch it synced, a heart rate record per
// run of readings, and a record it writes again keeps its id with a newer last-modified time.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import { rangeHr, sleepDays, spanBand } from "../src/modules/healthDerive";
import { hourly, type Rec, type Hour } from "../src/modules/healthRecords";

const GB = "nodomain.freeyourgadget.gadgetbridge", MI = "com.xiaomi.wearable";
const D = "2026-10-12", T = Date.parse(D + "T00:00:00Z") / 1000, H = 3600, M = 60;
const BAND = { type: 6, maker: "Xiaomi", model: "Mi Band 8" };
let eng: Engine, U: string;
const call = async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
  const r = await eng.handle({ method, path, body, query, userId: U });
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const steps = (id: string, o: string, s: number, e: number, v: number, m = 1, dv?: object) => ({ id, s, e, z: 0, o, m, v, ...(dv ? { dv } : {}) });
const hr = (id: string, o: string, s: number, n: number, m = 1) =>
  ({ id, s, e: s + n * M, z: 0, o, m, dv: BAND, p: Array.from({ length: n }, (_, i) => [s + i * M, 70 + (i % 30)]) });
// the phone reads 2 days at a time, each piece overlapping the one before (native/health.ts, syncRecords)
const post = (from: string, to: string, source: string, types: Record<string, unknown[]>) => call("POST", "/health/records", {
  from, to, source, tz: 0, types: Object.fromEntries(Object.entries(types).map(([t, records]) => [t, { complete: true, records }])),
});
const dayStr = (d: number) => new Date((T + d * 86400) * 1000).toISOString();
const dailyOf = async (kind: string) => (await call("GET", "/daily", undefined, { from: "2026-10-01", tz: "0" })).find((x: any) => x.kind === kind && String(x.date).slice(0, 10) === D);
const hoursOf = async (type: string) => (await call("GET", "/health/records/hourly", undefined, { type, from: dayStr(0), to: dayStr(1), tz: "0" })).hours as Hour[];
const total = (hs: Hour[]) => Math.round(hs.reduce((t, h) => t + (h.sum ?? 0), 0));

beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"));
  U = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username) VALUES ($1, 'u')", [U]);
}, 120000);

describe("the same band data arriving again", () => {
  // three syncs of Gadgetbridge over the morning: 08:00-08:30, 08:30-09:00, 09:00-10:00; heart rate in two runs
  const gbSteps = [steps("g1", GB, T + 8 * H, T + 8.5 * H, 1000), steps("g2", GB, T + 8.5 * H, T + 9 * H, 500), steps("g3", GB, T + 9 * H, T + 10 * H, 2000)];
  const gbHr = [hr("r1", GB, T + 8 * H, 30), hr("r2", GB, T + 9 * H, 30)];

  it("a read overlapping the one before, and the same records from a second phone, change nothing", async () => {
    expect(await post(dayStr(-1), dayStr(1), "A", { steps: gbSteps, heart_rate: gbHr })).toEqual({ saved: 5, removed: 0 });
    expect(await dailyOf("steps")).toMatchObject({ value: 3500, synced: 3500 });
    expect(total(await hoursOf("steps"))).toBe(3500);
    const hrHours = await hoursOf("heart_rate");
    expect(hrHours.map((h) => h.n)).toEqual([30, 30]);
    // the next piece overlaps a day; a second phone sends the very same records
    expect(await post(dayStr(0), dayStr(2), "A", { steps: gbSteps, heart_rate: gbHr })).toEqual({ saved: 0, removed: 0 });
    expect(await post(dayStr(-1), dayStr(1), "B", { steps: gbSteps, heart_rate: gbHr })).toEqual({ saved: 0, removed: 0 });
    expect(await dailyOf("steps")).toMatchObject({ value: 3500 });
    expect(total(await hoursOf("steps"))).toBe(3500);
    expect(await hoursOf("heart_rate")).toEqual(hrHours);
  });

  it("a record Gadgetbridge writes again (same id, newer change time) replaces it, never adds", async () => {
    // the last stretch synced again with the minutes walked since: same id, more steps
    const again = [...gbSteps.slice(0, 2), steps("g3", GB, T + 9 * H, T + 10 * H, 2400, 2)];
    expect(await post(dayStr(-1), dayStr(1), "A", { steps: again, heart_rate: gbHr })).toEqual({ saved: 1, removed: 0 });
    expect(await dailyOf("steps")).toMatchObject({ value: 3900 });
    expect(total(await hoursOf("steps"))).toBe(3900);
    // an older copy arriving late (a phone that hadn't read the change) doesn't take it back
    expect(await post(dayStr(-1), dayStr(1), "B", { steps: gbSteps })).toEqual({ saved: 0, removed: 0 });
    expect(await dailyOf("steps")).toMatchObject({ value: 3900 });
  });

  it("the same data under new ids (Gadgetbridge installed again, a second phone's Health Connect) counts once", async () => {
    const copy = [steps("n1", GB, T + 8 * H, T + 8.5 * H, 1000), steps("n2", GB, T + 8.5 * H, T + 9 * H, 500), steps("n3", GB, T + 9 * H, T + 10 * H, 2400, 3)];
    const hrCopy = [hr("q1", GB, T + 8 * H, 30), hr("q2", GB, T + 9 * H, 30)];
    await post(dayStr(-1), dayStr(1), "B", { steps: copy, heart_rate: hrCopy });
    expect(await dailyOf("steps")).toMatchObject({ value: 3900 });
    expect(total(await hoursOf("steps"))).toBe(3900);
    // each second's heart rate once: the hours' counts and averages as with one copy
    expect((await hoursOf("heart_rate")).map((h) => h.n)).toEqual([30, 30]);
  });
});

describe("the same band data from two apps", () => {
  const E = "2026-10-20", TE = Date.parse(E + "T00:00:00Z") / 1000;
  const iso = (d: number) => new Date((TE + d * 86400) * 1000).toISOString();
  const dayHours = async (type: string) => (await call("GET", "/health/records/hourly", undefined, { type, from: iso(0), to: iso(1), tz: "0" })).hours as Hour[];
  const daily = async (kind: string) => (await call("GET", "/daily", undefined, { from: "2026-10-01", tz: "0" })).find((x: any) => x.kind === kind && String(x.date).slice(0, 10) === E);

  it("the phone's own step counter beside the band: the day and its hours are the band's only", async () => {
    await post(iso(-1), iso(1), "A", { steps: [
      steps("b1", GB, TE + 10 * H, TE + 11 * H, 3000), steps("b2", GB, TE + 15 * H, TE + 16 * H, 1000),
      // the phone counted the same walk, and an hour the band missed
      steps("p1", "android", TE + 10 * H, TE + 11 * H, 2600), steps("p2", "android", TE + 12 * H, TE + 13 * H, 800),
    ] });
    expect(await daily("steps")).toMatchObject({ value: 4000, worn: true });
    const hs = await dayHours("steps");
    expect(total(hs)).toBe(4000);
    expect(hs.map((h) => `${h.at.slice(11, 13)}:${h.sum}`)).toEqual(["10:3000", "15:1000"]);
  });

  it("two apps for the same band: the larger one's, not both added", async () => {
    await post(iso(-1), iso(1), "A", { steps: [
      steps("b1", GB, TE + 10 * H, TE + 11 * H, 3000), steps("b2", GB, TE + 15 * H, TE + 16 * H, 1000),
      steps("p1", "android", TE + 10 * H, TE + 11 * H, 2600), steps("p2", "android", TE + 12 * H, TE + 13 * H, 800),
      steps("x1", MI, TE + 10 * H, TE + 11 * H, 3100, 1, BAND), steps("x2", MI, TE + 15 * H, TE + 16 * H, 1050, 1, BAND),
    ] });
    expect(await daily("steps")).toMatchObject({ value: 4150 });
    expect(total(await dayHours("steps"))).toBe(4150);
  });

  it("a night written by two apps, and sent again under a new id, is one night in its hours", async () => {
    const night = (id: string, o: string, st: [number, number, number][] = []) => ({ id, s: TE - 2 * H, e: TE + 6 * H, z: 0, o, m: 1, st });
    await post(iso(-2), iso(1), "A", { sleep: [
      night("n1", GB, [[TE - 2 * H, TE, 4], [TE, TE + 2 * H, 5], [TE + 2 * H, TE + 6 * H, 6]]),
      night("n2", MI), night("n3", GB, [[TE - 2 * H, TE, 4], [TE, TE + 2 * H, 5], [TE + 2 * H, TE + 6 * H, 6]]),
    ] });
    expect(await daily("sleep_h")).toMatchObject({ value: 8 });
    const hs = await dayHours("sleep");
    // 6 hours after midnight, 60 minutes each, all from the staged night (deep then REM), none doubled
    expect(hs.map((h) => Object.values(h.stages!).reduce((a, b) => a + b, 0))).toEqual([60, 60, 60, 60, 60, 60]);
    expect(hs[0]!.stages).toEqual({ 5: 60 });
  });

  it("the same workout written by two apps: its minutes once", () => {
    const w = (s: number, e: number, o: string): Rec => ({ s, e, z: 0, o, m: 1, x: 56 });
    const hs = hourly("exercise", [w(TE + 10 * H, TE + 11 * H, GB), w(TE + 10 * H + 2 * M, TE + 11 * H, MI)], TE, TE + 86400, 0);
    expect(hs.map((h) => h.sum)).toEqual([60]);
  });

  it("heart rate read by two apps at the same seconds: each second once in a session, a night and the hours", () => {
    const a: Rec = { s: TE, e: TE + 10 * M, z: 0, o: GB, m: 1, dv: BAND, p: Array.from({ length: 10 }, (_, i) => [TE + i * M, 100 + i] as [number, number]) };
    const b: Rec = { ...a, o: MI, p: a.p!.map(([t, v]) => [t, v + 1] as [number, number]) };
    expect(rangeHr([a, b], TE, TE + 10 * M)).toHaveLength(10);
    expect(rangeHr([a, a], TE, TE + 10 * M)).toEqual(rangeHr([a], TE, TE + 10 * M));
    expect(spanBand([], [a, { ...a }], TE, TE + 10 * M).hr).toHaveLength(10);
    expect(hourly("heart_rate", [a, b], TE, TE + H, 0)[0]).toMatchObject({ n: 10, min: 100, max: 109 });
    const nightRec: Rec = { s: TE - H, e: TE + H, z: 0, o: GB, m: 1, st: [[TE - H, TE + H, 4]] };
    const one = sleepDays([nightRec], [a], [], [], [E]).get(E)!.night!, two = sleepDays([nightRec], [a, { ...a }, b], [], [], [E]).get(E)!.night!;
    expect(two.avgHr).toBe(one.avgHr);
    expect(two.hr).toEqual(one.hr);
  });
});

describe("a session brought in by two apps", () => {
  const count = async () => Number((await eng.db.admin.query<{ n: number }>("SELECT count(*)::int AS n FROM activities WHERE user_id = $1", [U])).rows[0]!.n);
  const walk = (id: string, start: string, end: string, steps: number) => ({ id, type: "walk", title: "Walk", start, end, steps, distanceM: steps * 0.7 });

  it("is one activity, listed once, its steps counted once on the day", async () => {
    const before = await count();
    // Gadgetbridge and the band's own app each wrote the walk (other ids, a minute apart), and it is read again later
    const both = [walk("hc-gb", "2026-11-03T10:00:00Z", "2026-11-03T10:40:00Z", 4000), walk("hc-mi", "2026-11-03T10:01:00Z", "2026-11-03T10:40:00Z", 4100)];
    expect((await call("POST", "/health/import", { sessions: both })).activities).toBe(1);
    expect((await call("POST", "/health/import", { sessions: both })).activities).toBe(0);
    expect(await count()).toBe(before + 1);
    const items = (await call("GET", "/health/imports", undefined, { tz: "0" })).items.filter((x: any) => x.kind === "activity");
    expect(items.map((x: any) => x.key)).toEqual(["activity:hc-gb"]);
    const day = (await call("GET", "/daily", undefined, { from: "2026-11-03", tz: "0" })).find((x: any) => x.kind === "steps" && String(x.date).slice(0, 10) === "2026-11-03");
    expect(day).toMatchObject({ value: 4000, walked: 4000 });
    // a different walk that only partly overlaps it is its own
    expect((await call("POST", "/health/import", { sessions: [walk("hc-other", "2026-11-03T10:30:00Z", "2026-11-03T11:30:00Z", 5000)] })).activities).toBe(1);
  });

  it("deleted once, stays out from both apps", async () => {
    await call("DELETE", "/health/imports/activity:hc-gb");
    const both = [walk("hc-gb", "2026-11-03T10:00:00Z", "2026-11-03T10:40:00Z", 4000), walk("hc-mi", "2026-11-03T10:01:00Z", "2026-11-03T10:40:00Z", 4100)];
    expect((await call("POST", "/health/import", { sessions: both })).activities).toBe(0);
  });
});

// A band session of a workout or activity recorded in Motus is linked to that record (M-250 fix round, bandMatch):
// never a second activity, so training load, a day's walked steps and the scores' activity minutes count it once.
describe("a band session of a workout or activity done in Motus", () => {
  const W = "2026-10-20";
  const at = (h: number, m = 0) => `${W}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;
  const session = (id: string, s: string, e: string, extra: object = {}) => ({ id, type: "walk", start: s, end: e, ...extra });
  const acts = async () => (await eng.db.admin.query<{ id: string; source: string; steps: number | null; calories: number | null }>(
    "SELECT id::text AS id, source, steps, calories FROM activities WHERE user_id = $1 AND started_at >= $2::date AND started_at < $2::date + 1 ORDER BY started_at", [U, W])).rows;
  const imports = async () => ((await call("GET", "/health/imports", undefined, { tz: "0", limit: "200" })).items as any[]).filter((x) => x.kind === "activity" && x.date === W);
  const workout = async (s: string, e: string) => {
    const id = uuidv7();
    await eng.db.admin.query("INSERT INTO workouts (id, user_id, name, status, started_at) VALUES ($1,$2,'Push','in_progress',$3)", [id, U, s]);
    await call("POST", `/workouts/${id}/finish`, { endedAt: e });
    return id;
  };
  let w1 = "", w2 = "";

  it("is linked to a finished workout, whichever arrives first, and training load counts the workout once", async () => {
    await call("PUT", "/settings", { features: { trainingLoad: true } });
    // the workout first, then its band session (inside it, starting later and ending earlier)
    w1 = await workout(at(10), at(11));
    expect((await call("POST", "/health/import", { sessions: [session("w1", at(10, 5), at(10, 55), { type: "strength" })] })).activities).toBe(0);
    // the session first (brought in as an activity), then the workout is finished: taken into it
    expect((await call("POST", "/health/import", { sessions: [session("w2", at(14), at(14, 40))] })).activities).toBe(1);
    w2 = await workout(at(13, 55), at(14, 50));
    expect(await acts()).toEqual([]);
    expect((await imports()).map((x) => [x.key, x.linked, x.workout?.id])).toEqual([["activity:w2", "workout", w2], ["activity:w1", "workout", w1]]);
    // the same session again, and from a second app: still linked, still no activity
    expect((await call("POST", "/health/import", { sessions: [session("w1", at(10, 5), at(10, 55)), session("w1b", at(10, 6), at(10, 55))] })).activities).toBe(0);
    expect(await acts()).toEqual([]);
    const load = (await call("GET", "/health/load", undefined, { from: W, to: W, tz: "0" })).load;
    expect(load.sessions.filter((s: any) => s.date === W).map((s: any) => s.kind).sort()).toEqual(["workout", "workout"]);
  });

  it("is linked to an activity recorded in Motus, which gets the band's steps and calories; the day's walked steps count once", async () => {
    const mine = (await call("POST", "/activities", { type: "walk", startedAt: at(16), endedAt: at(17) })).id as string;
    expect((await call("POST", "/health/import", { sessions: [session("a1", at(16, 2), at(16, 58), { steps: 5000, calories: 300 })] })).activities).toBe(0);
    expect(await acts()).toEqual([{ id: mine, source: "manual", steps: 5000, calories: 300 }]);
    const steps = (await call("GET", "/daily", undefined, { from: W, tz: "0" })).find((x: any) => x.kind === "steps" && String(x.date).slice(0, 10) === W);
    expect(steps).toMatchObject({ value: 5000, walked: 5000 });
    // the scores' activity minutes read the activities: one walk of 60 minutes, not two
    expect((await imports()).find((x) => x.key === "activity:a1")).toMatchObject({ linked: "activity", activity: { id: mine } });
  });

  it("unlinked, comes in as its own activity and is never matched again", async () => {
    await call("POST", "/health/imports/activity%3Aa1/unlink");
    expect(((await call("GET", "/health/imports/deleted")).items as any[]).find((x) => x.key === "activity:a1")).toMatchObject({ restored: true });
    expect((await call("POST", "/health/import", { sessions: [session("a1", at(16, 2), at(16, 58), { steps: 5000 })] })).activities).toBe(1);
    expect((await acts()).map((x) => x.source)).toEqual(["manual", "health_connect"]);
    // a later import or save doesn't take it back in
    await call("POST", "/health/import", { sessions: [] });
    expect((await acts()).length).toBe(2);
  });

  it("a session of no length matches nothing", async () => {
    expect((await call("POST", "/health/import", { sessions: [session("z", at(10, 30), at(10, 30))] })).activities).toBe(1);
    expect((await imports()).find((x) => x.key === "activity:z")).toMatchObject({ linked: null });
  });

  it("deleted, the same session from a second app arriving later stays out too", async () => {
    expect((await call("POST", "/health/import", { sessions: [session("d1", at(19), at(19, 30))] })).activities).toBe(1);
    await call("DELETE", "/health/imports/activity%3Ad1");
    expect((await call("POST", "/health/import", { sessions: [session("d2", at(19, 1), at(19, 30))] })).activities).toBe(0);
    const del = ((await call("GET", "/health/imports/deleted")).items as any[]).map((x) => x.key);
    expect(del).toEqual(expect.arrayContaining(["activity:d1", "activity:d2"]));
  });
});
