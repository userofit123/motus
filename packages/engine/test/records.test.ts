// Records in a workout (assisted: less help is better; push-ups and reps-only get "most reps"), volume without
// assisted help everywhere it is shown, and goal weeks, months and streaks on the app's calendar, not the process's.
import { describe, it, expect, beforeAll } from "vitest";
import { liftedKg, setVolume } from "@motus/shared";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import { exerciseSessions } from "../src/modules/library";
import { flagRecords } from "../src/modules/workouts";

let eng: Engine;
let NOW = new Date("2026-10-05T10:00:00Z"); // a Monday
const AHEAD = "-120"; // an app two hours ahead of UTC
const BEHIND = "300"; // an app five hours behind UTC

const user = async () => {
  const U = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username) VALUES ($1, $2)", [U, `u${U.slice(-8)}`]);
  const call = async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
    const r = await eng.handle({ method, path, body, query, userId: U });
    if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body as any;
  };
  const log = (startedAt: string, exercises: { exerciseId: string; sets: any[] }[] = []) => call("POST", "/workouts/log", { startedAt, durationS: 3600, exercises });
  const exercise = async (name: string, tracking: string) => (await call("POST", "/exercises", { name, tracking, primaryMuscles: ["lats"] })).id as string;
  return { call, log, exercise };
};
/** The record kinds on each done set of a workout, in order. */
const prsOf = (w: any) => w.exercises.flatMap((e: any) => e.sets.map((s: any) => s.pr));

beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"), { mode: "server", now: () => NOW });
}, 120000);

describe("liftedKg", () => {
  it("counts weight × reps, but not assisted help, missing or negative weight, or warm-ups", () => {
    expect(liftedKg(60, 8)).toBe(480);
    expect(liftedKg("60", 8, "weight_reps")).toBe(480);
    expect(liftedKg(20, 10, "bodyweight_reps")).toBe(200);
    expect(liftedKg(30, 8, "assisted")).toBe(0);
    expect(liftedKg(null, 12, "bodyweight_reps")).toBe(0);
    expect(liftedKg(-10, 8)).toBe(0);
    expect(setVolume({ kind: "warmup", weightKg: 40, reps: 10 })).toBe(0);
    expect(setVolume({ kind: "normal", weightKg: 30, reps: 8 }, "assisted")).toBe(0);
  });
});

