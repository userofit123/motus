// Body measurement goals: which way they head, progress from where you started, and achieving them.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";

let eng: Engine, U: string;
const call = async (method: string, path: string, body?: unknown) => {
  const r = await eng.handle({ method, path, body, userId: U });
  if (r.status !== 200) throw Object.assign(new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`), { status: r.status });
  return r.body as any;
};
const log = (kind: string, value: number, daysAgo = 0) => call("POST", "/body", { kind, value, measuredAt: new Date(Date.now() - daysAgo * 86400000).toISOString() });
const goal = async (id: string) => call("GET", `/goals/${id}`);
beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"));
  U = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username) VALUES ($1, 'u')", [U]);
}, 120000);

describe("body measurement goals", () => {
  it("grows an arm: higher is better, progress from the starting measurement", async () => {
    await log("arm_r", 36, 3);
    const { id, comparator } = await call("POST", "/goals", { metric: "body_metric", scopeId: "arm_r", target: 38 });
    expect(comparator).toBe(">=");
    let g = await goal(id);
    expect(g.progress.unit).toBe("cm");
    expect(g.progress.pct).toBe(0);
    expect(g.progress.done).toBe(false);
    await log("arm_r", 37);
    g = await goal(id);
    expect(g.progress.current).toBe(37);
    expect(g.progress.pct).toBeCloseTo(0.5);
    expect(g.status).toBe("active");
    await log("arm_r", 38.2);
    g = await goal(id);
    expect(g.progress.done).toBe(true);
    expect(g.progress.pct).toBe(1);
    expect(g.status).toBe("achieved");
  });

  it("shrinks a waist: lower is better", async () => {
    await log("waist", 90, 2);
    const { id, comparator } = await call("POST", "/goals", { metric: "body_metric", scopeId: "waist", target: 85 });
    expect(comparator).toBe("<=");
    await log("waist", 87.5);
    let g = await goal(id);
    expect(g.progress.pct).toBeCloseTo(0.5);
    expect(g.progress.done).toBe(false);
    await log("waist", 91); // going the wrong way is no progress, not negative
    expect((await goal(id)).progress.pct).toBe(0);
    await log("waist", 84.8);
    g = await goal(id);
    expect(g.progress.done).toBe(true);
    expect(g.status).toBe("achieved");
  });

  it("with nothing logged, heads the usual way for the measure", async () => {
    expect((await call("POST", "/goals", { metric: "body_metric", scopeId: "calf_l", target: 40 })).comparator).toBe(">=");
    const hips = await call("POST", "/goals", { metric: "body_metric", scopeId: "hips", target: 95 });
    expect(hips.comparator).toBe("<=");
    // nothing logged is not "got down to 95"
    const g = await goal(hips.id);
    expect(g.progress.done).toBe(false);
    expect(g.progress.pct).toBe(0);
  });

  it("follows the current value even against the usual way (bulking body weight)", async () => {
    await log("weight", 70, 5);
    expect((await call("POST", "/goals", { metric: "body_weight", target: 75 })).comparator).toBe(">=");
  });

  it("keeps the direction the person chose over the suggested one", async () => {
    // usual way for body fat is down and nothing says otherwise, but this person wants to go up
    const { id, comparator } = await call("POST", "/goals", { metric: "body_metric", scopeId: "body_fat", target: 15, comparator: ">=" });
    expect(comparator).toBe(">=");
    await log("body_fat", 12, 4);
    let g = await goal(id);
    expect(g.comparator).toBe(">=");
    expect(g.progress.done).toBe(false);
    await log("body_fat", 13.5);
    g = await goal(id);
    expect(g.progress.pct).toBeCloseTo(0.5);
    // and against the latest entry: 95 kg now, aiming at 100, but the person chose "decrease" (suggestion would be up)
    await log("weight", 95);
    const w = await call("POST", "/goals", { metric: "body_weight", target: 100, comparator: "<=" });
    expect(w.comparator).toBe("<=");
    // 95 is already at or under 100, so with the chosen direction it is reached
    expect((await goal(w.id)).status).toBe("achieved");
  });

  it("lets the direction be changed later, and reopens a goal that turning it round undoes", async () => {
    await log("chest", 100, 2);
    const { id } = await call("POST", "/goals", { metric: "body_metric", scopeId: "chest", target: 105, comparator: "<=" });
    expect((await goal(id)).status).toBe("achieved"); // 100 ≤ 105: met the wrong way round
    await call("PUT", `/goals/${id}`, { comparator: ">=" });
    const g = await goal(id);
    expect(g.comparator).toBe(">=");
    expect(g.status).toBe("active");
    expect(g.achievedAt).toBeNull();
    expect(g.progress.done).toBe(false);
  });

  it("ignores a direction for goals whose way is fixed", async () => {
    const { id, comparator } = await call("POST", "/goals", { metric: "workouts", target: 3, comparator: "<=" });
    expect(comparator).toBe(">=");
    await call("PUT", `/goals/${id}`, { comparator: "<=" });
    expect((await goal(id)).comparator).toBe(">=");
  });

  it("refuses an unknown measurement", async () => {
    await expect(call("POST", "/goals", { metric: "body_metric", scopeId: "nose", target: 5 })).rejects.toMatchObject({ status: 400 });
  });
});
