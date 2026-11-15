// The band's numbers worked out from the saved Health Connect records (M-238): the same numbers the phone worked out
// before (MotusHealthPlugin.kt dailyTotal / spanByApp / bestBand / rangeHr) for the same records, pinned here.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import fs from "node:fs";
import path from "node:path";
import { bandDays, readingDays, spanBand, isBand, sleepDays, rangeHr, noteRead, loadReads, readDay } from "../src/modules/healthDerive";
import { withUser } from "../src/db";
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
    from, to, source: "A", types: { steps: { complete: true, records: steps.map((x) => wire(x.id, x.r)) }, ...(hr.length ? { heart_rate: { complete: true, records: hr.map((x) => wire(x.id, x.r)) } } : {}) },
  });
  beforeAll(async () => {
    eng = await createEngine(await pgliteDb("memory://"));
    U = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username) VALUES ($1, 'u')", [U]);
  }, 120000);

  it("works a band day's steps out from the saved records; the phone's total stays for a day without; a typed value stays in use", async () => {
    const day1 = [
      { id: "a", r: st(GB, T + 8 * H, T + 8 * H + 10 * M, 500) }, { id: "b", r: st(GB, T + 9 * H, T + 9 * H + 10 * M, 650) },
      { id: "p", r: st("android", T + 9 * H, T + 10 * H, 4000) },
    ];
    // read in part only (up to 9:30): the phone's number stands until the whole day was read
    await save("2026-10-12T00:00:00Z", "2026-10-12T09:30:00Z", day1);
    expect(await daily(D)).toBeUndefined();
    await save("2026-10-12T09:30:00Z", "2026-10-13T00:00:00Z", day1);
    expect(await daily(D)).toMatchObject({ value: 1150, synced: 1150, worn: true, source: "health_connect" });
    // the phone's import later: the records stand for the band's day (no flip back), its total for a day without records
    const out = await call("POST", "/health/import", { steps: [{ date: D, value: 5150, worn: true }, { date: "2026-10-10", value: 777, worn: false }] });
    expect(out.steps).toBe(1);
    expect(await daily(D)).toMatchObject({ value: 1150, synced: 1150 });
    expect(await daily("2026-10-10")).toMatchObject({ value: 777, worn: false });
    expect((await call("GET", "/health/imports", undefined, { tz: "0" })).items.some((x: any) => x.key === `steps:${D}`)).toBe(true);
    // typed by hand: the day keeps using it while the band's goes on following its records
    await call("PUT", "/daily", { date: D, kind: "steps", value: 2000 });
    await save("2026-10-12T00:00:00Z", "2026-10-13T00:00:00Z", [...day1, { id: "c", r: st(GB, T + 11 * H, T + 11 * H + 10 * M, 100) }]);
    expect(await daily(D)).toMatchObject({ value: 2000, typed: 2000, synced: 1250 });
    // the synced one chosen (M-230): a recompute changes the synced value only, the choice stays
    await call("POST", `/health/imports/steps:${D}/use`);
    await save("2026-10-12T00:00:00Z", "2026-10-13T00:00:00Z", [...day1, { id: "c", r: st(GB, T + 11 * H, T + 11 * H + 10 * M, 120) }]);
    expect(await daily(D)).toMatchObject({ value: 1270, typed: 2000, synced: 1270, chosen: "synced" });
    // a record deleted in Health Connect
    await call("POST", "/health/records", { from: "2026-10-12T00:00:00Z", to: "2026-10-12T00:00:01Z", deleted: ["c"] });
    expect(await daily(D)).toMatchObject({ synced: 1150 });
  });

  it("leaves a day alone once its import log key is deleted", async () => {
    const D3 = "2026-10-15", T3 = Date.parse(D3 + "T00:00:00Z") / 1000;
    await save(`${D3}T00:00:00Z`, "2026-10-16T00:00:00Z", [{ id: "k1", r: st(GB, T3 + 8 * H, T3 + 9 * H, 700) }]);
    expect(await daily(D3)).toMatchObject({ synced: 700 });
    await call("DELETE", `/health/imports/steps:${D3}`);
    await save(`${D3}T00:00:00Z`, "2026-10-16T00:00:00Z", [{ id: "k1", r: st(GB, T3 + 8 * H, T3 + 9 * H, 700) }, { id: "k2", r: st(GB, T3 + 10 * H, T3 + 11 * H, 300) }]);
    expect(await daily(D3)).toBeUndefined();
    expect((await eng.db.admin.query("SELECT 1 FROM daily_logs WHERE user_id = $1 AND date = $2", [U, D3])).rows).toHaveLength(0);
  });

  it("classifies an app writing for the phone and a watch the same way in the import and after records", async () => {
    // Samsung Health: its newest record naming a device says watch; the day's own records name none
    const SH = "com.sec.android.app.shealth", D4 = "2026-10-25", T4 = Date.parse(D4 + "T00:00:00Z") / 1000;
    await save("2026-10-24T00:00:00Z", "2026-10-26T00:00:00Z", [
      { id: "x1", r: st(SH, T4 - 20 * H, T4 - 19 * H, 900, { dv: { type: 1 } }) }, { id: "x2", r: st(SH, T4 + 8 * H, T4 + 9 * H, 2222) },
    ]);
    expect(await daily(D4)).toMatchObject({ synced: 2222, worn: true });
    expect(await daily("2026-10-24")).toMatchObject({ synced: 900 });
    await call("POST", "/health/import", { steps: [{ date: D4, value: 6000, worn: true }] });
    expect(await daily(D4)).toMatchObject({ synced: 2222 });
  });

  it("classifies an app quiet for 30 days the same in the import and after records, whatever days each loads", async () => {
    // a watch app whose newest records name the watch, then nothing for 30 days; a later day's records name no device
    const WA = "com.example.watchapp", D5 = "2026-09-01", T5 = Date.parse(D5 + "T00:00:00Z") / 1000, D6 = "2026-10-01", T6 = T5 + 30 * 86400;
    await save(`${D5}T00:00:00Z`, "2026-09-02T00:00:00Z", [{ id: "wa1", r: st(WA, T5 + 8 * H, T5 + 9 * H, 800, { dv: { type: 1 } }) }]);
    await save(`${D6}T00:00:00Z`, "2026-10-02T00:00:00Z", [{ id: "wa2", r: st(WA, T6 + 8 * H, T6 + 9 * H, 3333) }]);
    // after records: the day loaded holds only wa2 (no device), yet the app is the watch by its newest typed record
    expect(await daily(D6)).toMatchObject({ synced: 3333, worn: true });
    // the import loads other days around D6 and classifies it the same: the records' number stands
    await call("POST", "/health/import", { steps: [{ date: D6, value: 9000, worn: true }] });
    expect(await daily(D6)).toMatchObject({ synced: 3333 });
    // and another save whose window doesn't reach D5 at all still counts the app as the watch
    await save(`${D6}T00:00:00Z`, "2026-10-02T00:00:00Z", [{ id: "wa2", r: st(WA, T6 + 8 * H, T6 + 9 * H, 3400, { m: 2 }) }]);
    expect(await daily(D6)).toMatchObject({ synced: 3400, worn: true });
  });

  it("works a night and the day's sleep out from the records", async () => {
    const r = nightRecs(), w = (p: string, l: Rec[]) => l.map((x, i) => ({ id: `${p}${i}`, ...x }));
    await call("POST", "/health/records", { from: "2026-10-11T00:00:00Z", to: "2026-10-13T00:00:00Z", source: "A", types: {
      sleep: { complete: true, records: w("n", r.sleep) }, heart_rate: { complete: true, records: w("hh", r.hr) }, spo2: { complete: true, records: w("o", r.spo2) },
      resp_rate: { complete: true, records: w("b", r.resp) } } });
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
      resting_hr: { complete: true, records: [{ id: "r1", s: T2 + 6 * H, z: 0, o: GB, m: 1, v: 51 }, { id: "r2", s: T2 + 7 * H, z: 0, o: GB, m: 1, v: 54 }] },
      distance: { complete: true, records: [{ id: "d1", s: T2 + 8 * H, e: T2 + 9 * H, z: 0, o: GB, m: 1, v: 2500.6 }] },
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
    // not reaching past the end yet: the records don't stand for the walk, so neither its steps nor its heart rate are
    // taken from them (the phone's read keeps them, below: no taking turns)
    let a = await call("GET", `/activities/${id}`);
    expect(a).toMatchObject({ steps: 3000, stepsSource: null, maxHr: null });
    const phoneHr = Array.from({ length: 10 }, (_, i) => [s + i * 60, 120]);
    await call("POST", "/health/ranges", { results: [{ kind: "activity", id, hr: phoneHr }] });
    expect(await call("GET", `/activities/${id}`)).toMatchObject({ maxHr: 120 });
    await save("2026-11-02T00:00:00Z", "2026-11-03T00:00:00Z", [
      { id: "w1", r: st(GB, s - 10 * M, s + 10 * M, 2000) }, { id: "w2", r: st(GB, s + 10 * M, s + 20 * M, 1500) },
    ], [{ id: "h1", r: hrRec(GB, s, 30) }, { id: "h2", r: hrRec(GB, s + 40 * M, 5) }]);
    expect(await call("GET", `/activities/${id}`)).toMatchObject({ steps: 3000, maxHr: 120 });
    await save("2026-11-02T00:00:00Z", "2026-11-03T00:00:00Z", [
      { id: "w1", r: st(GB, s - 10 * M, s + 10 * M, 2000) }, { id: "w2", r: st(GB, s + 10 * M, s + 20 * M, 1500) }, { id: "w3", r: st(GB, e - 5 * M, e + 5 * M, 1800) },
    ], [{ id: "h1", r: hrRec(GB, s, 30) }]);
    a = await call("GET", `/activities/${id}`);
    expect(a).toMatchObject({ steps: 3400, stepsSource: "band", stepsApp: 3000, maxHr: 109 });
    expect(a.hr).toHaveLength(30);
    // the phone's read says otherwise: the records cover the walk, so they stand
    expect((await call("POST", "/health/ranges", { results: [{ kind: "activity", id, steps: 9000, covered: true, bandOnly: true }] })).steps).toBe(0);
    expect(await call("GET", `/activities/${id}`)).toMatchObject({ steps: 3400, stepsSource: "band" });
  });

  it("takes a workout's heart rate from the records once they cover it, and writes nothing when nothing changed", async () => {
    const s = Date.parse("2026-11-05T18:00:00Z") / 1000, wid = uuidv7();
    await eng.db.admin.query("INSERT INTO workouts (id, user_id, name, status, started_at, ended_at) VALUES ($1, $2, 'Gym', 'completed', to_timestamp($3), to_timestamp($4))", [wid, U, s, s + 40 * M]);
    const recs = [{ id: "g1", r: st(GB, s - 40 * M, s + 20 * M, 100) }, { id: "g2", r: st(GB, s + 20 * M, s + 80 * M, 100) }];
    await save("2026-11-05T00:00:00Z", "2026-11-06T00:00:00Z", recs, [{ id: "gh", r: hrRec(GB, s, 40) }]);
    const w = (await eng.db.admin.query<any>("SELECT max_hr, updated_at FROM workouts WHERE id = $1", [wid])).rows[0];
    expect(w.max_hr).toBe(119);
    await save("2026-11-05T00:00:00Z", "2026-11-06T00:00:00Z", recs, [{ id: "gh", r: hrRec(GB, s, 40) }]);
    expect((await eng.db.admin.query<any>("SELECT updated_at FROM workouts WHERE id = $1", [wid])).rows[0].updated_at).toEqual(w.updated_at);
  });
});

