// The band's numbers worked out from the saved Health Connect records (M-238): the same numbers the phone worked out
// before (MotusHealthPlugin.kt dailyTotal / spanByApp / bestBand / rangeHr) for the same records, pinned here.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import { bandDays, readingDays, spanBand, isBand, sleepDays } from "../src/modules/healthDerive";
import type { Rec } from "../src/modules/healthRecords";

const GB = "nodomain.freeyourgadget.gadgetbridge";
const D = "2026-10-12", T = Date.parse(D + "T00:00:00Z") / 1000, H = 3600, M = 60;
const st = (o: string, s: number, e: number, v: number, extra: Partial<Rec> = {}): Rec => ({ s, e, z: 0, o, m: 1, v, ...extra });
const hrRec = (o: string, s: number, n: number, every = 60, type?: number): Rec =>
  ({ s, e: s + n * every, z: 0, o, m: 1, ...(type != null ? { dv: { type } } : {}), p: Array.from({ length: n }, (_, i) => [s + i * every, 80 + (i % 40)] as [number, number]) });

describe("which app is a band", () => {
  it("as the phone tells: never the phone's own counting or Motus, a worn device type, else a known band app", () => {
    expect(isBand(GB)).toBe(true);
    expect(isBand(`${GB}.nightly`)).toBe(true);
    expect(isBand(GB, 2)).toBe(false); // says phone
    expect(isBand("android", 6)).toBe(false);
    expect(isBand("com.android.healthconnect.phone.1")).toBe(false);
    expect(isBand("org.motus.app", 1)).toBe(false);
    expect(isBand("com.sec.android.app.shealth")).toBe(false);
    expect(isBand("com.sec.android.app.shealth", 1)).toBe(true);
  });
});

describe("a day's steps from the records", () => {
  it("is the band app's own records added up, the larger of two band apps, split at midnight, never the phone's", () => {
    const recs = [
      st(GB, T + 8 * H, T + 8 * H + 10 * M, 500),
      st(GB, T + 8 * H + 5 * M, T + 8 * H + 15 * M, 300), // overlaps the one before: both count (as Gadgetbridge shows)
      st(GB, T + 8 * H + 5 * M, T + 8 * H + 15 * M, 350, { m: 5 }), // the same span changed later: counts instead
      st(GB, T + 23.5 * H, T + 24.5 * H, 600), // half on each day
      st("android", T + 9 * H, T + 10 * H, 4000), // the phone's own counter
      st("com.xiaomi.wearable", T + 12 * H, T + 13 * H, 800, { dv: { type: 1 } }),
      st("com.xiaomi.wearable", T + 36 * H, T + 37 * H, 900, { dv: { type: 1 } }),
      st("android", T - 20 * H, T - 19 * H, 3000), // a day only the phone counted
    ];
    const got = bandDays(recs, ["2026-10-11", D, "2026-10-13"]);
    expect([...got]).toEqual([[D, { value: 1150, device: null }], ["2026-10-13", { value: 900, device: "watch" }]]);
  });

  it("goes by the record's own zone, and leaves out an app whose newest typed record says phone", () => {
    const recs = [
      st(GB, T + 23 * H, T + 23 * H + 10 * M, 120, { z: 2 * H }), // 01:00 the next day where it was written
      st("com.huawei.health", T + 10 * H, T + 11 * H, 700, { dv: { type: 6 } }),
      st("com.huawei.health", T + 12 * H, T + 13 * H, 900, { dv: { type: 2 } }),
    ];
    expect([...bandDays(recs, [D, "2026-10-13"])]).toEqual([["2026-10-13", { value: 120, device: null }]]);
  });
});

