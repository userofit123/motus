// Schedules, programs, activities and CSV export.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import { occurrences } from "../src/modules/schedule";
import { parseTrack, routeStats } from "../src/modules/activities";

let eng: Engine, U: string;
const call = async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
  const r = await eng.handle({ method, path, body, query, userId: U });
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"));
  U = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username) VALUES ($1, 'u')", [U]);
}, 120000);

describe("schedules", () => {
  it("works out weekly, interval and moved days", () => {
    const s: any = { rule: "weekly", days: [0, 3], startDate: "2026-11-01", endDate: null, active: true, intervalDays: null };
    expect(occurrences(s, [], "2026-11-01", "2026-11-14")).toEqual(["2026-11-01", "2026-11-04", "2026-11-08", "2026-11-11"]);
    expect(occurrences(s, [{ date: "2026-11-04", kind: "moved", movedTo: "2026-11-05" }, { date: "2026-11-08", kind: "skipped", movedTo: null }], "2026-11-01", "2026-11-14"))
      .toEqual(["2026-11-01", "2026-11-05", "2026-11-11"]);
    expect(occurrences({ ...s, rule: "interval", intervalDays: 3 }, [], "2026-11-01", "2026-11-10")).toEqual(["2026-11-01", "2026-11-04", "2026-11-07", "2026-11-10"]);
  });
});

describe("programs", () => {
  it("follows the routines in order", async () => {
    const a = (await call("POST", "/routines", { template: "full-a" })).id, b = (await call("POST", "/routines", { template: "full-b" })).id;
    await call("POST", "/programs", { name: "AB", weeks: [{ days: [a, b] }, { days: [a, b], deload: true }], startDate: "2020-01-01" });
    let p = (await call("GET", "/programs"))[0];
    expect(p.state.next.routineId).toBe(a);
    await call("POST", "/workouts/log", { routineId: a, startedAt: new Date().toISOString(), exercises: [] });
    p = (await call("GET", "/programs"))[0];
    expect(p.state.next.routineId).toBe(b);
    expect(p.state.done).toBe(1);
  });
});

describe("activities", () => {
  it("reads a GPX file and measures it", async () => {
    const gpx = `<gpx><trk><name>Walk</name><trkseg>${[0, 1, 2, 3].map((i) => `<trkpt lat="${32 + i * 0.001}" lon="34.8"><time>2026-10-30T07:0${i}:00Z</time></trkpt>`).join("")}</trkseg></trk></gpx>`;
    const t = parseTrack(gpx);
    expect(t.route.length).toBe(4);
    expect(Math.round(routeStats(t.route).distanceM / 10)).toBe(33); // ~333 m
    const r = await call("POST", "/activities/import", { files: [{ text: gpx }] });
    expect(r.count).toBe(1);
    const list = await call("GET", "/activities");
    expect(list[0].distanceM).toBeGreaterThan(300);
  });
  it("exports workouts as CSV", async () => {
    const csv = await call("GET", "/export/csv", undefined, { what: "workouts" });
    expect(csv.text.split("\n")[0]).toContain("Exercise Name");
  });
});