describe("an activity's heart rate over 600 readings", () => {
  it("is averaged into 600 buckets in milliseconds, as the phone's rangeHr", () => {
    const start = 1_760_000_000.25, end = start + 1234.5;
    const recs: Rec[] = [{ s: start, e: end, z: 0, o: GB, m: 1, p: Array.from({ length: 2000 }, (_, i) => [Math.floor(start) + 1 + Math.floor(i * 0.6), 60 + (i % 50)] as [number, number]) }];
    // the phone's arithmetic: whole milliseconds, Long division
    const t0 = BigInt(Math.round(start * 1000)), span = BigInt(Math.round(end * 1000)) - t0;
    const sumT = new Array(600).fill(0), sumB = new Array(600).fill(0), n = new Array(600).fill(0);
    for (const [t, b] of recs[0]!.p!) {
      if (t < start || t > end) continue;
      const ms = BigInt(t) * 1000n, i = Math.min(599, Math.max(0, Number(((ms - t0) * 600n) / span)));
      sumT[i] += Number(ms); sumB[i] += b; n[i]++;
    }
    const want = [];
    for (let i = 0; i < 600; i++) if (n[i]) want.push([Math.round(sumT[i] / n[i] / 1000), Math.round(sumB[i] / n[i])]);
    expect(rangeHr(recs, start, end)).toEqual(want);
  });
});

