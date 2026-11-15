// Every Health Connect record kept as it is (M-238): saved by id, updated on a read again, deleted when Health Connect
// no longer has it, kept out while its import log key is deleted, and read back by day and by hour.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import { hourly, cleanRecord } from "../src/modules/healthRecords";

let eng: Engine, U: string, V: string;
const call = async (method: string, path: string, body?: unknown, query?: Record<string, string>, user = U) => {
  const r = await eng.handle({ method, path, body, query, userId: user });
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const T0 = Date.parse("2026-10-10T00:00:00Z") / 1000; // midnight UTC
const day = { from: "2026-10-10T00:00:00Z", to: "2026-10-11T00:00:00Z" };
const hr = (id: string, s: number, n: number, bpm = 60, m = 1) => ({ id, s, e: s + n * 60, z: 0, o: "nodomain.freeyourgadget.gadgetbridge", dv: { type: 2, maker: "Xiaomi", model: "Mi Band" }, m, p: Array.from({ length: n }, (_, i) => [s + i * 60, bpm + i]) });
const steps = (id: string, s: number, e: number, v: number, m = 1) => ({ id, s, e, z: 0, o: "gb", m, v });
const blocks = async () => (await eng.db.admin.query("SELECT type, to_char(day, 'YYYY-MM-DD') AS day, ids FROM health_records WHERE user_id = $1 ORDER BY type, day", [U])).rows;

beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"));
  U = uuidv7(); V = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username) VALUES ($1, 'u'), ($2, 'v')", [U, V]);
}, 120000);

