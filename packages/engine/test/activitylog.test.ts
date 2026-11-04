// The activity log: row changes read back as plain entries, bursts collapsed, newest first, only your own.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";

let eng: Engine, A: string, B: string;
const call = async (u: string, method: string, path: string, body?: unknown, query?: Record<string, string>) => {
  const r = await eng.handle({ method, path, body, query, userId: u });
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const log = (u = A, query: Record<string, string> = {}) => call(u, "GET", "/activity-log", undefined, query);
// moves everything logged so far into the past, as if it happened hours ago
const age = (hours: number) => eng.db.admin.query(`UPDATE sync_log SET at = at - interval '${hours} hours'`);

beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"));
  A = uuidv7(); B = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username) VALUES ($1, 'a'), ($2, 'b')", [A, B]);
}, 120000);

describe("activity log", () => {
  let routineId = "", workoutId = "";
  it("starts empty", async () => {
    expect(await log()).toEqual({ entries: [], cursor: null });
  });
  it("names a new routine and a started workout", async () => {
    routineId = (await call(A, "POST", "/routines", { template: "full-a" })).id;
    const w = await call(A, "POST", "/workouts/start", { routineId });
    workoutId = w.id;
    const { entries } = await log();
    const started = entries.find((e: any) => e.kind === "workout");
    expect(started).toMatchObject({ action: "started", name: w.name, open: { kind: "workout", id: workoutId, live: true } });
    expect(started.text).toBe(`Started ${w.name}`);
    // the routine's many rows (exercises, sets) are one entry
    expect(entries.filter((e: any) => e.kind === "routine")).toHaveLength(1);
    expect(entries.find((e: any) => e.kind === "routine").text).toMatch(/^Created routine /);
  });
  it("collapses a burst of set changes into one entry, and finishing into another", async () => {
    await age(5);
    const w = await call(A, "GET", `/workouts/${workoutId}`);
    const sets = w.exercises.flatMap((x: any) => x.sets).slice(0, 3);
    for (const s of sets) await call(A, "PUT", `/workout-sets/${s.id}`, { weightKg: 60, reps: 8, done: true });
    let { entries } = await log();
    expect(entries[0]).toMatchObject({ kind: "workout", action: "logged", text: `Logged 3 sets in ${w.name}` });
    expect(entries.filter((e: any) => e.kind === "workout")).toHaveLength(2); // the start, hours earlier, stays its own entry
    await call(A, "POST", `/workouts/${workoutId}/finish`, {});
    ({ entries } = await log());
    expect(entries[0]).toMatchObject({ kind: "workout", action: "finished", text: `Finished ${w.name}`, detail: "3 sets", open: { kind: "workout", id: workoutId } });
    expect(entries[0].open.live).toBeUndefined();
  });
  it("describes goals, body entries, notes, settings and deletions", async () => {
    await age(5);
    await call(A, "POST", "/goals", { metric: "workouts", period: "week", target: 3, title: "Three a week" });
    await call(A, "POST", "/body", { kind: "weight", value: 80 });
    const ex = (await call(A, "GET", "/exercises"))[0];
    await call(A, "POST", "/notes", { targetType: "exercise", targetId: ex.id, body: "Keep the elbows in" });
    await call(A, "PUT", "/settings", { weeklyGoal: 4 });
    const { entries } = await log();
    const by = (k: string) => entries.find((e: any) => e.kind === k);
    expect(by("goal")).toMatchObject({ action: "created", text: "Set a goal: Three a week" });
    expect(by("body")).toMatchObject({ action: "logged", text: "Logged body weight" });
    expect(by("note")).toMatchObject({ text: "Added a note", detail: "Keep the elbows in", open: { kind: "exercise", id: ex.id } });
    expect(by("settings")).toMatchObject({ text: "Changed settings" });
    await age(5);
    await call(A, "DELETE", `/workouts/${workoutId}`);
    const after = (await log()).entries;
    // the workout and all its exercises and sets: one entry, which can no longer be opened
    expect(after[0]).toMatchObject({ kind: "workout", action: "deleted", text: "Deleted a workout", open: null });
    expect(after.filter((e: any) => e.at === after[0].at)).toHaveLength(1);
  });
  it("pages through older entries without repeating or skipping any", async () => {
    const all = (await log(A, { limit: "100" })).entries;
    const seen: any[] = [];
    let cursor: string | null = null;
    do {
      const page: any = await log(A, { limit: "2", ...(cursor ? { before: cursor } : {}) });
      seen.push(...page.entries);
      cursor = page.cursor;
    } while (cursor);
    expect(seen.map((e) => e.text)).toEqual(all.map((e: any) => e.text));
  });
  it("shows only your own changes", async () => {
    expect((await log(B)).entries).toEqual([]);
    await call(B, "POST", "/body", { kind: "weight", value: 70 });
    expect((await log(B)).entries).toHaveLength(1);
    expect((await log()).entries.filter((e: any) => e.kind === "body")).toHaveLength(1);
  });
});