describe("the times read whole", () => {
  let eng: Engine, U: string;
  const note = (type: string, a: number, b: number, z = 0) => withUser(eng.db, U, (q) => noteRead(q, U, type, a, b, z));
  const reads = (type: string) => withUser(eng.db, U, (q) => loadReads(q, [type]));
  const windows = async (type: string) => [...(await reads(type)).get(type)!].sort((x, y) => x.z - y.z || x.a - y.a);
  beforeAll(async () => {
    eng = await createEngine(await pgliteDb("memory://"));
    U = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username) VALUES ($1, 'u')", [U]);
  }, 120000);

  it("merges reads that touch or overlap, and leaves a gap between two reads unread", async () => {
    await note("steps", T, T + 6 * H);
    await note("steps", T + 6 * H, T + 12 * H); // touching
    await note("steps", T + 10 * H, T + 24 * H); // overlapping
    expect(await windows("steps")).toEqual([{ a: T, b: T + 24 * H, z: 0 }]);
    expect(readDay(await reads("steps"), "steps", D)).toBe(true);
    // 30 seconds apart: two windows, and the day across the gap is not read whole
    await note("distance", T, T + 12 * H);
    await note("distance", T + 12 * H + 30, T + 24 * H);
    expect(await windows("distance")).toEqual([{ a: T, b: T + 12 * H, z: 0 }, { a: T + 12 * H + 30, b: T + 24 * H, z: 0 }]);
    expect(readDay(await reads("distance"), "distance", D)).toBe(false);
  });

  it("keeps each zone's reads apart: a day read where it was read stays read after a read in another zone", async () => {
    const east = 2 * H; // the day began at T - 2h there
    await note("heart_rate", T - 2 * H, T + 22 * H, east);
    expect(readDay(await reads("heart_rate"), "heart_rate", D)).toBe(true);
    // a later read at UTC overlapping it: its own window, the earlier one keeps its zone
    await note("heart_rate", T + 20 * H, T + 30 * H, 0);
    expect(await windows("heart_rate")).toEqual([{ a: T + 20 * H, b: T + 30 * H, z: 0 }, { a: T - 2 * H, b: T + 22 * H, z: east }]);
    expect(readDay(await reads("heart_rate"), "heart_rate", D)).toBe(true);
    // both zones together cover D at UTC, but no single read did
    await note("resting_hr", T, T + 12 * H, 0);
    await note("resting_hr", T + 10 * H, T + 24 * H, east);
    expect(readDay(await reads("resting_hr"), "resting_hr", D)).toBe(false);
    // two reads of different zones beginning at the same second are both kept
    await note("oxygen", T, T + H, 0);
    await note("oxygen", T, T + 2 * H, east);
    expect((await windows("oxygen")).length).toBe(2);
  });
});

