// Schedules, programs, activities and CSV export.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import { occurrences } from "../src/modules/schedule";
import { routeStats, routeSplits, addStepReading, stepsPaused, takesPoint, MotionSteps, STEP_RUN, type StepState } from "@motus/shared";
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

  it("repeats monthly on the start date's day, or the last day of a shorter month", () => {
    const s: any = { rule: "monthly", days: [], startDate: "2026-01-31", endDate: null, active: true, intervalDays: null };
    expect(occurrences(s, [], "2026-01-01", "2026-06-30")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"]);
    expect(occurrences(s, [], "2028-02-01", "2028-02-29")).toEqual(["2028-02-29"]); // a leap year
    expect(occurrences({ ...s, startDate: "2026-11-08" }, [], "2026-11-01", "2027-01-31")).toEqual(["2026-11-08", "2026-12-08", "2027-01-08"]);
    // never before it starts, never after it ends
    expect(occurrences({ ...s, startDate: "2026-11-15", endDate: "2027-01-10" }, [], "2026-10-01", "2027-03-01")).toEqual(["2026-11-15", "2026-12-15"]);
  });

  it("saves a monthly plan and puts it on the calendar", async () => {
    const r = (await call("POST", "/routines", { name: "Monthly test" })).id;
    const sid = (await call("POST", "/schedules", { routineId: r, rule: "monthly", startDate: "2031-03-31" })).id;
    const cal = await call("GET", "/calendar", undefined, { from: "2031-03-01", to: "2031-05-31", tz: "0" });
    expect(cal.planned.filter((p: any) => p.scheduleId === sid).map((p: any) => p.date)).toEqual(["2031-03-31", "2031-04-30", "2031-05-31"]);
    await call("PUT", `/schedules/${sid}`, { rule: "once", startDate: "2031-04-02" });
    const after = await call("GET", "/calendar", undefined, { from: "2031-03-01", to: "2031-05-31", tz: "0" });
    expect(after.planned.filter((p: any) => p.scheduleId === sid).map((p: any) => p.date)).toEqual(["2031-04-02"]);
  });

  it("takes a planned day off the calendar: skipping one day of a repeating plan, undoing it, removing a one-off", async () => {
    const r = (await call("POST", "/routines", { name: "Unplan test" })).id;
    const weekly = (await call("POST", "/schedules", { routineId: r, rule: "weekly", days: [1], startDate: "2031-06-01" })).id;
    const once = (await call("POST", "/schedules", { routineId: r, rule: "once", startDate: "2031-06-03" })).id;
    const days = async (sid: string) => (await call("GET", "/calendar", undefined, { from: "2031-06-01", to: "2031-06-16", tz: "0" })).planned.filter((p: any) => p.scheduleId === sid);
    expect((await days(weekly)).map((p: any) => [p.date, p.repeats])).toEqual([["2031-06-02", true], ["2031-06-09", true], ["2031-06-16", true]]);
    expect((await days(once)).map((p: any) => [p.date, p.repeats])).toEqual([["2031-06-03", false]]);
    await call("POST", `/schedules/${weekly}/exception`, { date: "2031-06-09" });
    expect((await days(weekly)).map((p: any) => p.date)).toEqual(["2031-06-02", "2031-06-16"]);
    await call("POST", `/schedules/${weekly}/exception`, { date: "2031-06-09", clear: true });
    expect((await days(weekly)).map((p: any) => p.date)).toEqual(["2031-06-02", "2031-06-09", "2031-06-16"]);
    await call("DELETE", `/schedules/${once}`);
    expect(await days(once)).toEqual([]);
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

  it("stays off Home while Programs is switched off", async () => {
    expect((await call("GET", "/home", undefined, { tz: "0" })).programs.length).toBeGreaterThan(0);
    await call("PUT", "/settings", { features: { programs: false } });
    const home = await call("GET", "/home", undefined, { tz: "0" });
    expect(home.programs).toEqual([]);
    expect(home.suggest.filter((x: any) => x.kind === "program")).toEqual([]);
    await call("PUT", "/settings", { features: { programs: true } });
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
  it("counts steps reported while Pause's or Resume's reading is on its way on the side of the one asked first", () => {
    // nothing on its way: as the recording is now
    expect(stepsPaused(false, null, null)).toBe(false);
    expect(stepsPaused(true, null, null)).toBe(true);
    // only Pause's: taken before it, so they count; only Resume's: taken while paused, so they don't
    expect(stepsPaused(true, 1, null)).toBe(false);
    expect(stepsPaused(false, null, 1)).toBe(true);
    // Pause, then a quick Resume: until Pause's reading is in, reports are from before the pause and count
    expect(stepsPaused(false, 1, 2)).toBe(false);
    // Resume, then a quick Pause: until Resume's reading is in, reports are from the pause just ended and don't
    expect(stepsPaused(true, 2, 1)).toBe(true);
  });
  it("counts the phone's step counter's steps since the walk started, without counting any twice", () => {
    let s: StepState = { steps: 0, session: null, seen: 0 };
    const read = (counter: number, paused = false, session = 1) => (s = addStepReading(s, { session, counter }, paused)).steps;
    expect(read(-1)).toBe(0); // just started, no report yet
    expect(read(0)).toBe(0);
    // the counter holds back the first steps until it's sure you're walking, then reports them all at once, and later
    // ones in bunches
    expect(read(12)).toBe(12);
    expect(read(30)).toBe(30);
    // the same reading again, or one that comes late, adds nothing
    expect(read(30)).toBe(30);
    expect(read(25)).toBe(30);
    // while paused nothing counts, and after it only what's new
    expect(read(40, true)).toBe(30);
    expect(read(42)).toBe(32);
    // the app restarted mid-walk: its counter counts again from zero, and the walk goes on from what it had
    expect(read(-1, false, 2)).toBe(32);
    expect(read(7, false, 2)).toBe(39);
    // the counter's first report already has the steps it held back: all of them count (the Android app takes the
    // start from before the walk, so they are in the count since the start)
    s = { steps: 0, session: null, seen: 0 };
    expect(read(-1, false, 3)).toBe(0);
    expect(read(11, false, 3)).toBe(11);
    // a pause pressed, then the steps from before it reported late: they count (Pause asks for them, not paused)
    expect(read(15, false, 3)).toBe(15);
    expect(read(20, true, 3)).toBe(15);
    // a count that went down (the Android app keeps it going over a phone restart, so this only guards against it)
    // adds nothing, and only steps past it count after
    expect(read(18, false, 3)).toBe(15);
    expect(read(22, false, 3)).toBe(17);
  });
  it("estimates steps from the motion sensor once you walk in a rhythm, and ignores wobbles, taps and shakes", () => {
    // `amp`: how far the push rises above gravity at each step (m/s²), `hz` steps a second, then 3 s standing still
    const walk = (amp: number, steps: number, hz = 1.8) => {
      const m = new MotionSteps(); let n = 0, firstAt = -1;
      for (let t = 0; t <= (steps / hz) * 1000 + 3000; t += 16) {
        const walking = t < (steps / hz) * 1000;
        const push = 9.81 + (walking ? amp * Math.sin(2 * Math.PI * hz * t / 1000) : 0) + Math.sin(t * 7.3) * 0.08;
        const d = m.push(push, t);
        if (d) { n += d; if (firstAt < 0) firstAt = t; }
      }
      return { n, firstAt };
    };
    // a phone held in front of you, in a pocket, and a run
    for (const [amp, hz] of [[1.5, 1.8], [4, 1.8], [6, 2.8]] as const) {
      const w = walk(amp, 50, hz);
      expect(Math.abs(w.n - 50)).toBeLessThanOrEqual(1);
      expect(w.firstAt).toBeLessThan((STEP_RUN / hz) * 1000); // the first steps come in by the sixth
    }
    // a gentle walk, just above the limit
    expect(Math.abs(walk(1.3, 50).n - 50)).toBeLessThanOrEqual(1);
    // steps as bumps at the given times (ms), each ~0.2 s long
    const bumps = (at: number[], amp = 3) => {
      const m = new MotionSteps(); let n = 0;
      for (let t = 0; t < at[at.length - 1]! + 3000; t += 16) n += m.push(9.81 + (at.some((x) => t >= x && t < x + 200) ? amp * Math.sin(Math.PI * (t - at.find((x) => t >= x && t < x + 200)!) / 200) : 0), t);
      return n;
    };
    const steps = Array.from({ length: 30 }, (_, i) => 1000 + i * 550);
    expect(bumps(steps)).toBe(30);
    // a confirmed walk with one step too soft to see, or one bump between two steps: it keeps its count
    expect(bumps(steps.filter((_, i) => i !== 15))).toBe(30);
    expect(bumps([...steps.slice(0, 16), steps[15]! + 275, ...steps.slice(16)])).toBe(30);
    // stopping after a confirmed walk, then one bump about two steps' time later (taking the phone out, a tap): nothing
    expect(bumps([...steps, steps[29]! + 1000])).toBe(30);
    expect(bumps([...steps, steps[29]! + 1900])).toBe(30);
    // a hesitation (sooner or later than a missed step would be), then walking on: each step once
    const went = (pause: number) => [...steps.slice(0, 16), ...steps.slice(16).map((x) => x - 550 + pause)];
    expect(bumps(went(950))).toBe(30);
    expect(bumps(went(1500))).toBe(30);
    // two odd ones in a row start it over, and it never counts more steps than were taken
    expect(bumps(steps.filter((_, i) => i !== 15 && i !== 17))).toBeLessThanOrEqual(30);
    expect(bumps(steps.flatMap((x, i) => (i % 2 ? [x, x + 275] : [x])))).toBeLessThanOrEqual(30);
    // standing still, a slight wobble in a walking rhythm, a few shakes: nothing
    expect(walk(0, 0).n).toBe(0);
    expect(walk(0.5, 50).n).toBe(0);
    expect(walk(4, STEP_RUN - 1).n).toBe(0);
    // one bump (picking the phone up): nothing
    const m = new MotionSteps(); let n = 0;
    for (let t = 0; t < 5000; t += 16) n += m.push(9.81 + (t > 1000 && t < 1200 ? 3 : 0), t);
    expect(n).toBe(0);
    // bumps at random moments (fiddling with the phone): out of rhythm, so nothing
    const r = new MotionSteps(); let k = 0; const at = [0, 400, 1500, 1850, 3300, 3700, 5200, 5500, 6900, 7400];
    for (let t = 0; t < 10000; t += 16) k += r.push(9.81 + (at.some((x) => t >= 1000 + x && t < 1000 + x + 120) ? 3 : 0), t);
    expect(k).toBe(0);
  });
  it("takes a GPS fix on the route only when it means ground covered", () => {
    const route = [[32, 34.8, 0]];
    expect(takesPoint(route, [32.0005, 34.8, 30], 8, false)).toBe(true); // ~55 m on
    expect(takesPoint(route, [32.0005, 34.8, 30], 8, true)).toBe(false); // paused
    expect(takesPoint(route, [32.0005, 34.8, 30], 120, false)).toBe(false); // rough fix
    expect(takesPoint(route, [32.00001, 34.8, 30], 8, false)).toBe(false); // standing still (~1 m)
    expect(takesPoint([], [32, 34.8, 0], 8, false)).toBe(true); // the first fix
  });
  it("leaves out the way covered while paused", () => {
    // ~55 m apart each; the 4th point is where you went on after walking ~555 m while paused
    const r = [[32, 34.8, 0], [32.0005, 34.8, 30], [32.001, 34.8, 60], [32.006, 34.8, 400], [32.0065, 34.8, 430]];
    const all = routeStats(r), split = routeStats(r, [3]);
    expect(Math.round(all.distanceM / 10)).toBe(72);
    expect(Math.round(split.distanceM / 10)).toBe(17);
    expect(split.movingS).toBe(90);
  });
  it("splits a route per km by moving time, so a stop doesn't slow its km", () => {
    // ~55.6 m every 20 s (~6 min per km) for ~2.5 km, with a 10-minute stop at the 25th point
    const r = Array.from({ length: 46 }, (_, i) => [32 + i * 0.0005, 34.8, 1_700_000_000 + i * 20 + (i > 25 ? 600 : 0)]);
    const s = routeSplits(r, 1000);
    expect(s.map((x) => x.n)).toEqual([1, 2, 3]);
    expect(s.map((x) => !!x.partial)).toEqual([false, false, true]);
    for (const x of s) expect(Math.abs(x.s - 360)).toBeLessThan(25);
    expect(routeSplits(r.map((p) => p.slice(0, 2)), 1000)).toEqual([]); // no times: no splits
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

describe("calendar: done plans", () => {
  it("leaves out a planned day once it's done, by routine, activity type or the plan itself, on the app's day", async () => {
    const r = (await call("POST", "/routines", { name: "Legs" })).id;
    const walk = (await call("POST", "/schedules", { activityType: "walk", rule: "interval", intervalDays: 1, startDate: "2026-11-01", endDate: "2026-11-06" })).id;
    await call("POST", "/schedules", { routineId: r, rule: "once", startDate: "2026-11-04", timeOfDay: "18:00" });
    const late = (await call("POST", "/schedules", { routineId: r, rule: "once", startDate: "2026-11-05" })).id;
    const tz = { tz: "-120" }; // UTC+2
    // 23:30 UTC on the 1st is the 2nd in the app's day
    await call("POST", "/activities", { type: "walk", startedAt: "2026-11-01T23:30:00Z", durationS: 1800 });
    // a run is not a walk, and a free workout (no routine) is not a planned walk either
    await call("POST", "/activities", { type: "run", startedAt: "2026-11-03T08:00:00Z", durationS: 1800 });
    const free = await call("POST", "/workouts/start", { name: "Free", startedAt: "2026-11-03T09:00:00Z" });
    await call("POST", `/workouts/${free.id}/finish`, {});
    // the routine on its planned day; and the plan for the 5th started a day late from the plan itself
    const w1 = await call("POST", "/workouts/start", { routineId: r, startedAt: "2026-11-04T17:00:00Z" });
    await call("POST", `/workouts/${w1.id}/finish`, {});
    const w2 = await call("POST", "/workouts/start", { routineId: r, scheduleId: late, scheduledDate: "2026-11-05", startedAt: "2026-11-06T10:00:00Z" });
    await call("POST", `/workouts/${w2.id}/finish`, {});
    const cal = await call("GET", "/calendar", undefined, { from: "2026-11-01", to: "2026-11-06", ...tz });
    const left = cal.planned.map((p: any) => `${p.date} ${p.scheduleId === walk ? "walk" : "legs"}`);
    expect(left).toEqual(["2026-11-01 walk", "2026-11-03 walk", "2026-11-04 walk", "2026-11-05 walk", "2026-11-06 walk"]);
    // what was done is still all there
    expect(cal.activities.filter((a: any) => a.startedAt.startsWith("2026-11-0")).length).toBe(2);
    expect([free.id, w1.id, w2.id].every((x) => cal.workouts.some((w: any) => w.id === x))).toBe(true);
    // in UTC the walk falls on the 1st instead
    const utc = await call("GET", "/calendar", undefined, { from: "2026-11-01", to: "2026-11-02", tz: "0" });
    expect(utc.planned.filter((p: any) => p.scheduleId === walk).map((p: any) => p.date)).toEqual(["2026-11-02"]);
    for (const s of await call("GET", "/schedules")) await call("DELETE", `/schedules/${s.id}`);
  });
});