describe("records in a workout", () => {
  it("assisted: more help is no record, less help is a weight record, more reps at the same help a reps record", async () => {
    const { call, log, exercise } = await user();
    const ex = await exercise("Test assisted pull-up", "assisted");
    await log("2026-09-01T08:00:00Z", [{ exerciseId: ex, sets: [{ weightKg: 30, reps: 8 }] }]);
    const more = await log("2026-09-02T08:00:00Z", [{ exerciseId: ex, sets: [{ weightKg: 40, reps: 8 }] }]);
    expect(prsOf(await call("GET", `/workouts/${more.id}`))).toEqual([[]]);
    const less = await log("2026-09-03T08:00:00Z", [{ exerciseId: ex, sets: [{ weightKg: 20, reps: 6 }, { weightKg: 20, reps: 6 }] }]);
    // flagged once: the second set only matches the first
    expect(prsOf(await call("GET", `/workouts/${less.id}`))).toEqual([["weight"], []]);
    const reps = await log("2026-09-04T08:00:00Z", [{ exerciseId: ex, sets: [{ weightKg: 20, reps: 7 }, { weightKg: 40, reps: 8 }] }]);
    // 7 at 20 kg of help beats 6; 8 at 40 kg of help only matches 8 at 30 kg (less help)
    expect(prsOf(await call("GET", `/workouts/${reps.id}`))).toEqual([["reps"], []]);
  });

  it("push-ups and reps-only exercises get a most-reps record", async () => {
    const { call, log, exercise } = await user();
    const push = await exercise("Test push-up", "bodyweight_reps");
    const crunch = await exercise("Test crunch", "reps_only");
    await log("2026-09-01T08:00:00Z", [{ exerciseId: push, sets: [{ reps: 10 }] }, { exerciseId: crunch, sets: [{ reps: 20 }] }]);
    const w = await log("2026-09-02T08:00:00Z", [
      { exerciseId: push, sets: [{ reps: 12 }, { reps: 12 }, { reps: 9 }] },
      { exerciseId: crunch, sets: [{ reps: 15 }, { reps: 25 }] },
    ]);
    expect(prsOf(await call("GET", `/workouts/${w.id}`))).toEqual([["reps"], [], [], [], ["reps"]]);
  });

  it("weights still give weight, 1RM, volume and reps records", async () => {
    const { call, log, exercise } = await user();
    const ex = await exercise("Test row", "weight_reps");
    await log("2026-09-01T08:00:00Z", [{ exerciseId: ex, sets: [{ weightKg: 60, reps: 8 }] }]);
    const w = await log("2026-09-02T08:00:00Z", [{ exerciseId: ex, sets: [{ weightKg: 62.5, reps: 8 }, { weightKg: 50, reps: 12 }] }]);
    expect(prsOf(await call("GET", `/workouts/${w.id}`))).toEqual([["weight", "e1rm", "volume"], ["volume", "reps"]]);
  });

  // The workout's records and "Previous" come from one query each for all its exercises; they must match what a read of
  // each exercise's whole history gives (how they were worked out before), on a mixed history
  it("one query for all exercises gives the same records and Previous as reading each exercise's history", async () => {
    const { call, log, exercise } = await user();
    const exs = [await exercise("Test mix squat", "weight_reps"), await exercise("Test mix assisted dip", "assisted"),
      await exercise("Test mix push-up", "bodyweight_reps"), await exercise("Test mix plank", "duration")];
    const routine = (await call("POST", "/routines", { name: "Test mix day", exercises: exs.map((e) => ({ exerciseId: e, sets: [{ reps: 5 }] })) })).id;
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 16807) % 2147483647; return seed % n; };
    const setsFor = (i: number) => Array.from({ length: 1 + rnd(4) }, () => ({
      kind: rnd(5) === 0 ? "warmup" : "normal", weightKg: i === 2 && rnd(2) ? null : 10 + rnd(8) * 2.5, reps: i === 3 ? null : 3 + rnd(8), durationS: i === 3 ? 20 + rnd(6) * 10 : null }));
    const logged: string[] = [];
    for (let d = 0; d < 30; d++) {
      // some days skip an exercise, do it twice, or only warm up
      const items = exs.flatMap((e, i) => (rnd(4) === 0 ? [] : rnd(6) === 0 ? [{ exerciseId: e, sets: setsFor(i) }, { exerciseId: e, sets: setsFor(i) }]
        : [{ exerciseId: e, sets: rnd(8) === 0 ? [{ kind: "warmup", weightKg: 10, reps: 5 }] : setsFor(i) }]));
      logged.push((await call("POST", "/workouts/log", { startedAt: new Date(Date.UTC(2026, 6, 1 + d, 8)).toISOString(), durationS: 3600, routineId: rnd(2) ? routine : undefined, exercises: items })).id);
    }
    const running = (await call("POST", "/workouts/start", { routineId: routine })).id;
    const live = await call("GET", "/workouts/active");
    for (const [i, e] of live.exercises.entries()) for (const st of e.sets) await call("PUT", `/workout-sets/${st.id}`, { ...setsFor(i), kind: "normal", weightKg: 30, reps: 12, durationS: i === 3 ? 90 : null, done: true });
    const q = eng.db.admin;
    for (const wid of [...logged, running]) {
      const w = await call("GET", `/workouts/${wid}`);
      const want = new Map<string, string[]>();
      for (const we of w.exercises) {
        const before = (await exerciseSessions(q, we.exerciseId, 500)).filter((x) => new Date(x.startedAt) < new Date(w.startedAt) && x.workoutId !== w.id);
        if (before.length) flagRecords(we.exercise?.tracking, before.flatMap((x) => x.sets).filter((x: any) => x.kind !== "warmup"), we.sets, want);
      }
      expect(w.exercises.map((e: any) => e.sets.map((x: any) => x.pr))).toEqual(w.exercises.map((e: any) => e.sets.map((x: any) => want.get(x.id) ?? [])));
    }
    const w = await call("GET", "/workouts/active");
    for (const we of w.exercises) {
      const hist = await exerciseSessions(q, we.exerciseId, 10, routine);
      const all = (hist.length ? hist : await exerciseSessions(q, we.exerciseId, 10)).filter((h) => h.workoutId !== w.id && new Date(h.startedAt) < new Date(w.startedAt));
      // done twice that day: the first time
      const prev = (all.filter((h) => h.workoutId === all[0]?.workoutId).sort((a, b) => a.position - b.position)[0]?.sets ?? [])
        .filter((x: any) => x.kind !== "warmup").map((x: any) => ({ weightKg: x.weightKg, reps: x.reps, durationS: x.durationS, distanceM: x.distanceM }));
      expect(we.last).toEqual(prev);
    }
    expect(w.exercises.flatMap((e: any) => e.sets.map((x: any) => x.pr)).some((x: string[]) => x.length)).toBe(true);
  });
});