describe("an activity's steps and heart rate from the records", () => {
  const start = T + 10 * H, end = start + 30 * M;
  const steps = [
    st(GB, start - 10 * M, start + 10 * M, 2000), // half inside
    st(GB, start + 10 * M, start + 20 * M, 1500),
    st(GB, end - 5 * M, end + 5 * M, 1800), // half inside
    st("android", start, end, 3000),
  ];
  it("counts records across the edges by their share inside, and is covered when they reach past both ends", () => {
    expect(spanBand(steps, [], start, end)).toEqual({ stepsKnown: true, steps: 3400, covered: true, hr: null });
    // nothing reaching past the end yet (not synced): the count so far, not covered
    expect(spanBand(steps.slice(0, 2).concat(steps[3]!), [], start, end)).toMatchObject({ steps: 2500, covered: false });
  });
  it("takes the band's heart rate inside the time, never another app's, thinned to 600 points", () => {
    const r = spanBand(steps, [hrRec(GB, start - 5 * M, 40), hrRec("android", start, 30)], start, end);
    expect(r.hr).toHaveLength(31); // 10:00 to 10:30 inclusive
    expect(r.hr![0]).toEqual([start, 85]);
    const dense = spanBand(steps, [hrRec(GB, start, 1801, 1)], start, end).hr!;
    expect(dense).toHaveLength(600);
    expect(dense[0]).toEqual([start + 1, 81]);
    // heart rate only (no band step records): no steps, not covered
    expect(spanBand([steps[3]!], [hrRec(GB, start, 30, 60, 6)], start, end)).toMatchObject({ stepsKnown: true, steps: null, covered: false });
  });
});

describe("a day's readings from the records", () => {
  const at = (s: number, v: number, z = 0): Rec => ({ s, z, o: "any.app", m: 1, v });
  it("averages every app's readings on the day they were taken, where they were taken; VO2 max is the day's latest", () => {
    const recs = [at(T + 6 * H, 52), at(T + 7 * H, 55), at(T + 23 * H, 70, 2 * H)]; // the last is the next day where taken
    expect([...readingDays("resting_hr", recs, [D, "2026-10-13"])]).toEqual([[D, { value: 54, device: null }], ["2026-10-13", { value: 70, device: null }]]);
    expect(readingDays("spo2", [at(T + H, 96.5), at(T + 2 * H, 97.2), at(T + 3 * H, 95)], [D]).get(D)!.value).toBe(96.2);
    expect(readingDays("vo2max", [at(T + 9 * H, 41.26), at(T + 8 * H, 44)], [D]).get(D)!.value).toBe(41.3);
  });
  it("distance and active calories go by the band's own total like steps", () => {
    expect(bandDays([st(GB, T + H, T + 2 * H, 1234.4), st("com.google.android.apps.fitness", T + H, T + 3 * H, 5000)], [D]).get(D)).toEqual({ value: 1234, device: null });
  });
});

const nightRecs = () => ({
  sleep: [
    { s: T - H, e: T + 7 * H, z: 0, o: GB, m: 1, st: [[T - H, T, 4], [T, T + 30 * M, 1], [T + 30 * M, T + 3 * H, 5], [T + 3 * H, T + 7 * H, 6]] } as Rec,
    { s: T - 2 * H, e: T + H, z: 0, o: "other.app", m: 1 } as Rec, // no stages: only fills what the first left
  ],
  hr: [{ s: T + H, e: T + H + 180, z: 0, o: "any.app", m: 1, p: [[T + H, 50], [T + H + 60, 52], [T + H + 120, 60]] } as Rec,
    { s: T + 10 * H, e: T + 10 * H, z: 0, o: "any.app", m: 1, p: [[T + 10 * H, 90]] } as Rec], // after the night
  spo2: [{ s: T + 2 * H, z: 0, o: "a", m: 1, v: 95 } as Rec, { s: T + 4 * H, z: 0, o: "a", m: 1, v: 97 } as Rec],
  resp: [{ s: T + 5 * H, z: 0, o: "a", m: 1, v: 14.25 } as Rec],
});
const NIGHT = { date: D, start: new Date((T - 2 * H) * 1000).toISOString(), end: new Date((T + 7 * H) * 1000).toISOString(),
  asleepMin: 510, awakeMin: 30, lightMin: 60, deepMin: 150, remMin: 240, avgHr: 54, minHr: 50, hr: [[T + 3630, 51], [T + 3720, 60]], avgSpo2: 96, minSpo2: 95, respRate: 14.3 };

