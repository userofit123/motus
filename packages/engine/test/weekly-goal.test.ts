// The weekly target as a goal: people who used the old fixed number get one (taking it), new people start with none, it can be deleted for good, every
// weekly goal keeps its own streak, "sessions" counts gym workouts, activities or both, and a goal's page lists what went in.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";

let eng: Engine, U: string;
let NOW = new Date("2026-10-07T10:00:00Z"); // a Wednesday
const call = async (method: string, path: string, body?: unknown, query: Record<string, string> = { tz: "0" }) => {
  const r = await eng.handle({ method, path, body, query, userId: U });
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const workout = (day: string) => call("POST", "/workouts/log", { startedAt: `${day}T08:00:00Z`, durationS: 1800, exercises: [], name: "Gym" });
const walk = (day: string) => call("POST", "/activities", { type: "walk", startedAt: `${day}T18:00:00Z`, durationS: 1200, distanceM: 2000 });

beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"), { mode: "server", now: () => NOW });
  U = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'wk','Wk')", [U]);
  await call("PUT", "/settings", { weeklyGoal: 2, firstDay: 1 });
}, 120000);

describe("starting goals", () => {
  it("gives a brand-new person no goals, and not later either once they log workouts", async () => {
    const N = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'fresh','Fresh')", [N]);
    const as = async (method: string, path: string, body?: unknown) => (await eng.handle({ method, path, body, query: { tz: "0" }, userId: N })).body as any;
    expect(await as("GET", "/goals")).toEqual([]);
    expect((await as("GET", "/me")).settings.home.goals).toEqual([]);
    await as("POST", "/workouts/log", { startedAt: "2026-10-06T08:00:00Z", durationS: 1800, exercises: [], name: "Gym" });
    expect(await as("GET", "/goals")).toEqual([]);
  });

  it("migrates someone with workout history to the Weekly target", async () => {
    const O = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'old','Old')", [O]);
    const as = async (method: string, path: string, body?: unknown) => (await eng.handle({ method, path, body, query: { tz: "0" }, userId: O })).body as any;
    await as("POST", "/workouts/log", { startedAt: "2026-10-06T08:00:00Z", durationS: 1800, exercises: [], name: "Gym" });
    const goals = await as("GET", "/goals");
    expect(goals.map((g: any) => g.title)).toEqual(["Weekly target"]);
  });

  it("gives someone with only activities logged a Weekly target that counts them", async () => {
    const A = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'walker','Walker')", [A]);
    const as = async (method: string, path: string, body?: unknown) => (await eng.handle({ method, path, body, query: { tz: "0" }, userId: A })).body as any;
    await as("POST", "/activities", { type: "walk", startedAt: "2026-10-06T18:00:00Z", durationS: 1200 });
    const [wt] = await as("GET", "/goals");
    expect(wt).toMatchObject({ title: "Weekly target", metric: "sessions", scopeId: null });
    expect(wt.progress.current).toBe(1);
  });
});

describe("weekly goal", () => {
  it("gives someone who set the old number a Weekly target goal from it, first on Home with its streak", async () => {
    const goals = await call("GET", "/goals");
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ title: "Weekly target", metric: "sessions", scopeId: "workout", target: 2, period: "week" });
    const me = await call("GET", "/me");
    expect(me.settings.home.goals).toEqual([{ id: goals[0].id, streak: true }]);
    // asking again doesn't add another
    expect(await call("GET", "/goals")).toHaveLength(1);
  });

  it("keeps a streak per weekly goal and counts what the goal says", async () => {
    // two workouts in each of the last two weeks and one this week; walks only this week
    for (const d of ["2026-09-22", "2026-09-24", "2026-09-29", "2026-10-01", "2026-10-06"]) await workout(d);
    await walk("2026-10-06"); await walk("2026-10-07");
    const [wt] = await call("GET", "/goals");
    expect(wt.progress.current).toBe(1);
    expect(wt.progress.streak).toBe(2); // this week isn't reached yet, so the run ending last week stands
    const home = await call("GET", "/home");
    expect(home.homeGoals[0]).toMatchObject({ id: wt.id, showStreak: true });
    expect(home.streak).toBe(2);
    // everything counts: workouts and walks
    const any = await call("POST", "/goals", { metric: "sessions", scopeId: null, target: 3, period: "week" });
    const walks = await call("POST", "/goals", { metric: "sessions", scopeId: "walk", target: 2, period: "week" });
    const all = await call("GET", "/goals");
    expect(all.find((g: any) => g.id === any.id).progress).toMatchObject({ current: 3, done: true, streak: 1 });
    expect(all.find((g: any) => g.id === walks.id).progress).toMatchObject({ current: 2, done: true, streak: 1 });
  });

  it("shows a goal in full: streak, best run, recent weeks and what went in", async () => {
    const [wt] = (await call("GET", "/goals")).filter((g: any) => g.title === "Weekly target");
    const d = await call("GET", `/goals/${wt.id}/detail`);
    expect(d.streak).toBe(2);
    expect(d.best).toBe(2);
    expect(d.periods).toHaveLength(12);
    expect(d.periods.at(-1)).toMatchObject({ from: "2026-10-05", value: 1, met: false });
    expect(d.periods.at(-2)).toMatchObject({ from: "2026-09-28", value: 2, met: true });
    expect(d.log.map((x: any) => x.kind)).toEqual(["workout"]);
  });

  it("lets the starter goal go for good", async () => {
    const [wt] = (await call("GET", "/goals")).filter((g: any) => g.title === "Weekly target");
    await call("DELETE", `/goals/${wt.id}`);
    expect((await call("GET", "/goals")).some((g: any) => g.title === "Weekly target")).toBe(false);
    expect((await call("GET", "/home")).homeGoals.some((g: any) => g.id === wt.id)).toBe(false);
  });

  it("has no fixed weekly target behind it: the streak follows the weekly goals there are, and none means no streak", async () => {
    // the oldest weekly sessions goal left, "everything 3 a week", is reached this week only
    expect((await call("GET", "/home")).streak).toBe(1);
    for (const g of (await call("GET", "/goals")).filter((x: any) => x.period === "week")) await call("PUT", `/goals/${g.id}`, { status: "archived" });
    expect((await call("GET", "/home")).streak).toBe(0);
    expect((await call("GET", "/achievements")).find((a: any) => a.id === "streak").value).toBe(0);
  });

  it("counts a week as reached with a fractional target once the sessions pass it", async () => {
    // 3 sessions this week (a workout and two walks) against a target of 2.5
    const g = await call("POST", "/goals", { metric: "sessions", scopeId: null, target: 2.5, period: "week" });
    expect((await call("GET", "/goals")).find((x: any) => x.id === g.id).progress).toMatchObject({ done: true, streak: 1 });
    expect((await call("GET", "/home")).streak).toBe(1);
  });
});
