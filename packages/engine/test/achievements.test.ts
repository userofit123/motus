// Achievements and the home summary's calendar: totals in kg and metres, warm-ups and assisted help left out, records
// counted once per exercise per workout, and weeks and "today" on the app's calendar rather than the process's.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";

let eng: Engine, U: string, bench = "", assist = "", pushup = "";
let NOW = new Date("2026-10-07T10:00:00Z");
const TZ = "-120"; // an app two hours ahead of UTC
const call = async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
  const r = await eng.handle({ method, path, body, query, userId: U });
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const ach = async (tz = TZ) => Object.fromEntries((await call("GET", "/achievements", undefined, { tz })).map((a: any) => [a.id, a]));
const log = (startedAt: string, exercises: { exerciseId: string; sets: any[] }[], durationS = 3600) => call("POST", "/workouts/log", { startedAt, durationS, exercises });

beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"), { mode: "server", now: () => NOW });
  U = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'ach','Ach')", [U]);
  bench = (await call("POST", "/exercises", { name: "Test bench", tracking: "weight_reps", primaryMuscles: ["chest"] })).id;
  assist = (await call("POST", "/exercises", { name: "Test assisted pull-up", tracking: "assisted", primaryMuscles: ["lats"] })).id;
  pushup = (await call("POST", "/exercises", { name: "Test push-up", tracking: "bodyweight_reps", primaryMuscles: ["chest"] })).id;
  await call("PUT", "/settings", { firstDay: 1 });
  await call("POST", "/goals", { title: "Weekly target", metric: "sessions", scopeId: "workout", target: 2, period: "week" }); // the weekly goal the streak follows
}, 120000);

