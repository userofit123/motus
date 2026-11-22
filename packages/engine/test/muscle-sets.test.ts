// M-295: a left set and a right set of one exercise are one set for its muscles, in Stats → Muscles, the workout's report
// the Strength score's sets, a goal for a muscle's working sets and Home's suggestions alike (muscleSetCount and MUSCLE_SETS_SQL), so a one-arm curl done on each side 3 times
// gives the biceps 3 sets, not 6. Warm-ups stay out.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import { setsByMuscle } from "../src/modules/suggest";
import { weekIn } from "../src/modules/achievements";

let eng: Engine, U: string, curl = "", row = "";
const call = async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
  const r = await eng.handle({ method, path, body, query, userId: U });
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const set = (side: string | null, kind = "normal") => ({ kind, reps: 10, weightKg: 10, side });

beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"), { mode: "server" });
  U = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'ms','Ms')", [U]);
  curl = (await call("POST", "/exercises", { name: "Test one-arm curl", tracking: "weight_reps", primaryMuscles: ["biceps"] })).id;
  row = (await call("POST", "/exercises", { name: "Test row", tracking: "weight_reps", primaryMuscles: ["middle back"], secondaryMuscles: ["biceps"] })).id;
}, 120000);

describe("sets per muscle", () => {
  it("counts a left and a right set as 1 set for the muscle", async () => {
    const w = await call("POST", "/workouts/log", { startedAt: new Date(Date.now() - 3600000).toISOString(), durationS: 3600, exercises: [
      { exerciseId: curl, sets: [set("L", "warmup"), set("R", "warmup"), set("L"), set("R"), set("L"), set("R"), set("L"), set("R")] },
      { exerciseId: row, sets: [set(null), set(null)] },
    ] });
    // curl: 3 rounds of left and right = 3; row: 2 sets, the biceps help in them = 1
    const stats = await call("GET", "/stats");
    expect(stats.muscles.biceps).toBe(4);
    expect(stats.muscles["middle back"]).toBe(2);
    // the workout's total still counts every set done
    expect(stats.workouts[0].sets).toBe(8);
    expect((await call("GET", `/workouts/${w.id}`)).report.muscles.biceps).toBe(4);
  });

  // a person of their own, with their own exercises, for each check below, so each one sees only its own workouts
  const fresh = async () => {
    U = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,$2,'Ms')", [U, `ms${U.slice(-8)}`]);
    curl = (await call("POST", "/exercises", { name: "Test one-arm curl", tracking: "weight_reps", primaryMuscles: ["biceps"] })).id;
    row = (await call("POST", "/exercises", { name: "Test row", tracking: "weight_reps", primaryMuscles: ["middle back"], secondaryMuscles: ["biceps"] })).id;
  };
  // a couple of minutes ago, but never before the start of the current week (as the week goals and scores work it out, in
  // UTC with the default first day), so it falls in this week and the last 7 days whenever the tests run, also in the first
  // minutes after a week begins. Never in the future.
  const log = (exercises: unknown[]) => {
    const now = Date.now(), weekStart = new Date(weekIn(new Date(now), 0, 0) + "T00:00:00Z").getTime();
    return call("POST", "/workouts/log", { startedAt: new Date(Math.max(now - 120000, weekStart)).toISOString(), durationS: 60, exercises });
  };

  it("counts a lone left set as 1 set", async () => {
    await fresh();
    await log([{ exerciseId: curl, sets: [set("L")] }]);
    expect((await call("GET", "/stats")).muscles.biceps).toBe(1);
  });

  it("counts sets for both arms on their own and the busier side of the one-arm sets", async () => {
    await fresh();
    // 1 set with both arms, then left, right, left: 1 + 2 = 3
    await log([{ exerciseId: curl, sets: [set(null), set("L"), set("R"), set("L")] }]);
    expect((await call("GET", "/stats")).muscles.biceps).toBe(3);
  });

  it("counts the same exercise twice in one workout as two exercises", async () => {
    await fresh();
    // two left sets in the first, two right sets in the second: 2 + 2, not one left-and-right pair of 2
    const w = await log([{ exerciseId: curl, sets: [set("L"), set("L")] }, { exerciseId: curl, sets: [set("R"), set("R")] }]);
    expect((await call("GET", "/stats")).muscles.biceps).toBe(4);
    expect((await call("GET", `/workouts/${w.id}`)).report.muscles.biceps).toBe(4);
  });

  it("counts left and right sets as 1 set in the Strength score", async () => {
    await fresh();
    await call("PUT", "/settings", { features: { scores: true } });
    const groups = async () => (await call("GET", "/health/scores", undefined, { tz: "0" })).scores.strength.parts.find((p: any) => p.key === "groups").value;
    // 5 rounds of left and right: 5 sets for the arms, short of 10 (counted one by one it would be 10)
    await log([{ exerciseId: curl, sets: Array.from({ length: 5 }, () => [set("L"), set("R")]).flat() }]);
    expect(await groups()).toBe(0);
    await log([{ exerciseId: curl, sets: Array.from({ length: 5 }, () => set(null)) }]);
    expect(await groups()).toBe(1);
  });

  it("counts left and right sets as 1 set in a goal for a muscle's working sets", async () => {
    await fresh();
    const g = (await call("POST", "/goals", { metric: "muscle_sets", scopeId: "arms", target: 10, period: "week" })).id;
    // curl: 3 rounds of left and right = 3; row, where the biceps help: 2 rounds of left and right = 2 sets, half each = 1
    await log([
      { exerciseId: curl, sets: [set("L"), set("R"), set("L"), set("R"), set("L"), set("R")] },
      { exerciseId: row, sets: [set("L"), set("R"), set("L"), set("R")] },
    ]);
    expect((await call("GET", `/goals/${g}`)).progress.current).toBe(4);
  });

  it("counts left and right sets as 1 set for Home's suggestions", async () => {
    await fresh();
    const calf = (await call("POST", "/exercises", { name: "Test one-leg calf raise", tracking: "weight_reps", primaryMuscles: ["calves"] })).id;
    // left, right, left, right, left = 3; the same exercise again with a right set = 1
    await log([{ exerciseId: calf, sets: [set("L"), set("R"), set("L"), set("R"), set("L")] }, { exerciseId: calf, sets: [set("R")] }]);
    // read past row-level security: only this test trains the calves
    expect((await setsByMuscle(eng.db.admin, new Date(Date.now() - 28 * 86400000))).calves).toBe(4);
  });
});

