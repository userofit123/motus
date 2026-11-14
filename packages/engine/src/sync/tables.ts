// The tables that are a person's data and travel between devices, parents before children (the order rows are written in).
// Not synced: sign-in tables, the shared catalog (fetched whole), uploaded files (fetched on demand), the events feed.
// since: the migration that made the table (it makes its own sync trigger; 004_sync only does the tables there were then)
export const SYNCED: { name: string; pk: string[]; since?: string }[] = [
  { name: "user_settings", pk: ["user_id"] },
  { name: "exercises", pk: ["id"] }, // only people's own; the catalog has no owner
  { name: "exercise_prefs", pk: ["user_id", "exercise_id"] },
  { name: "folders", pk: ["id"] },
  { name: "programs", pk: ["id"] },
  { name: "routines", pk: ["id"] },
  { name: "routine_exercises", pk: ["id"] },
  { name: "routine_sets", pk: ["id"] },
  { name: "routine_versions", pk: ["id"] },
  { name: "schedules", pk: ["id"] },
  { name: "schedule_exceptions", pk: ["schedule_id", "date"] },
  { name: "workouts", pk: ["id"] },
  { name: "workout_exercises", pk: ["id"] },
  { name: "workout_sets", pk: ["id"] },
  { name: "notes", pk: ["id"] },
  { name: "reminders", pk: ["id"] },
  { name: "goals", pk: ["id"] },
  { name: "activity_types", pk: ["id"] },
  { name: "activities", pk: ["id"] },
  { name: "body_metrics", pk: ["id"] },
  { name: "daily_logs", pk: ["user_id", "date", "kind"] },
  { name: "health_imports", pk: ["user_id", "key"], since: "027_health_imports" },
  { name: "sleep_nights", pk: ["user_id", "date"], since: "029_sleep_nights" },
  { name: "hr_days", pk: ["user_id", "date"], since: "030_hr_days" },
];
export const SYNCED_BY_NAME = new Map(SYNCED.map((t, i) => [t.name, { ...t, order: i }]));