describe("volume leaves out assisted help", () => {
  it("in the workout report, workout lists, stats, home, routine history and goals", async () => {
    NOW = new Date("2026-10-07T10:00:00Z");
    const { call, log, exercise } = await user();
    const bench = await exercise("Test bench", "weight_reps");
    const assist = await exercise("Test assisted dip", "assisted");
    const routine = (await call("POST", "/routines", { name: "Upper", exercises: [{ exerciseId: bench }, { exerciseId: assist }] })).id;
    const sets = [{ exerciseId: bench, sets: [{ weightKg: 60, reps: 8 }, { kind: "warmup", weightKg: 40, reps: 10 }] }, { exerciseId: assist, sets: [{ weightKg: 30, reps: 8 }] }];
    await call("POST", "/workouts/log", { startedAt: "2026-10-01T08:00:00Z", durationS: 3600, routineId: routine, exercises: sets });
    const w = await call("POST", "/workouts/log", { startedAt: "2026-10-06T08:00:00Z", durationS: 3600, routineId: routine, exercises: sets });
    const d = await call("GET", `/workouts/${w.id}`);
    expect(d.report.totals.volumeKg).toBe(480);
    expect(d.report.previous.volumeKg).toBe(480);
    expect(d.report.perExercise.find((p: any) => p.exerciseId === assist).now).toMatchObject({ volumeKg: 0, e1rm: null });
    expect((await call("GET", "/workouts")).map((x: any) => x.volumeKg)).toEqual([480, 480]);
    const stats = await call("GET", "/stats");
    expect(stats.workouts.map((x: any) => x.volumeKg)).toEqual([480, 480]);
    expect(stats.exercises.find((x: any) => x.exerciseId === assist).volumeKg).toBe(0);
    expect(stats.exercises.find((x: any) => x.exerciseId === bench).volumeKg).toBe(960);
    const home = await call("GET", "/home", undefined, { tz: "0" });
    expect(home.thisWeek.volumeKg).toBe(480);
    expect((await call("GET", `/routines/${routine}/workouts`)).map((x: any) => Number(x.volumeKg))).toEqual([480, 480]);
    const hist = await call("GET", `/exercises/${assist}/history`);
    expect(hist.records?.setVolume).toBeUndefined();
    const g1 = await call("POST", "/goals", { metric: "volume", target: 1000, period: "month" });
    const g2 = await call("POST", "/goals", { metric: "routine_volume", scopeId: routine, target: 1000, startDate: "2026-10-01" });
    expect((await call("GET", `/goals/${g1.id}`, undefined, { tz: "0" })).progress.current).toBe(960);
    expect((await call("GET", `/goals/${g2.id}`, undefined, { tz: "0" })).progress.current).toBe(480);
  });
});