describe("achievements", () => {
  it("starts empty, leaving out ladders for things never done", async () => {
    const a = await ach();
    expect(a.workouts.value).toBe(0);
    expect(a.workouts.steps[0]).toMatchObject({ name: "First workout", reachedAt: null });
    expect(a.run).toBeUndefined();
    expect(a.cycle).toBeUndefined();
    expect(a.programs).toBeUndefined();
    expect(a.weighins).toBeUndefined();
  });

  it("counts finished workouts, kg lifted without warm-ups or assisted help, and time without pauses", async () => {
    await log("2026-09-29T08:00:00Z", [
      { exerciseId: bench, sets: [{ kind: "warmup", weightKg: 40, reps: 10 }, { weightKg: 60, reps: 8 }, { weightKg: 60, reps: 8 }] },
      { exerciseId: assist, sets: [{ weightKg: 30, reps: 8 }] },
    ], 2700);
    // an unfinished workout counts for nothing
    await call("POST", "/workouts/start", { name: "Not finished" });
    const a = await ach();
    expect(a.workouts.value).toBe(1);
    expect(a.workouts.steps[0].reachedAt).toBe("2026-09-29T08:00:00.000Z");
    expect(a.lifted.value).toBe(960); // 2 × 60 × 8; not the warm-up, not the 30 kg of help
    expect(a.hours.value).toBe(2700);
    const w = (await call("GET", "/workouts/active"));
    await call("POST", `/workouts/${w.id}/discard`);
  });

  it("counts a record once per exercise per workout, never the first time, and reps on body-weight exercises", async () => {
    await log("2026-09-30T08:00:00Z", [{ exerciseId: bench, sets: [{ weightKg: 62.5, reps: 8 }, { weightKg: 65, reps: 5 }] }, { exerciseId: pushup, sets: [{ reps: 10 }] }]);
    await log("2026-10-01T08:00:00Z", [{ exerciseId: bench, sets: [{ weightKg: 60, reps: 8 }] }, { exerciseId: pushup, sets: [{ reps: 12 }] }]);
    // assisted: more help (heavier) is not a record, the same help with more reps is
    await log("2026-10-02T08:00:00Z", [{ exerciseId: assist, sets: [{ weightKg: 40, reps: 8 }] }]);
    await log("2026-10-03T08:00:00Z", [{ exerciseId: assist, sets: [{ weightKg: 30, reps: 9 }] }]);
    const a = await ach();
    expect(a.records.value).toBe(3); // bench on 30 Sep, push-ups on 1 Oct, assisted on 3 Oct
    expect(a.records.steps[0].reachedAt).toBe("2026-09-30T08:00:00.000Z");
  });

  it("reads weeks on the app's calendar for the weekly-target streak", async () => {
    // Sunday 22:30 UTC is Monday 00:30 for the app: that workout belongs to the week of 5 Oct
    await log("2026-10-04T22:30:00Z", []);
    // weeks (Monday first) on the app's calendar: 28 Sep has 5 workouts, 5 Oct has 2 → two weeks in a row
    await log("2026-10-06T08:00:00Z", []);
    expect((await ach()).streak.value).toBe(2);
    // in UTC the 22:30 workout falls in the week of 28 Sep, leaving 5 Oct one short
    expect((await ach("0")).streak.value).toBe(1);
    expect((await call("GET", "/home", undefined, { tz: TZ })).thisWeek.workouts).toBe(2);
  });

  it("adds up walks and hikes in the person's distance unit, and shows running once there is a run", async () => {
    await call("POST", "/activities", { type: "walk", startedAt: "2026-10-01T17:00:00Z", durationS: 3600, distanceM: 6000 });
    await call("POST", "/activities", { type: "hike", startedAt: "2026-10-02T09:00:00Z", durationS: 7200, distanceM: 5000 });
    await call("POST", "/activities", { type: "yoga", startedAt: "2026-10-02T19:00:00Z", durationS: 1800 });
    let a = await ach();
    expect(a.walk.value).toBe(11000);
    expect(a.walk.steps[0]).toMatchObject({ name: "10 km walked", target: 10000, reachedAt: "2026-10-02T09:00:00.000Z" });
    expect(a.run).toBeUndefined();
    await call("POST", "/activities", { type: "run", startedAt: "2026-10-03T07:00:00Z", durationS: 1800, distanceM: 5000 });
    await call("PUT", "/settings", { units: { distance: "mi", weight: "lb" } });
    a = await ach();
    expect(a.run.value).toBe(5000);
    expect(a.walk.steps[0].name).toBe("10 mi walked");
    expect(a.walk.steps[0].target).toBeCloseTo(16093.44);
    expect(a.walk.steps[0].reachedAt).toBeNull();
    expect(a.lifted.steps[0].name).toBe("2k lb lifted");
    await call("PUT", "/settings", { units: { distance: "km", weight: "kg" } });
  });

  it("counts weeks with a weigh-in, not entries", async () => {
    for (const at of ["2026-09-28T07:00:00Z", "2026-09-30T07:00:00Z", "2026-10-05T07:00:00Z"]) await call("POST", "/body", { kind: "weight", value: 80, measuredAt: at });
    expect((await ach()).weighins.value).toBe(2);
  });

  it("counts a program once its routines are done in order", async () => {
    const r1 = (await call("POST", "/routines", { name: "P1", exercises: [{ exerciseId: bench, sets: [{ reps: 5 }] }] })).id;
    const r2 = (await call("POST", "/routines", { name: "P2", exercises: [{ exerciseId: bench, sets: [{ reps: 5 }] }] })).id;
    await call("POST", "/programs", { name: "Two days", weeks: [{ days: [r1, r2] }], startDate: "2026-10-01" });
    expect((await ach()).programs).toBeUndefined();
    await call("POST", "/workouts/log", { startedAt: "2026-10-05T08:00:00Z", routineId: r2 }); // out of order: doesn't move it on
    await call("POST", "/workouts/log", { startedAt: "2026-10-06T09:00:00Z", routineId: r1 });
    await call("POST", "/workouts/log", { startedAt: "2026-10-06T18:00:00Z", routineId: r2 });
    const a = await ach();
    expect(a.programs.value).toBe(1);
    expect(a.programs.steps[0]).toMatchObject({ name: "First program finished", reachedAt: "2026-10-06T18:00:00.000Z" });
  });
});

