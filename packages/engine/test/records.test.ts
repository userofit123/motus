// Records in a workout (assisted: less help is better; push-ups and reps-only get "most reps"), volume without
// assisted help everywhere it is shown, and goal weeks, months and streaks on the app's calendar, not the process's.
import { describe, it, expect, beforeAll } from "vitest";
import { liftedKg, setVolume } from "@motus/shared";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";

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

describe("goals on the app's calendar", () => {
  it("puts a late-Sunday-UTC workout in the week the app is in", async () => {
    NOW = new Date("2026-10-05T10:00:00Z");
    const { call, log } = await user();
    await call("PUT", "/settings", { firstDay: 1, weeklyGoal: 2 });
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
    await call("PUT", "/settings", { firstDay: 1, weeklyGoal: 2 });
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
});