describe("records in stats", () => {
  it("lists every record in the range only when asked, as Reports counts them per month", async () => {
    const { call, log, exercise } = await user();
    const ex = await exercise("Test row", "weight_reps");
    await log("2026-08-01T08:00:00Z", [{ exerciseId: ex, sets: [{ weightKg: 50, reps: 8 }] }]);
    await log("2026-08-20T08:00:00Z", [{ exerciseId: ex, sets: [{ weightKg: 55, reps: 8 }] }]);
    await log("2026-09-10T08:00:00Z", [{ exerciseId: ex, sets: [{ weightKg: 50, reps: 8 }] }]);
    await log("2026-09-20T08:00:00Z", [{ exerciseId: ex, sets: [{ weightKg: 60, reps: 8 }] }]);
    expect((await call("GET", "/stats")).records).toEqual([]);
    const recs = (await call("GET", "/stats", undefined, { records: "1" })).records;
    // the first session is no record and the third only matches the second
    expect(recs.map((r: any) => [r.at.slice(0, 10), r.name, r.weightKg])).toEqual([["2026-09-20", "Test row", 60], ["2026-08-20", "Test row", 55]]);
    expect((await call("GET", "/stats", undefined, { records: "1", from: "2026-09-01T00:00:00Z" })).records).toHaveLength(1);
  });
});

