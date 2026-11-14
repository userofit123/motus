// Health Connect import: daily steps and sleep, weight and exercise sessions from the phone.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";

let eng: Engine, U: string;
const call = async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
  const r = await eng.handle({ method, path, body, query, userId: U });
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const daily = async (kind: string) => (await call("GET", "/daily", undefined, { from: "2026-10-01", tz: "0" })).filter((x: any) => x.kind === kind);
beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"));
  U = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username) VALUES ($1, 'u')", [U]);
}, 120000);

describe("health connect import", () => {
  it("fills steps and sleep, updates them on the next sync, and never replaces a typed value", async () => {
    await call("PUT", "/daily", { date: "2026-10-02", kind: "steps", value: 1200 }); // typed by hand
    const r = await call("POST", "/health/import", {
      steps: [{ date: "2026-10-01", value: 8000 }, { date: "2026-10-02", value: 9500 }],
      sleep: [{ date: "2026-10-01", hours: 7.34 }],
    });
    expect(r).toMatchObject({ steps: 1, sleep: 1 });
    const steps = await daily("steps");
    expect(steps.find((x: any) => x.date === "2026-10-01")).toMatchObject({ value: 8000, source: "health_connect" });
    expect(steps.find((x: any) => x.date === "2026-10-02")).toMatchObject({ value: 1200, source: "manual" });
    expect(Number((await daily("sleep_h"))[0].value)).toBe(7.3);

    // later in the day the count grew; an unchanged day is not counted as a change
    const again = await call("POST", "/health/import", { steps: [{ date: "2026-10-01", value: 8600 }], sleep: [{ date: "2026-10-01", hours: 7.3 }] });
    expect(again).toMatchObject({ steps: 1, sleep: 0 });
    expect((await daily("steps")).find((x: any) => x.date === "2026-10-01").value).toBe(8600);
  });

  it("adds a weight reading once", async () => {
    const w = { weight: [{ at: "2026-10-03T07:00:00Z", kg: 80.456 }] };
    expect((await call("POST", "/health/import", w)).weight).toBe(1);
    expect((await call("POST", "/health/import", w)).weight).toBe(0);
    const body = await call("GET", "/body", undefined, { kind: "weight" });
    expect(body.map((x: any) => Number(x.value))).toEqual([80.46]);
  });

  it("adds sessions as activities once, keeps edits, and files unknown types under Other", async () => {
    const s = { id: "abc", type: "run", start: "2026-10-04T06:00:00Z", end: "2026-10-04T06:30:00Z", distanceM: 5000, steps: 5200, avgHr: 150, calories: 320 };
    const odd = { id: "def", type: "kitesurf", start: "2026-10-05T10:00:00Z", end: "2026-10-05T11:00:00Z" };
    expect((await call("POST", "/health/import", { sessions: [s, odd] })).activities).toBe(2);
    const list = await call("GET", "/activities", undefined, { from: "2026-10-04" });
    const run = list.find((a: any) => a.type === "run");
    expect(run).toMatchObject({ durationS: 1800, steps: 5200, avgHr: 150, source: "health_connect" });
    expect(list.map((a: any) => a.type).sort()).toEqual(["other", "run"]);

    await call("PUT", `/activities/${run.id}`, { ...run, type: "run", name: "Morning run" });
    expect((await call("POST", "/health/import", { sessions: [s] })).activities).toBe(0);
    expect((await call("GET", `/activities/${run.id}`)).name).toBe("Morning run");
  });
});