describe("health connect records", () => {
  it("saves every record by id in a block per type and day, and a read again changes nothing", async () => {
    const body = { ...day, types: {
      heart_rate: { complete: true, records: [hr("h1", T0 + 3600, 90), hr("h2", T0 + 8 * 3600, 30, 100)] },
      steps: { complete: true, records: [steps("s1", T0 + 3600, T0 + 3660, 80), steps("s2", T0 + 3660, T0 + 3720, 100)] },
      sleep: { complete: true, records: [{ id: "n1", s: T0 - 2 * 3600, e: T0 + 6 * 3600, z: 0, o: "gb", m: 1, st: [[T0 - 7200, T0, 4], [T0, T0 + 3600, 5], [T0 + 3600, T0 + 21600, 6]] }] },
      weight: { complete: true, records: [{ id: "w1", s: T0 + 7 * 3600, z: 0, o: "scale", m: 1, v: 80.4 }] },
    } };
    expect(await call("POST", "/health/records", body)).toEqual({ saved: 6, removed: 0 });
    expect(await call("POST", "/health/records", body)).toEqual({ saved: 0, removed: 0 });
    // the night is filed under the day it ended (the wake-up day)
    expect((await blocks()).map((b: any) => `${b.type}:${b.day}:${b.ids.length}`)).toEqual(["heart_rate:2026-10-10:2", "sleep:2026-10-10:1", "steps:2026-10-10:2", "weight:2026-10-10:1"]);
    const r = await call("GET", "/health/records", undefined, { type: "heart_rate", ...day });
    expect(r.records.map((x: any) => x.id)).toEqual(["h1", "h2"]);
    expect(r.records[0]).toMatchObject({ type: "heart_rate", start: "2026-10-10T01:00:00.000Z", end: "2026-10-10T02:30:00.000Z", origin: "nodomain.freeyourgadget.gadgetbridge", device: { type: 2, maker: "Xiaomi", model: "Mi Band" } });
    expect(r.records[0].samples).toHaveLength(90);
    // samples trimmed to the time asked for
    const part = await call("GET", "/health/records", undefined, { type: "heart_rate", from: "2026-10-10T01:00:00Z", to: "2026-10-10T01:10:00Z" });
    expect(part.records.map((x: any) => x.samples.length)).toEqual([10]);
    expect((await call("GET", "/health/records/days", undefined, { from: "2026-10-01", to: "2026-11-01" })).days)
      .toEqual([{ date: "2026-10-10", types: { heart_rate: 2, sleep: 1, steps: 2, weight: 1 } }]);
    // another person sees none of it
    expect((await call("GET", "/health/records", undefined, { type: "heart_rate", ...day }, V)).records).toEqual([]);
  });

  it("updates a changed record, moves one whose day changed, and deletes what Health Connect no longer has", async () => {
    // s1 changed (newer modified time), s2 is gone, s3 is new, and a record outside the stretch read stays
    await call("POST", "/health/records", { from: "2026-10-09T00:00:00Z", to: "2026-10-09T12:00:00Z", types: { steps: { complete: true, records: [steps("old", T0 - 86400 + 60, T0 - 86400 + 120, 5)] } } });
    const r = await call("POST", "/health/records", { ...day, types: { steps: { complete: true, records: [steps("s1", T0 + 3600, T0 + 3660, 85, 2), steps("s3", T0 + 7200, T0 + 7260, 30)] } } });
    expect(r).toEqual({ saved: 2, removed: 1 });
    const got = (await call("GET", "/health/records", undefined, { type: "steps", from: "2026-10-09T00:00:00Z", to: "2026-10-11T00:00:00Z" })).records;
    expect(got.map((x: any) => `${x.id}:${x.value}`)).toEqual(["old:5", "s1:85", "s3:30"]);
    // an older copy of a record never replaces a newer one
    await call("POST", "/health/records", { ...day, types: { steps: { records: [steps("s1", T0 + 3600, T0 + 3660, 70, 1)] } } });
    expect((await call("GET", "/health/records", undefined, { type: "steps", ...day })).records.find((x: any) => x.id === "s1").value).toBe(85);
    // a record whose start moved to the next day leaves its old block
    await call("POST", "/health/records", { from: "2026-10-11T00:00:00Z", to: "2026-10-12T00:00:00Z", types: { steps: { records: [steps("s3", T0 + 86400 + 60, T0 + 86400 + 120, 30, 2)] } } });
    expect((await blocks()).filter((b: any) => b.type === "steps").map((b: any) => `${b.day}:${b.ids.join(",")}`)).toEqual(["2026-10-09:old", "2026-10-10:s1", "2026-10-11:s3"]);
    // a list that isn't complete deletes nothing
    expect((await call("POST", "/health/records", { ...day, types: { steps: { records: [] } } })).removed).toBe(0);
  });

  it("deletes records Health Connect reported deleted, and the block when it is empty", async () => {
    expect(await call("POST", "/health/records", { ...day, types: {}, deleted: ["old", "nope"] })).toEqual({ saved: 0, removed: 1 });
    expect((await blocks()).some((b: any) => b.day === "2026-10-09")).toBe(false);
  });

  it("deleting from the import log takes the records with it, and they don't come back until restored", async () => {
    await call("POST", "/health/import", { steps: [{ date: "2026-10-10", value: 165 }], weight: [{ id: "w1", at: "2026-10-10T07:00:00Z", kg: 80.4 }] });
    await call("DELETE", `/health/imports/${encodeURIComponent("steps:2026-10-10")}`);
    await call("DELETE", `/health/imports/${encodeURIComponent("weight:w1")}`);
    const left = (await blocks()).map((b: any) => `${b.type}:${b.day}`);
    expect(left).not.toContain("steps:2026-10-10");
    expect(left).not.toContain("weight:2026-10-10");
    const again = await call("POST", "/health/records", { ...day, types: { steps: { complete: true, records: [steps("s1", T0 + 3600, T0 + 3660, 85, 2)] }, weight: { records: [{ id: "w1", s: T0 + 7 * 3600, z: 0, o: "scale", m: 1, v: 80.4 }] } } });
    expect(again.saved).toBe(0);
    await call("POST", `/health/imports/${encodeURIComponent("steps:2026-10-10")}/restore`);
    expect((await call("POST", "/health/records", { ...day, types: { steps: { complete: true, records: [steps("s1", T0 + 3600, T0 + 3660, 85, 2)] } } })).saved).toBe(1);
  });

  it("rolls a day up by hour in the app's calendar", async () => {
    const h = await call("GET", "/health/records/hourly", undefined, { type: "heart_rate", ...day, tz: "0" });
    expect(h.hours.map((x: any) => x.at.slice(11, 13))).toEqual(["01", "02", "08"]);
    expect(h.hours[0]).toMatchObject({ n: 60, min: 60, max: 119, avg: 89.5 });
    // two hours ahead of UTC: the same samples fall in the hours 03, 04 and 10 there, still from the UTC day asked for
    const ahead = await call("GET", "/health/records/hourly", undefined, { type: "heart_rate", ...day, tz: "-120" });
    expect(ahead.hours.map((x: any) => x.at)).toEqual(["2026-10-10T01:00:00.000Z", "2026-10-10T02:00:00.000Z", "2026-10-10T08:00:00.000Z"]);
  });

  it("shares amounts out over the hours and counts sleep stages in minutes", () => {
    const st = hourly("steps", [{ s: T0 + 1800, e: T0 + 5400, z: 0, o: "", m: 0, v: 100 }], T0, T0 + 86400, 0);
    expect(st.map((x) => x.sum)).toEqual([50, 50]);
    const sl = hourly("sleep", [{ s: T0, e: T0 + 5400, z: 0, o: "", m: 0, st: [[T0, T0 + 1800, 4], [T0 + 1800, T0 + 5400, 5]] }], T0, T0 + 86400, 0);
    expect(sl.map((x) => x.stages)).toEqual([{ 4: 30, 5: 30 }, { 5: 30 }]);
    const none = hourly("sleep", [{ s: T0, e: T0 + 3600, z: 0, o: "", m: 0, st: [] }], T0, T0 + 86400, 0);
    expect(none[0]!.stages).toEqual({ 2: 60 });
  });

  it("refuses records that can't be one, keeping the rest", () => {
    expect(cleanRecord("steps", { id: "a", s: T0, e: T0 - 1, v: 1 }, 0)).toBeNull();
    expect(cleanRecord("steps", { id: "a", s: T0, e: T0 + 60 }, 0)).toBeNull();
    expect(cleanRecord("resting_hr", { s: T0, v: 50 }, 0)).toBeNull();
    expect(cleanRecord("resting_hr", { id: "r", s: T0, v: 50 }, 3600)).toEqual({ id: "r", rec: { s: T0, z: 3600, o: "", m: 0, v: 50 } });
  });
});
