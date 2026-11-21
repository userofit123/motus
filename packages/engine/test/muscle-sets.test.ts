// M-295: a left set and a right set of one exercise are one set for its muscles, in Stats → Muscles, the workout's report
// and the Strength score's sets alike (muscleSetCount and MUSCLE_SETS_SQL), so a one-arm curl done on each side 3 times
// gives the biceps 3 sets, not 6. Warm-ups stay out.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";

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
});
