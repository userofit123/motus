// Health Connect import: daily steps and sleep, weight and exercise sessions from the phone.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import { overrule } from "../src/sync/core";

let eng: Engine, U: string;
const call = async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
  const r = await eng.handle({ method, path, body, query, userId: U });
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const send = async (status: number, method: string, path: string, body?: unknown) => {
  const r = await eng.handle({ method, path, body, userId: U });
  expect(r.status).toBe(status);
};
const log = async (q: Record<string, string> = {}) => (await call("GET", "/health/imports", undefined, { tz: "0", ...q }));
const entry = async (key: string) => (await log({ limit: "200" })).items.find((x: any) => x.key === key);
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

  it("lists what came in, newest first, a page at a time", async () => {
    const all = await log();
    expect(all.items.map((x: any) => x.key)).toEqual([
      "activity:def", "activity:abc", "weight:2026-10-03T07:00:00.000Z", "steps:2026-10-01", "sleep:2026-10-01",
    ]);
    expect(all.cursor).toBeNull();
    const steps = all.items.find((x: any) => x.kind === "steps");
    expect(steps).toMatchObject({ date: "2026-10-01", at: null, value: 8600, activity: null, ref: null, edited: false });
    expect(all.items.find((x: any) => x.kind === "sleep").value).toBe(7.3);
    expect(all.items.find((x: any) => x.kind === "weight")).toMatchObject({ date: "2026-10-03", at: "2026-10-03T07:00:00.000Z", value: 80.46, edited: false });
    const run = all.items.find((x: any) => x.key === "activity:abc");
    expect(run).toMatchObject({ date: "2026-10-04", value: null, activity: { type: "run", name: "Morning run", durationS: 1800, distanceM: 5000, steps: 5200, avgHr: 150 } });
    expect(run.ref).toBe(run.activity.id);
    // the typed day (2026-10-02) was never an import
    expect(all.items.some((x: any) => x.key === "steps:2026-10-02")).toBe(false);

    const p1 = await log({ limit: "2" });
    expect(p1.items.map((x: any) => x.key)).toEqual(["activity:def", "activity:abc"]);
    const p2 = await log({ limit: "2", before: p1.cursor });
    const p3 = await log({ limit: "2", before: p2.cursor });
    expect([...p2.items, ...p3.items].map((x: any) => x.key)).toEqual(all.items.slice(2).map((x: any) => x.key));
    expect(p3.cursor).toBeNull();
  });

  it("keeps a day's steps edited in the log through later syncs", async () => {
    await call("PUT", "/health/imports/steps:2026-10-01", { value: 10000 });
    expect(await entry("steps:2026-10-01")).toMatchObject({ value: 10000, edited: true });
    expect((await call("POST", "/health/import", { steps: [{ date: "2026-10-01", value: 9100 }] })).steps).toBe(0);
    expect((await daily("steps")).find((x: any) => x.date === "2026-10-01")).toMatchObject({ value: 10000, source: "manual" });
    await send(400, "PUT", `/health/imports/${encodeURIComponent("activity:abc")}`, { value: 1 });
    await send(404, "PUT", "/health/imports/steps:1999-01-01", { value: 1 });
  });

  it("edits a weight reading in place", async () => {
    await call("PUT", "/health/imports/weight:2026-10-03T07:00:00.000Z", { value: 79.9 });
    expect((await entry("weight:2026-10-03T07:00:00.000Z")).value).toBe(79.9);
    expect((await call("GET", "/body", undefined, { kind: "weight" })).map((x: any) => Number(x.value))).toEqual([79.9]);
  });

  it("adds a weight reading with a record id once, and links one already logged at that minute", async () => {
    const w = { weight: [{ id: "w1", at: "2026-10-06T07:00:00Z", kg: 81 }] };
    expect((await call("POST", "/health/import", w)).weight).toBe(1);
    expect((await call("POST", "/health/import", w)).weight).toBe(0);
    // the same reading sent again by a newer app, now with its id: not a second entry or a second reading
    expect((await call("POST", "/health/import", { weight: [{ id: "w0", at: "2026-10-03T07:00:30Z", kg: 80.4 }] })).weight).toBe(0);
    expect((await log({ limit: "200" })).items.filter((x: any) => x.kind === "weight").map((x: any) => x.key)).toEqual(["weight:w1", "weight:2026-10-03T07:00:00.000Z"]);
    expect((await call("GET", "/body", undefined, { kind: "weight" })).length).toBe(2);
  });

  it("deletes each kind from the log for good", async () => {
    await call("POST", "/health/import", { steps: [{ date: "2026-10-07", value: 4000 }], sleep: [{ date: "2026-10-07", hours: 6 }], sessions: [{ id: "s7", type: "walk", start: "2026-10-07T06:00:00Z", end: "2026-10-07T06:20:00Z" }] });
    const keys = ["steps:2026-10-07", "sleep:2026-10-07", "weight:w1", "activity:s7"];
    for (const k of keys) expect(await entry(k)).toBeTruthy();
    const act = (await entry("activity:s7")).ref;
    for (const k of keys) await call("DELETE", `/health/imports/${encodeURIComponent(k)}`);
    await send(404, "DELETE", "/health/imports/weight:w1");
    expect((await daily("steps")).some((x: any) => x.date === "2026-10-07")).toBe(false);
    await send(404, "GET", `/activities/${act}`);

    const again = await call("POST", "/health/import", {
      steps: [{ date: "2026-10-07", value: 4500 }], sleep: [{ date: "2026-10-07", hours: 6.5 }],
      weight: [{ id: "w1", at: "2026-10-06T07:00:00Z", kg: 81 }], sessions: [{ id: "s7", type: "walk", start: "2026-10-07T06:00:00Z", end: "2026-10-07T06:20:00Z" }],
    });
    expect(again).toEqual({ steps: 0, sleep: 0, weight: 0, activities: 0 });
    for (const k of keys) expect(await entry(k)).toBeUndefined();
    expect((await daily("steps")).some((x: any) => x.date === "2026-10-07")).toBe(false);
    expect((await daily("sleep_h")).some((x: any) => x.date === "2026-10-07")).toBe(false);
    expect((await call("GET", "/body", undefined, { kind: "weight" })).length).toBe(1);
  });

  it("doesn't bring back what was deleted elsewhere in the app", async () => {
    const batch = {
      steps: [{ date: "2026-10-08", value: 3000 }], weight: [{ id: "w8", at: "2026-10-08T07:00:00Z", kg: 82 }],
      sessions: [{ id: "s8", type: "run", start: "2026-10-08T06:00:00Z", end: "2026-10-08T06:20:00Z" }],
    };
    expect(await call("POST", "/health/import", batch)).toMatchObject({ steps: 1, weight: 1, activities: 1 });
    await call("PUT", "/daily", { date: "2026-10-08", kind: "steps", value: null });
    await call("DELETE", `/body/${(await entry("weight:w8")).ref}`);
    await call("DELETE", `/activities/${(await entry("activity:s8")).ref}`);
    for (const k of ["steps:2026-10-08", "weight:w8", "activity:s8"]) expect(await entry(k)).toBeUndefined();

    expect(await call("POST", "/health/import", batch)).toEqual({ steps: 0, sleep: 0, weight: 0, activities: 0 });
    expect((await daily("steps")).some((x: any) => x.date === "2026-10-08")).toBe(false);
    expect((await call("GET", "/body", undefined, { kind: "weight" })).some((x: any) => x.measuredAt.startsWith("2026-10-08"))).toBe(false);
    expect((await call("GET", "/activities", undefined, { from: "2026-10-08" })).some((a: any) => a.startedAt.startsWith("2026-10-08"))).toBe(false);
    const gone = (await eng.db.admin.query("SELECT key FROM health_imports WHERE deleted_at IS NOT NULL ORDER BY key")).rows.map((x: any) => x.key);
    expect(gone).toEqual(expect.arrayContaining(["steps:2026-10-08", "weight:w8", "activity:s8"]));
  });

  it("keeps a deletion when a copy that hadn't heard of it syncs the same key again", () => {
    const row = (deleted: string | null) => ({ user_id: U, key: "steps:2026-10-09", kind: "steps", deleted_at: deleted });
    const c = (deleted: string | null) => ({ tbl: "health_imports", pk: { user_id: U, key: "steps:2026-10-09" }, op: "upsert" as const, at: new Date().toISOString(), row: row(deleted) });
    expect(overrule(c(null), { row: row("2026-10-09T10:00:00Z") })).toBe(false);
    expect(overrule(c("2026-10-09T10:00:00Z"), { row: row(null) })).toBe(true);
    expect(overrule(c(null), { row: row(null) })).toBeNull();
  });
});
