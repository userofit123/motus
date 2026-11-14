// Goal titles: only a name the person gives a goal is stored; the automatic title is built on every read (so it follows a
// renamed routine or a change of units), and migration 033 clears the automatic titles the app used to store.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import { migrate } from "../src/migrate";

let eng: Engine, U: string;
const call = async (method: string, path: string, body?: unknown) => {
  const r = await eng.handle({ method, path, body, query: { tz: "0" }, userId: U });
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const one = async (gid: string) => call("GET", `/goals/${gid}`);

beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"), { mode: "server", now: () => new Date("2026-10-07T10:00:00Z") });
  U = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'gt','Gt')", [U]);
}, 120000);

describe("goal titles", () => {
  it("builds the title from what the goal measures when it has no name, and keeps a name apart", async () => {
    const a = await call("POST", "/goals", { metric: "activity_minutes", scopeId: "walk", target: 30, period: "day" });
    expect(await one(a.id)).toMatchObject({ title: "Walk 30 min a day", name: "", summary: "Walk 30 min a day" });
    const b = await call("POST", "/goals", { title: "  Evening strolls ", metric: "activity_minutes", scopeId: "walk", target: 30, period: "day" });
    expect(await one(b.id)).toMatchObject({ title: "Evening strolls", name: "Evening strolls", summary: "Walk 30 min a day" });
    // clearing the name brings the automatic title back; an edit that leaves the name out keeps it
    await call("PUT", `/goals/${b.id}`, { target: 45 });
    expect(await one(b.id)).toMatchObject({ title: "Evening strolls", summary: "Walk 45 min a day" });
    await call("PUT", `/goals/${b.id}`, { title: "" });
    expect((await one(b.id)).title).toBe("Walk 45 min a day");
  });

  it("follows a renamed routine and a change of units", async () => {
    const r = await call("POST", "/routines", { name: "Push day" });
    const g = await call("POST", "/goals", { metric: "routine_count", scopeId: r.id, target: 2, period: "week" });
    expect((await one(g.id)).title).toBe("Push day twice a week");
    await call("PUT", `/routines/${r.id}`, { name: "Push A" });
    expect((await one(g.id)).title).toBe("Push A twice a week");
    const w = await call("POST", "/goals", { metric: "body_weight", target: 75, comparator: "<=" });
    await call("PUT", "/settings", { units: { system: "imperial", weight: "lb", distance: "mi", length: "in" } });
    expect((await one(w.id)).title).toBe("Body weight down to 165.3 lb");
    await call("PUT", "/settings", { units: { system: "metric", weight: "kg", distance: "km", length: "cm" } });
  });

  it("names a goal in the activity log by its title", async () => {
    const g = await call("POST", "/goals", { metric: "sleep_h", target: 7, period: "week" });
    const log = await call("GET", "/activity-log");
    expect(log.entries.find((e: any) => e.open?.id === g.id || e.name === "Average 7h of sleep a night")?.name).toBe("Average 7h of sleep a night");
  });

  it("clears the automatic titles the app used to store, keeping names the person typed (migration 033)", async () => {
    await call("GET", "/activity-types");
    const r = await call("POST", "/routines", { name: "Leg day" });
    const put = async (title: string, metric: string, scope: string, scopeId: string | null, period = "week", days: unknown = null) => {
      const gid = uuidv7();
      await eng.db.admin.query(`INSERT INTO goals (id, user_id, title, scope, scope_id, metric, comparator, target, period, days) VALUES ($1, $2, $3, $4, $5, $6, '>=', 30, $7, $8::jsonb)`,
        [gid, U, title, scope, scopeId, metric, period, days == null ? null : JSON.stringify(days)]);
      return [gid, title] as const;
    };
    const seeded = (await eng.db.admin.query<{ w: string }>("SELECT md5($1::text || ':weekly-target')::uuid::text w", [U])).rows[0]!.w;
    await eng.db.admin.query(`INSERT INTO goals (id, user_id, title, scope, scope_id, metric, comparator, target, period) VALUES ($1, $2, 'Weekly target', 'activity', 'workout', 'sessions', '>=', 3, 'week')`, [seeded, U]);
    const cleared = [
      await put("Walk: 30 min time a week", "activity_minutes", "activity", "walk"),
      await put("Walk: 30 min time a day", "activity_minutes", "activity", "walk", "day"),
      await put("Walk: 2.5 mi distance on Mon, Wed", "activity_distance", "activity", "walk", "day", [3, 1]),
      await put("Walk: 30 km distance on Sun, Sat", "activity_distance", "activity", "walk", "day", [6, 0]),
      await put("Walk: 30 km distance on Sat, Sun", "activity_distance", "activity", "walk", "day", [6, 0]),
      await put("Run: 3 a day", "sessions", "activity", "run", "day"),
      await put("Gym workouts: 3 on workdays", "sessions", "activity", "workout", "day", "workdays"),
      await put("Sessions: 4 in total", "sessions", "activity", null, "once"),
      await put("Any activity: 20 min time a month", "activity_minutes", "activity", null, "month"),
      await put("150 min active minutes (workouts and activities) a week", "active_minutes", "general", null),
      await put("Leg day: under 45 min finish within", "routine_duration", "routine", r.id, "once"),
      await put("Legs: 12 sets working sets a week", "muscle_sets", "muscle", "legs"),
      await put("Body weight to 165.5 lb", "body_weight", "body", null, "once"),
      await put("Upper arm (left) to 38 cm", "body_metric", "body", "arm_l", "once"),
      await put("Body fat % to 15 kg", "body_metric", "body", "body_fat", "once"),
      await put("Any activity: 10000 steps average daily steps a day", "steps_avg", "activity", null, "day"),
    ];
    const kept = [
      await put("Walk the dog", "activity_minutes", "activity", "walk"),
      await put("Summer legs: 30 min", "activity_minutes", "activity", "walk"),
      await put("Run to 10 km", "activity_distance", "activity", "run"),
      // typed names in the old titles' shapes, but not what the old form built for these goals
      await put("Summer cut to 75 kg", "body_weight", "body", null, "once"),
      await put("Gym: 3 a week", "sessions", "activity", "workout"),
      await put("Waist to 80 cm", "body_metric", "body", "hips", "once"),
      await put("Walk: 30 min time a week", "activity_minutes", "activity", "run"),
      await put("Walk: 30 min time a day", "activity_minutes", "activity", "walk"),
      await put("Run: 3 a week", "sessions", "activity", "run", "day", [1, 3]),
      await put("Push day: 3 times times done a week", "routine_count", "routine", r.id),
      await put("Legs: 12 sets working sets a week!", "muscle_sets", "muscle", "legs"),
    ];
    await eng.db.admin.query("DELETE FROM schema_migrations WHERE name = '033_goal_names_only'");
    const logged = Number((await eng.db.admin.query<{ n: string }>("SELECT count(*) n FROM sync_log")).rows[0]!.n);
    await migrate(eng.db);
    const titles = new Map((await eng.db.admin.query<{ id: string; title: string }>("SELECT id::text, title FROM goals")).rows.map((r) => [r.id, r.title]));
    for (const [gid, t] of cleared) expect([t, titles.get(gid)]).toEqual([t, ""]);
    for (const [gid, t] of kept) expect(titles.get(gid)).toBe(t);
    expect(titles.get(seeded)).toBe("");
    expect((await one(cleared[0]![0])).title).toBe("Walk 30 min a week");
    // every copy clears its own titles, so nothing is sent on to the others
    expect(Number((await eng.db.admin.query<{ n: string }>("SELECT count(*) n FROM sync_log")).rows[0]!.n)).toBe(logged);
});
});