describe("a night from the records", () => {
  it("counts each moment once (staged sessions first), on the day it ended, with every app's heart rate, SpO2 and breathing in it", () => {
    const r = nightRecs();
    expect([...sleepDays(r.sleep, r.hr, r.spo2, r.resp, ["2026-10-11", D])]).toEqual([[D, { hours: 9, night: NIGHT }]]);
  });
});

describe("through the engine", () => {
  let eng: Engine, U: string;
  const call = async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
    const r = await eng.handle({ method, path, body, query, userId: U });
    if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body as any;
  };
  const daily = async (date: string) => (await call("GET", "/daily", undefined, { from: "2026-10-01", tz: "0" })).find((x: any) => x.kind === "steps" && x.date === date);
  const wire = (id: string, r: Rec) => ({ id, ...r });
  const save = (from: string, to: string, steps: { id: string; r: Rec }[], hr: { id: string; r: Rec }[] = []) => call("POST", "/health/records", {
    from, to, source: "A", types: { steps: { records: steps.map((x) => wire(x.id, x.r)) }, ...(hr.length ? { heart_rate: { records: hr.map((x) => wire(x.id, x.r)) } } : {}) },
  });
  beforeAll(async () => {
    eng = await createEngine(await pgliteDb("memory://"));
    U = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username) VALUES ($1, 'u')", [U]);
  }, 120000);

  it("works a band day's steps out from the saved records; the phone's total stays for a day without; a typed value stays in use", async () => {
    await save("2026-10-12T00:00:00Z", "2026-10-13T00:00:00Z", [
      { id: "a", r: st(GB, T + 8 * H, T + 8 * H + 10 * M, 500) }, { id: "b", r: st(GB, T + 9 * H, T + 9 * H + 10 * M, 650) },
      { id: "p", r: st("android", T + 9 * H, T + 10 * H, 4000) },
    ]);
    expect(await daily(D)).toMatchObject({ value: 1150, synced: 1150, worn: true, source: "health_connect" });
    // the phone's import later: the records stand for the band's day (no flip back), its total for a day without records
    const out = await call("POST", "/health/import", { steps: [{ date: D, value: 5150, worn: true }, { date: "2026-10-10", value: 777, worn: false }] });
    expect(out.steps).toBe(1);
    expect(await daily(D)).toMatchObject({ value: 1150, synced: 1150 });
    expect(await daily("2026-10-10")).toMatchObject({ value: 777, worn: false });
    expect((await call("GET", "/health/imports", undefined, { tz: "0" })).items.some((x: any) => x.key === `steps:${D}`)).toBe(true);
    // typed by hand: the day keeps using it while the band's goes on following its records
    await call("PUT", "/daily", { date: D, kind: "steps", value: 2000 });
    await save("2026-10-12T00:00:00Z", "2026-10-13T00:00:00Z", [{ id: "c", r: st(GB, T + 11 * H, T + 11 * H + 10 * M, 100) }]);
    expect(await daily(D)).toMatchObject({ value: 2000, typed: 2000, synced: 1250 });
    // a record deleted in Health Connect
    await call("POST", "/health/records", { from: "2026-10-12T00:00:00Z", to: "2026-10-12T00:00:01Z", deleted: ["c"] });
    expect(await daily(D)).toMatchObject({ synced: 1150 });
  });

  it("works a night and the day's sleep out from the records", async () => {
    const r = nightRecs(), w = (p: string, l: Rec[]) => l.map((x, i) => ({ id: `${p}${i}`, ...x }));
    await call("POST", "/health/records", { from: "2026-10-11T00:00:00Z", to: "2026-10-13T00:00:00Z", source: "A", types: {
      sleep: { records: w("n", r.sleep) }, heart_rate: { records: w("hh", r.hr) }, spo2: { records: w("o", r.spo2) }, resp_rate: { records: w("b", r.resp) } } });
    const rows = (await call("GET", "/daily", undefined, { from: "2026-10-01", tz: "0" })).filter((x: any) => x.date === D && x.kind === "sleep_h");
    expect(rows[0]).toMatchObject({ value: 9, synced: 9 });
    const n = (await eng.db.admin.query<any>("SELECT asleep_min, awake_min, light_min, deep_min, rem_min, avg_hr, min_hr, hr, avg_spo2, min_spo2, resp_rate FROM sleep_nights WHERE user_id = $1 AND date = $2", [U, D])).rows[0];
    expect({ ...n, avg_spo2: Number(n.avg_spo2), min_spo2: Number(n.min_spo2), resp_rate: Number(n.resp_rate) }).toEqual({ asleep_min: 510, awake_min: 30, light_min: 60, deep_min: 150, rem_min: 240,
      avg_hr: 54, min_hr: 50, hr: NIGHT.hr, avg_spo2: 96, min_spo2: 95, resp_rate: 14.3 });
    // the phone's import of the same night with other numbers: the records stand
    await call("POST", "/health/import", { sleep: [{ date: D, hours: 7 }], sleepNights: [{ ...NIGHT, asleepMin: 400 }] });
    expect((await eng.db.admin.query<any>("SELECT asleep_min FROM sleep_nights WHERE user_id = $1 AND date = $2", [U, D])).rows[0].asleep_min).toBe(510);
  });

  it("works a day's resting heart rate and distance out from the records", async () => {
    const T2 = Date.parse("2026-10-20T00:00:00Z") / 1000;
    await call("POST", "/health/records", { from: "2026-10-20T00:00:00Z", to: "2026-10-21T00:00:00Z", source: "A", types: {
      resting_hr: { records: [{ id: "r1", s: T2 + 6 * H, z: 0, o: GB, m: 1, v: 51 }, { id: "r2", s: T2 + 7 * H, z: 0, o: GB, m: 1, v: 54 }] },
      distance: { records: [{ id: "d1", s: T2 + 8 * H, e: T2 + 9 * H, z: 0, o: GB, m: 1, v: 2500.6 }] },
    } });
    const rows = (await call("GET", "/daily", undefined, { from: "2026-10-20", tz: "0" })).filter((x: any) => x.date === "2026-10-20");
    expect(rows.find((x: any) => x.kind === "resting_hr")).toMatchObject({ value: 53, synced: 53 });
    expect(rows.find((x: any) => x.kind === "distance_m")).toMatchObject({ value: 2501, worn: true });
  });

  it("works an activity's steps and heart rate out from the records, and they stand over the phone's read once they cover it", async () => {
    const s = Date.parse("2026-11-02T10:00:00Z") / 1000, e = s + 30 * M;
    const id = (await call("POST", "/activities", { type: "walk", startedAt: "2026-11-02T10:00:00Z", endedAt: "2026-11-02T10:30:00Z", source: "gps", steps: 3000 })).id;
    await save("2026-11-02T00:00:00Z", "2026-11-03T00:00:00Z", [
      { id: "w1", r: st(GB, s - 10 * M, s + 10 * M, 2000) }, { id: "w2", r: st(GB, s + 10 * M, s + 20 * M, 1500) },
    ], [{ id: "h1", r: hrRec(GB, s, 30) }]);
    // not reaching past the end yet: the band's count isn't taken, its heart rate is
    let a = await call("GET", `/activities/${id}`);
    expect(a).toMatchObject({ steps: 3000, stepsSource: null, maxHr: 109 });
    expect(a.hr).toHaveLength(30);
    await save("2026-11-02T00:00:00Z", "2026-11-03T00:00:00Z", [{ id: "w3", r: st(GB, e - 5 * M, e + 5 * M, 1800) }]);
    expect(await call("GET", `/activities/${id}`)).toMatchObject({ steps: 3400, stepsSource: "band", stepsApp: 3000 });
    // the phone's read says otherwise: the records cover the walk, so they stand
    expect((await call("POST", "/health/ranges", { results: [{ kind: "activity", id, steps: 9000, covered: true, bandOnly: true }] })).steps).toBe(0);
    expect(await call("GET", `/activities/${id}`)).toMatchObject({ steps: 3400, stepsSource: "band" });
  });
});
