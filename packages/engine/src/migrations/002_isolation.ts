// Row-level security: every request runs as the role motus_app with app.user_id set to the signed-in person,
// so even a query that forgets "WHERE user_id = ..." cannot see or change anyone else's rows.
// Sign-in tables (sessions, invites, app_meta) are not granted to motus_app at all: only the server's own code reads them.
const OWNED = [
  "user_settings", "exercise_prefs", "folders", "routines", "routine_exercises", "routine_sets", "routine_versions",
  "schedules", "schedule_exceptions", "workouts", "workout_exercises", "workout_sets", "notes", "reminders", "goals",
  "activities", "activity_types", "body_metrics", "daily_logs", "media", "events",
];
const ME = "NULLIF(current_setting('app.user_id', true), '')::uuid";

export default /* sql */ `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motus_app') THEN CREATE ROLE motus_app NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO motus_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO motus_app;

${OWNED.map((t) => `
GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO motus_app;
ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON ${t} TO motus_app USING (user_id = ${ME}) WITH CHECK (user_id = ${ME});`).join("\n")}

-- the library: everyone reads the shared catalog; people only change their own exercises
GRANT SELECT, INSERT, UPDATE, DELETE ON exercises TO motus_app;
ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;
CREATE POLICY read_lib ON exercises FOR SELECT TO motus_app USING (owner_id IS NULL OR owner_id = ${ME});
CREATE POLICY own_ins ON exercises FOR INSERT TO motus_app WITH CHECK (owner_id = ${ME});
CREATE POLICY own_upd ON exercises FOR UPDATE TO motus_app USING (owner_id = ${ME}) WITH CHECK (owner_id = ${ME});
CREATE POLICY own_del ON exercises FOR DELETE TO motus_app USING (owner_id = ${ME});

-- a person sees and edits only their own user row (name, profile); sign-in fields are changed by the server only
GRANT SELECT ON users TO motus_app;
GRANT UPDATE (display_name, email) ON users TO motus_app;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY self ON users TO motus_app USING (id = ${ME});
`;