describe("the records lock", () => {
  // Postgres can't be made to race here (PGlite is one connection): the order is checked in the code instead. Every
  // path that marks an import deleted (041's trigger takes the lock) or writes what afterRecords writes takes the lock
  // before its first row write, as POST /health/records does
  const src = (f: string) => fs.readFileSync(path.join(__dirname, "../src", f), "utf8");
  const before = (code: string, from: string, row: RegExp, span = 2500) => {
    const at = code.indexOf(from), body = code.slice(at, at + span), lock = body.indexOf("lockRecords("), m = body.search(row);
    expect(at, from).toBeGreaterThanOrEqual(0);
    expect(lock, from).toBeGreaterThan(0);
    expect(m === -1 || lock < m, from).toBe(true);
  };
  it("is taken before any row lock", () => {
    const rows = /(UPDATE|DELETE FROM|INSERT INTO) \w|putSynced\(|forget\(|remember\(|clearDaily\(|setTyped\(|chooseDaily\(/;
    before(src("modules/health.ts"), 'r.post("/health/import"', rows);
    before(src("modules/health.ts"), 'r.del("/health/imports/:key"', rows);
    before(src("modules/activities.ts"), 'r.del("/activities/:id"', rows);
    before(src("modules/activities.ts"), 'r.del("/body/:id"', rows);
    before(src("modules/activities.ts"), 'r.put("/daily"', rows);
    before(src("modules/healthRecords.ts"), 'r.post("/health/records"', rows);
    before(src("sync/core.ts"), "export async function applyChanges(", /DELETE FROM|INSERT INTO|mergeDay\(/);
    // a restore in either mode: its first row write comes after its long setup (catalog refs, photos)
    before(src("modules/data.ts"), "export async function importAll(", /(UPDATE|DELETE FROM|INSERT INTO) \w|mergeBlock\(|insert\(/, 4500);
  });
});