describe("home on the app's calendar", () => {
  it("knows today and yesterday from the app's time zone, whatever the process's is", async () => {
    // 23:30 UTC on 7 Oct is 01:30 on 8 Oct for the app
    NOW = new Date("2026-10-07T23:30:00Z");
    const r = (await call("POST", "/routines", { name: "Today's", exercises: [{ exerciseId: bench, sets: [{ reps: 5 }] }] })).id;
    await call("POST", "/schedules", { routineId: r, rule: "once", startDate: "2026-10-08" });
    await call("POST", "/schedules", { routineId: r, rule: "once", startDate: "2026-10-07" });
    const home = await call("GET", "/home", undefined, { tz: TZ });
    expect(home.upNext.map((p: any) => p.date)).toEqual(["2026-10-08"]);
    NOW = new Date("2026-10-07T10:00:00Z");
  });

  it("lists every plan for today, of every rule, and drops only the ones done", async () => {
    NOW = new Date("2026-10-20T10:00:00Z"); // a Tuesday
    const a = (await call("POST", "/routines", { name: "Many A", exercises: [{ exerciseId: bench, sets: [{ reps: 5 }] }] })).id;
    const b = (await call("POST", "/routines", { name: "Many B", exercises: [{ exerciseId: bench, sets: [{ reps: 5 }] }] })).id;
    const ids = [
      (await call("POST", "/schedules", { routineId: a, rule: "once", startDate: "2026-10-20", timeOfDay: "07:00" })).id,
      (await call("POST", "/schedules", { routineId: b, rule: "weekly", days: [2], startDate: "2026-10-01" })).id,
      (await call("POST", "/schedules", { activityType: "walk", rule: "interval", intervalDays: 1, startDate: "2026-10-19" })).id,
    ];
    for (let i = 0; i < 3; i++) ids.push((await call("POST", "/schedules", { activityType: "run", rule: "once", startDate: "2026-10-20" })).id);
    const todays = async () => (await call("GET", "/home", undefined, { tz: TZ })).upNext.filter((p: any) => p.date === "2026-10-20").map((p: any) => p.name);
    // more than five plans for today alone: all of them are there, the timed one first
    expect(await todays()).toEqual(["Many A", "Many B", "Walk", "Run", "Run", "Run"]);
    // doing one leaves the others
    await call("POST", "/workouts/log", { startedAt: "2026-10-20T08:00:00Z", routineId: b });
    expect(await todays()).toEqual(["Many A", "Walk", "Run", "Run", "Run"]);
    // the count of today's plans keeps the done one, so Today can say "Nothing else planned" once all are done
    expect((await call("GET", "/home", undefined, { tz: TZ })).plannedToday).toBe(6);
    for (const sid of ids) await call("DELETE", `/schedules/${sid}`);
    NOW = new Date("2026-10-07T10:00:00Z");
  });

  it("counts this week's muscles from local midnight 6 days back on the app's calendar", async () => {
    // 10:00 UTC on Tue 15 Dec is 12:00 for the app, so the week is 9-15 Dec and starts at 22:00 UTC on 8 Dec.
    // With no time zone both workouts below would fall on 8 Dec and neither would count
    NOW = new Date("2026-12-15T10:00:00Z");
    const quads = (await call("POST", "/exercises", { name: "Test squat", tracking: "weight_reps", primaryMuscles: ["quadriceps"] })).id;
    const hams = (await call("POST", "/exercises", { name: "Test curl", tracking: "weight_reps", primaryMuscles: ["hamstrings"] })).id;
    await log("2026-12-08T21:30:00Z", [{ exerciseId: quads, sets: [{ weightKg: 100, reps: 5 }] }]); // 23:30 on 8 Dec: last week
    await log("2026-12-08T22:30:00Z", [{ exerciseId: hams, sets: [{ weightKg: 40, reps: 10 }, { weightKg: 40, reps: 10 }] }]); // 00:30 on 9 Dec
    const home = await call("GET", "/home", undefined, { tz: TZ });
    expect(home.main7).toEqual(["hamstrings"]);
    expect(home.muscles7).toEqual({ hamstrings: 2 });
    expect(home.helpers7).toEqual([]);
    // the app's own day too: the later workout is on 9 Dec, not 8 Dec
    expect(home.days).toContain("2026-12-09");
    NOW = new Date("2026-10-07T10:00:00Z");
  });
});
