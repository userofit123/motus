// Schedules, programs, activities and CSV export.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import { occurrences } from "../src/modules/schedule";
import { routeStats } from "@motus/shared";
import { parseTrack } from "../src/modules/activities";

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
  it("shows a program in full: the plan with what was done, where you are against the calendar, and totals", async () => {
    const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    const a = (await call("POST", "/routines", { template: "push" })).id, b = (await call("POST", "/routines", { template: "pull" })).id;
    const { id: pid } = await call("POST", "/programs", { name: "PP", weeks: [{ days: [a, b] }, { days: [a, b], deload: true }, { days: [a, b] }], startDate: day(8) });
    for (const [r, n] of [[a, 7], [a, 6], [b, 5]] as const) await call("POST", "/workouts/log", { routineId: r, startedAt: `${day(n)}T10:00:00Z`, exercises: [] });
    // started from the program out of order: it's the program's, but not a step forward
    const w = await call("POST", "/workouts/start", { routineId: b, programId: pid });
    for (const e of w.exercises) for (const s of e.sets) await call("PUT", `/workout-sets/${s.id}`, { weightKg: 50, reps: 5, done: true });
    await call("POST", `/workouts/${w.id}/finish`, {});
    let p = await call("GET", `/programs/${pid}`, undefined, { tz: "0" });
    expect(p.status).toBe("active");
    expect(p.calendarWeek).toBe(2);
    expect(p.state.next).toMatchObject({ routineId: a, week: 2, day: 1, deload: true });
    expect(p.plan[0].days.map((d: any) => d.status)).toEqual(["done", "done"]);
    expect(p.plan[0].days[0].workout.startedAt).toContain(day(7));
    expect(p.plan[1]).toMatchObject({ deload: true });
    expect(p.plan[1].days.map((d: any) => d.status)).toEqual(["next", "todo"]);
    expect(p.stats).toMatchObject({ done: 2, total: 6, weeksDone: 1, expected: 2, adherencePct: 100 });
    expect(p.stats.volumeKg).toBeGreaterThan(0);
    expect(p.stats.perRoutine.find((x: any) => x.routineId === a)).toMatchObject({ done: 1, planned: 3 });
    expect(p.recent.map((x: any) => x.id)[0]).toBe(w.id);
    expect(p.recent[0].week).toBeNull();
    expect(p.recent).toHaveLength(3);
    // two weeks on and nothing more done: week 2 is behind
    await call("PUT", `/programs/${pid}`, { startDate: day(15) });
    p = await call("GET", `/programs/${pid}`, undefined, { tz: "0" });
    expect(p.calendarWeek).toBe(3);
    expect(p.plan[1].days.map((d: any) => d.status)).toEqual(["next", "late"]);
    expect(p.stats.adherencePct).toBe(50);
    // starting again from today: nothing done yet
    await call("PUT", `/programs/${pid}`, { startDate: day(0), active: false });
    p = await call("GET", `/programs/${pid}`, undefined, { tz: "0" });
    expect(p).toMatchObject({ status: "paused", calendarWeek: 1, state: { done: 0 } });
    expect((await eng.handle({ method: "GET", path: `/programs/${uuidv7()}`, userId: U })).status).toBe(404);
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
  it("says which types count steps, deciding by slug when it's unset", async () => {
    const steps = async () => Object.fromEntries((await call("GET", "/activity-types")).map((t: any) => [t.slug, t.hasSteps]));
    expect(await steps()).toMatchObject({ walk: true, run: true, hike: true, cycle: false });
    const { slug } = await call("POST", "/activity-types", { name: "Nordic walk", hasDistance: true, hasGps: true, hasSteps: true });
    expect((await steps())[slug]).toBe(true);
    await call("PUT", `/activity-types/${slug}`, { hasSteps: false });
    expect((await steps())[slug]).toBe(false);
    // left out of a rename: stays as it was
    await call("PUT", `/activity-types/${slug}`, { name: "Nordic" });
    expect((await steps())[slug]).toBe(false);
    // unset, as an older app's sync or backup leaves it
    await eng.db.admin.query("UPDATE activity_types SET has_steps = NULL WHERE user_id = $1 AND slug IN ('walk', 'cycle', $2)", [U, slug]);
    expect(await steps()).toMatchObject({ walk: true, cycle: false, [slug]: false });
  });
  it("leaves out the way covered while paused", () => {
    // ~55 m apart each; the 4th point is where you went on after walking ~555 m while paused
    const r = [[32, 34.8, 0], [32.0005, 34.8, 30], [32.001, 34.8, 60], [32.006, 34.8, 400], [32.0065, 34.8, 430]];
    const all = routeStats(r), split = routeStats(r, [3]);
    expect(Math.round(all.distanceM / 10)).toBe(72);
    expect(Math.round(split.distanceM / 10)).toBe(17);
    expect(split.movingS).toBe(90);
  });
  it("counts a real climb but not GPS wobble, and leaves an unknown climb unset", async () => {
    // as the app sends a route (null: no altitude), and as it's kept (a point without altitude has no 4th value)
    const at = (alts: (number | null)[]) => alts.map((alt, i) => [32 + i * 0.0005, 34.8, 1_700_000_000 + i * 30, alt]);
    const kept = (alts: (number | null)[]) => at(alts).map((p) => (p[3] == null ? p.slice(0, 3) : p) as number[]);
    expect(routeStats(kept([100, 103, 99, 102, 100, 103, 101])).elevationM).toBe(0);
    expect(routeStats(kept([100, 102, 105, 110, 108])).elevationM).toBe(10);
    // a point with no altitude in the middle doesn't count as 0 m and back up
    expect(routeStats(kept([100, null, 101, null, 100])).elevationM).toBe(0);
    expect(routeStats(kept([null, null, null])).elevationM).toBeNull();
    // a climb made while paused (the point after the break is 20 m higher) isn't counted
    expect(routeStats(kept([100, 101, 121, 122]), [2]).elevationM).toBe(0);
    expect(routeStats(kept([100, 101, 121, 122])).elevationM).toBe(21);
    // climb counted before a pause stays known when no point after the break has an altitude
    expect(routeStats(kept([100, 110, null, null]), [2]).elevationM).toBe(10);
    const { id } = await call("POST", "/activities", { type: "walk", startedAt: "2026-10-30T07:00:00Z", durationS: 60, route: at([null, null, null]), source: "gps" });
    const a = await call("GET", `/activities/${id}`);
    expect(a.elevationM).toBeNull();
    expect(a.route.every((p: any[]) => p.length === 3)).toBe(true);
  });
  it("exports workouts as CSV", async () => {
    const csv = await call("GET", "/export/csv", undefined, { what: "workouts" });
    expect(csv.text.split("\n")[0]).toContain("Exercise Name");
  });
});

