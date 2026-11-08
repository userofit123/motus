// Runs the numbered schema changes once each, in order, recording them in schema_migrations.
import type { Db } from "./db";
import m001 from "./migrations/001_init";
import m002 from "./migrations/002_isolation";
import m003 from "./migrations/003_programs";
import m004 from "./migrations/004_sync";
import m005 from "./migrations/005_rest_by_kind";
import m006 from "./migrations/006_log_index";
import m007 from "./migrations/007_goal_days";
import m008 from "./migrations/008_activity_steps";
import m009 from "./migrations/009_activity_steps_nullable";
import m010 from "./migrations/010_weekly_target_scope";
import m011 from "./migrations/011_workouts_routine_index";
import m012 from "./migrations/012_schedule_monthly";
import m013 from "./migrations/013_set_rep_range";
import m014 from "./migrations/014_reminder_body_plain";

const MIGRATIONS: [string, string][] = [
  ["001_init", m001],
  ["002_isolation", m002],
  ["003_programs", m003],
  ["004_sync", m004],
  ["005_rest_by_kind", m005],
  ["006_log_index", m006],
  ["007_goal_days", m007],
  ["008_activity_steps", m008],
  ["009_activity_steps_nullable", m009],
  ["010_weekly_target_scope", m010],
  ["011_workouts_routine_index", m011],
  ["012_schedule_monthly", m012],
  ["013_set_rep_range", m013],
  ["014_reminder_body_plain", m014],
];

export async function migrate(db: Db): Promise<string[]> {
  await db.admin.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await db.admin.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const ran: string[] = [];
  for (const [name, sql] of MIGRATIONS) {
    if (done.has(name)) continue;
    await db.tx(async (q) => {
      await q.exec(sql);
      await q.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
    });
    ran.push(name);
  }
  return ran;
}