describe("goals on the app's calendar", () => {
  it("puts a late-Sunday-UTC workout in the week the app is in", async () => {
    NOW = new Date("2026-10-05T10:00:00Z");
    const { call, log } = await user();
    await call("PUT", "/settings", { firstDay: 1 });
    const g = await call("POST", "/goals", { metric: "workouts", target: 3, period: "week" });
    await log("2026-10-04T22:30:00Z"); // Monday 00:30 for an app two hours ahead; still Sunday in UTC
    await log("2026-10-05T03:00:00Z"); // Sunday 22:00 for an app five hours behind
    const ahead = (await call("GET", `/goals/${g.id}`, undefined, { tz: AHEAD })).progress;
    expect(ahead.current).toBe(2);
    expect(ahead.history.at(-1)).toEqual({ date: "2026-10-05", value: 2 });
    expect(ahead.history.at(-2)).toEqual({ date: "2026-09-28", value: 0 });
    const behind = (await call("GET", `/goals/${g.id}`, undefined, { tz: BEHIND })).progress;
    expect(behind.current).toBe(0);
    expect(behind.history.at(-2)).toEqual({ date: "2026-09-28", value: 2 });
    expect((await call("GET", `/goals/${g.id}`, undefined, { tz: "0" })).progress.current).toBe(1);
    // /home passes its offset to the goals it shows
    expect((await call("GET", "/home", undefined, { tz: AHEAD })).goals[0].progress.current).toBe(2);
  });

  it("counts weeks in a row on the app's calendar for the streak goal", async () => {
    NOW = new Date("2026-10-05T10:00:00Z");
    const { call, log } = await user();
    await call("PUT", "/settings", { firstDay: 1 });
    await call("POST", "/goals", { metric: "sessions", scopeId: "workout", target: 2, period: "week" }); // the weekly goal the streak follows
    const g = await call("POST", "/goals", { metric: "streak_weeks", target: 4 });
    await log("2026-10-04T22:30:00Z");
    await log("2026-10-05T08:00:00Z");
    // ahead: both are on Monday 5 Oct, so this week has met the target; in UTC the two weeks have one each
    expect((await call("GET", `/goals/${g.id}`, undefined, { tz: AHEAD })).progress.current).toBe(1);
    expect((await call("GET", `/goals/${g.id}`, undefined, { tz: "0" })).progress.current).toBe(0);
  });

  it("starts the month on the app's calendar", async () => {
    NOW = new Date("2026-10-31T23:30:00Z"); // 1 November for an app two hours ahead
    const { call, log } = await user();
    const g = await call("POST", "/goals", { metric: "workouts", target: 10, period: "month" });
    await log("2026-10-31T22:30:00Z"); // 1 November, 00:30 for the app
    await log("2026-10-31T20:00:00Z"); // 31 October, 22:00 for the app
    const ahead = (await call("GET", `/goals/${g.id}`, undefined, { tz: AHEAD })).progress;
    expect(ahead.current).toBe(1);
    expect(ahead.history.slice(-2)).toEqual([{ date: "2026-10-01", value: 1 }, { date: "2026-11-01", value: 1 }]);
    expect((await call("GET", `/goals/${g.id}`, undefined, { tz: "0" })).progress.current).toBe(2);
  });

  it("averages steps over the app's days and counts a deadline's days on its calendar", async () => {
    NOW = new Date("2026-10-04T23:30:00Z"); // Monday 5 Oct, 01:30 for the app; still Sunday in UTC
    const { call } = await user();
    await call("PUT", "/settings", { firstDay: 1 });
    await call("PUT", "/daily", { entries: [{ date: "2026-10-04", kind: "steps", value: 4000 }, { date: "2026-10-05", kind: "steps", value: 6000 }] });
    const steps = await call("POST", "/goals", { metric: "steps_avg", target: 8000, period: "week" });
    expect((await call("GET", `/goals/${steps.id}`, undefined, { tz: AHEAD })).progress.current).toBe(6000);
    expect((await call("GET", `/goals/${steps.id}`, undefined, { tz: "0" })).progress.current).toBe(4000);
    const g = await call("POST", "/goals", { metric: "workouts", target: 3, period: "once", deadline: "2026-10-06" }, { tz: AHEAD });
    const p = await call("GET", `/goals/${g.id}`, undefined, { tz: AHEAD });
    expect(p.startDate).toContain("2026-10-05"); // today on the app's calendar, not in UTC
    expect(p.progress.pace).toBe("2 days left"); // 5 and 6 October
  });

  it("counts daily goals on their own days: every day, workdays, chosen days", async () => {
    NOW = new Date("2026-10-07T12:00:00Z"); // Wednesday 7 October
    const { call } = await user();
    await call("PUT", "/settings", { firstDay: 1 }); // Monday first: workdays are Monday to Friday
    await call("PUT", "/daily", { entries: [["2026-10-03", 9000], ["2026-10-05", 9000], ["2026-10-06", 9000], ["2026-10-07", 3000]].map(([date, value]) => ({ date, kind: "steps", value })) });
    const every = await call("POST", "/goals", { metric: "steps_avg", target: 8000, period: "day" }, { tz: "0" });
    const e = (await call("GET", `/goals/${every.id}`, undefined, { tz: "0" })).progress;
    expect(e.current).toBe(3000); // today
    expect(e.pace).toBe("5000 more today");
    expect(e.streak).toBe(2); // Monday and Tuesday; Sunday the 4th has nothing
    const work = await call("POST", "/goals", { metric: "steps_avg", target: 8000, period: "day", days: "workdays" }, { tz: "0" });
    expect((await call("GET", `/goals/${work.id}`, undefined, { tz: "0" })).progress.history.slice(-3).map((h: any) => h.date)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
    // Saturdays only: on a Wednesday it shows last Saturday, with nothing due today
    const sat = await call("POST", "/goals", { metric: "steps_avg", target: 8000, period: "day", days: [6] }, { tz: "0" });
    const p = (await call("GET", `/goals/${sat.id}`, undefined, { tz: "0" })).progress;
    expect(p.current).toBe(9000);
    expect(p.done).toBe(true);
    expect((await call("GET", `/goals/${sat.id}`, undefined, { tz: "0" })).days).toEqual([6]);
  });

  it("starts weeks on the day chosen in Settings: Sunday or Monday", async () => {
    NOW = new Date("2026-10-07T12:00:00Z"); // Wednesday 7 October
    const { call, log } = await user();
    await log("2026-10-04T10:00:00Z"); // Sunday
    await log("2026-10-05T10:00:00Z"); // Monday
    const g = await call("POST", "/goals", { metric: "workouts", target: 3, period: "week" }, { tz: "0" });
    await call("PUT", "/settings", { firstDay: 1 });
    expect((await call("GET", `/goals/${g.id}`, undefined, { tz: "0" })).progress.current).toBe(1);
    let home = await call("GET", "/home", undefined, { tz: "0" });
    expect(home.thisWeek).toMatchObject({ start: "2026-10-05T00:00:00.000Z", workouts: 1 });
    expect(home.lastWeek.workouts).toBe(1);
    await call("PUT", "/settings", { firstDay: 0 });
    expect((await call("GET", `/goals/${g.id}`, undefined, { tz: "0" })).progress.current).toBe(2);
    home = await call("GET", "/home", undefined, { tz: "0" });
    expect(home.thisWeek).toMatchObject({ start: "2026-10-04T00:00:00.000Z", workouts: 2 });
    expect(home.lastWeek.workouts).toBe(0);
  });

  it("counts a recorded walk's steps toward the day until a count is typed in, which replaces them, never both", async () => {
    NOW = new Date("2026-10-07T22:30:00Z"); // Thursday 8 October, 00:30 for the app; still Wednesday in UTC
    const { call } = await user();
    const day = await call("POST", "/goals", { metric: "steps_avg", target: 8000, period: "day" }, { tz: AHEAD });
    const steps = async () => (await call("GET", "/daily", undefined, { from: "2026-10-01", tz: AHEAD })).filter((x: any) => x.kind === "steps");
    const current = async () => (await call("GET", `/goals/${day.id}`, undefined, { tz: AHEAD })).progress.current;
    // a walk just after midnight for the app belongs to the 8th; nothing typed in that day
    await call("POST", "/activities", { type: "walk", startedAt: "2026-10-07T22:05:00Z", durationS: 1200, steps: 1500 });
    await call("POST", "/activities", { type: "walk", startedAt: "2026-10-07T22:20:00Z", durationS: 300, steps: 500 });
    expect(await current()).toBe(2000);
    expect(await steps()).toMatchObject([{ date: "2026-10-08", value: 2000, source: "activities", logged: null, walked: 2000 }]);
    // the day's final count typed in is the day's, even below the walks: it replaces them, not added, not ignored
    await call("PUT", "/daily", { date: "2026-10-08", kind: "steps", value: 1200 });
    expect(await steps()).toMatchObject([{ date: "2026-10-08", value: 1200, source: "manual", logged: 1200, walked: 2000 }]);
    expect(await current()).toBe(1200);
    // a higher count already holds the walks: 6000, not 2000 on top
    await call("PUT", "/daily", { date: "2026-10-08", kind: "steps", value: 6000 });
    expect(await current()).toBe(6000);
    const log = (await call("GET", `/goals/${day.id}/detail`, undefined, { tz: AHEAD })).log;
    expect(log).toMatchObject([{ kind: "day", at: "2026-10-08", value: 6000 }]);
    // clearing the box hands the day back to the walks
    await call("PUT", "/daily", { date: "2026-10-08", kind: "steps", value: null });
    expect(await steps()).toMatchObject([{ date: "2026-10-08", value: 2000, source: "activities", walked: 2000 }]);
    expect(await current()).toBe(2000);
  });

  it("takes the larger of a phone's daily count and the recorded walks, as the phone may lag behind a walk", async () => {
    NOW = new Date("2026-10-08T20:00:00Z");
    const { call } = await user();
    await call("POST", "/activities", { type: "walk", startedAt: "2026-10-08T10:00:00Z", durationS: 1200, steps: 2000 });
    const steps = async () => (await call("GET", "/daily", undefined, { from: "2026-10-01", tz: "0" })).filter((x: any) => x.kind === "steps");
    await call("PUT", "/daily", { date: "2026-10-08", kind: "steps", value: 1200, source: "phone" });
    expect(await steps()).toMatchObject([{ date: "2026-10-08", value: 2000, source: "activities", logged: 1200 }]);
    await call("PUT", "/daily", { date: "2026-10-08", kind: "steps", value: 7000, source: "phone" });
    expect(await steps()).toMatchObject([{ date: "2026-10-08", value: 7000, source: "phone", logged: 7000 }]);
  });
});

describe("Home's records and training days", () => {
  it("lists the last 30 days' records only while the Records block is on, and the days with training", async () => {
    const { call, log, exercise } = await user();
    const ex = await exercise("Test home row", "weight_reps");
    await log("2026-09-20T08:00:00Z", [{ exerciseId: ex, sets: [{ weightKg: 50, reps: 8 }] }]);
    await log("2026-10-01T08:00:00Z", [{ exerciseId: ex, sets: [{ weightKg: 60, reps: 8 }] }]);
    await call("POST", "/activities", { type: "walk", startedAt: "2026-10-03T18:00:00Z", durationS: 1200, distanceM: 2000 });
    const off = await call("GET", "/home", undefined, { tz: "0" });
    expect(off.records).toEqual([]);
    expect(off.days).toEqual(expect.arrayContaining(["2026-09-20", "2026-10-01", "2026-10-03"]));
    const blocks = (await call("GET", "/me")).settings.home.blocks.map((b: any) => (b.id === "records" ? { ...b, on: true } : b));
    await call("PUT", "/settings", { home: { blocks } });
    const on = await call("GET", "/home", undefined, { tz: "0" });
    expect(on.records).toHaveLength(1);
    expect(on.records[0]).toMatchObject({ exerciseId: ex, name: "Test home row", weightKg: 60, reps: 8 });
    expect(on.records[0].kinds).toContain("weight");
    // a first time is not a record; a later better session is, newest first, and warm-ups don't count
    const ex2 = await exercise("Test home curl", "weight_reps");
    await log("2026-10-02T08:00:00Z", [{ exerciseId: ex2, sets: [{ weightKg: 10, reps: 10 }] }]);
    expect((await call("GET", "/home", undefined, { tz: "0" })).records).toHaveLength(1);
    await log("2026-10-04T08:00:00Z", [{ exerciseId: ex2, sets: [{ kind: "warmup", weightKg: 30, reps: 5 }, { weightKg: 10, reps: 12 }] }]);
    const two = (await call("GET", "/home", undefined, { tz: "0" })).records;
    expect(two.map((r: any) => r.name)).toEqual(["Test home curl", "Test home row"]);
    expect(two[0]).toMatchObject({ weightKg: 10, reps: 12 });
    expect(two[0].kinds).toEqual(expect.arrayContaining(["reps", "volume"]));
    expect(two[0].kinds).not.toContain("weight");
  });
});

describe("records follow what the exercise tracks", () => {
  it("a weight left on a set of an exercise that tracks none is no weight, 1RM or volume record", () => {
    const set = (id: string, weightKg: number | null, reps: number) => ({ id, kind: "normal", done: true, weightKg, reps, durationS: null, distanceM: null });
    const out = new Map<string, string[]>();
    flagRecords("reps_only", [set("a", null, 10)], [set("b", 100, 12)], out);
    expect(out.get("b")).toEqual(["reps"]);
    const timed = new Map<string, string[]>();
    flagRecords("reps_duration", [{ ...set("a", null, 10), durationS: 60 }], [{ ...set("b", 20, 15), durationS: 60 }], timed);
    expect(timed.get("b")).toEqual(["reps"]);
  });
});
