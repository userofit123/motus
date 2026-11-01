// Programs: multi-week plans made of routines (week 1: A, B, A; week 2: B, A, B…), with deload weeks.
export default /* sql */ `
CREATE TABLE programs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  weeks jsonb NOT NULL DEFAULT '[]',
  deload_pct int NOT NULL DEFAULT 40,
  start_date date NOT NULL DEFAULT current_date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON programs TO motus_app;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON programs TO motus_app USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
ALTER TABLE workouts ADD COLUMN program_id uuid REFERENCES programs(id) ON DELETE SET NULL;
`;