describe("body and daily log", () => {
  it("saves a tape session in one go, and refuses it whole if one value is missing", async () => {
    const at = "2026-10-01T08:00:00Z";
    const r = await call("POST", "/body", { measuredAt: at, entries: [{ kind: "waist", value: 82 }, { kind: "arm_l", value: 36.5 }] });
    expect(r.ids).toHaveLength(2);
    const got = await call("GET", "/body");
    expect(got.filter((x: any) => x.measuredAt.startsWith("2026-10-01")).map((x: any) => x.kind).sort()).toEqual(["arm_l", "waist"]);
    await expect(call("POST", "/body", { entries: [{ kind: "chest", value: 100 }, { kind: "neck" }] })).rejects.toThrow(/400/);
    expect((await call("GET", "/body", undefined, { kind: "chest" })).length).toBe(0);
    expect((await call("POST", "/body", { kind: "weight", value: 80 })).id).toBeTruthy();
  });
  it("files the daily log under activity, not the body log", async () => {
    let topics: string[] = [];
    const off = eng.onChange((_u, t) => { topics = t; });
    await call("PUT", "/daily", { date: "2026-10-02", kind: "steps", value: 9000 });
    off();
    expect(topics).toContain("activities");
    expect(topics).not.toContain("body");
    expect((await call("GET", "/daily", undefined, { from: "2026-10-01" })).find((x: any) => x.kind === "steps").value).toBe(9000);
  });
});
