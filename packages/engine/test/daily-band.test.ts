// The daily log marks what came from a band, and a value typed over the band's can go back to it (PUT /daily band: true).
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";

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
    expect(await day("steps", "2026-11-13")).toMatchObject({ value: 6120, source: "health_connect", band: true });
    // a typed value restores nothing, so the answer says nothing about it
    expect(await call("PUT", "/daily", { date: "2026-11-13", kind: "steps", value: 5774 })).not.toHaveProperty("restored");
    expect(await day("steps", "2026-11-13")).toMatchObject({ value: 5774, source: "manual", band: true });
    await call("PUT", "/daily", { date: "2026-11-12", kind: "water_ml", value: 1500 });
    expect(await day("water_ml", "2026-11-12")).toMatchObject({ source: "manual", band: false });
  });

  it("steps go back to the band's at its next read of the day, not deleted for good", async () => {
    // the band's count is no longer known, so the day waits for the next import
    expect(await call("PUT", "/daily", { date: "2026-11-13", kind: "steps", band: true })).toMatchObject({ restored: false });
    expect(await day("steps", "2026-11-13")).toMatchObject({ value: null, band: true, waiting: true });
    expect((await call("POST", "/health/import", { steps: [{ date: "2026-11-13", value: 6300 }] })).steps).toBe(1);
    expect(await day("steps", "2026-11-13")).toMatchObject({ value: 6300, source: "health_connect", band: true, waiting: false });
    // and later reads keep it up to date
    await call("POST", "/health/import", { steps: [{ date: "2026-11-13", value: 6400 }] });
    expect((await day("steps", "2026-11-13")).value).toBe(6400);
  });

  it("a day with no value left waits for the band, also with no row of its own", async () => {
    await call("POST", "/health/import", { sleep: [{ date: "2026-11-10", hours: 6.5 }] });
    await call("PUT", "/daily", { date: "2026-11-10", kind: "sleep_h", value: 7 });
    expect(await call("PUT", "/daily", { date: "2026-11-10", kind: "sleep_h", band: true })).toMatchObject({ restored: false });
    expect(await day("sleep_h", "2026-11-10")).toMatchObject({ value: null, band: true, waiting: true });
    await call("POST", "/health/import", { sleep: [{ date: "2026-11-10", hours: 6.6 }] });
    expect(await day("sleep_h", "2026-11-10")).toMatchObject({ source: "health_connect", band: true, waiting: false });
  });

  it("sleep goes back to the night's time asleep at once", async () => {
    const night = { date: "2026-11-14", start: "2026-11-13T23:00:00Z", end: "2026-11-14T07:00:00Z", asleepMin: 468, awakeMin: 12 };
    await call("POST", "/health/import", { sleep: [{ date: "2026-11-14", hours: 7.8 }], sleepNights: [night] });
    await call("PUT", "/daily", { date: "2026-11-14", kind: "sleep_h", value: 6 });
    expect(await day("sleep_h", "2026-11-14")).toMatchObject({ value: 6, source: "manual", band: true });
    expect(await call("PUT", "/daily", { date: "2026-11-14", kind: "sleep_h", band: true })).toMatchObject({ restored: true });
    expect(await day("sleep_h", "2026-11-14")).toMatchObject({ value: 7.8, source: "health_connect", band: true });
    // the band updates the day again
    await call("POST", "/health/import", { sleep: [{ date: "2026-11-14", hours: 7.9 }] });
    expect(Number((await day("sleep_h", "2026-11-14")).value)).toBe(7.9);
  });
});
