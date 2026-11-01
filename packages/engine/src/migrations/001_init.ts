// The first schema. Weights are kept in kg and distances in metres; the display unit is a setting.
// Every table that holds someone's data has user_id, and row-level security (009 below) limits each request to its own rows.
export default /* sql */ `
CREATE TABLE users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  email text,
  password_hash text,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  display_name text NOT NULL DEFAULT '',
  totp_secret text,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  device_name text NOT NULL DEFAULT '',
  platform text NOT NULL DEFAULT 'web',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE invites (
  code text PRIMARY KEY,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  used_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE app_meta (key text PRIMARY KEY, value jsonb NOT NULL);

CREATE TABLE user_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- the library: owner_id NULL = shared catalog (read-only for everyone), otherwise a person's own exercise
CREATE TABLE exercises (
  id uuid PRIMARY KEY,
  owner_id uuid REFERENCES users(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'custom',
  source_id text,
  name text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  category text NOT NULL DEFAULT 'strength',
  equipment text,
  mechanic text,
  force text,
  level text,
  tracking text NOT NULL DEFAULT 'weight_reps',
  unilateral boolean NOT NULL DEFAULT false,
  primary_muscles text[] NOT NULL DEFAULT '{}',
  secondary_muscles text[] NOT NULL DEFAULT '{}',
  instructions text[] NOT NULL DEFAULT '{}',
  images text[] NOT NULL DEFAULT '{}',
  video_url text,
  license text,
  author text,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX exercises_source ON exercises (source, source_id) WHERE owner_id IS NULL;
CREATE INDEX exercises_owner ON exercises (owner_id);

CREATE TABLE exercise_prefs (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  rest_s int,
  rest_after_s int,
  favourite boolean NOT NULL DEFAULT false,
  hidden boolean NOT NULL DEFAULT false,
  bar_kg numeric,
  increment_kg numeric,
  PRIMARY KEY (user_id, exercise_id)
);

CREATE TABLE folders (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  position int NOT NULL DEFAULT 0,
  color text
);

CREATE TABLE routines (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES folders(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  color text,
  based_on_id uuid REFERENCES routines(id) ON DELETE SET NULL,
  position int NOT NULL DEFAULT 0,
  pinned boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  settings jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX routines_user ON routines (user_id) WHERE deleted_at IS NULL;

CREATE TABLE routine_exercises (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  routine_id uuid NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES exercises(id),
  position int NOT NULL,
  superset text,
  rest_s int,
  rest_after_s int,
  rep_rest_s int,
  prefill text NOT NULL DEFAULT 'last' CHECK (prefill IN ('last','target')),
  prefill_scope text NOT NULL DEFAULT 'any' CHECK (prefill_scope IN ('any','routine')),
  progression jsonb,
  note text NOT NULL DEFAULT ''
);
CREATE INDEX routine_exercises_routine ON routine_exercises (routine_id, position);

CREATE TABLE routine_sets (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  routine_exercise_id uuid NOT NULL REFERENCES routine_exercises(id) ON DELETE CASCADE,
  position int NOT NULL,
  kind text NOT NULL DEFAULT 'normal' CHECK (kind IN ('warmup','normal','drop','failure')),
  reps int,
  reps_max int,
  weight_kg numeric,
  duration_s int,
  distance_m numeric,
  rpe numeric,
  rest_s int
);
CREATE INDEX routine_sets_re ON routine_sets (routine_exercise_id, position);

CREATE TABLE routine_versions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  routine_id uuid NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX routine_versions_r ON routine_versions (routine_id, created_at DESC);

CREATE TABLE schedules (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  routine_id uuid REFERENCES routines(id) ON DELETE CASCADE,
  activity_type text,
  rule text NOT NULL CHECK (rule IN ('once','weekly','interval')),
  days int[] NOT NULL DEFAULT '{}',
  interval_days int,
  start_date date NOT NULL,
  end_date date,
  time_of_day text,
  remind_min int,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE schedule_exceptions (
  schedule_id uuid NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('skipped','moved')),
  moved_to date,
  PRIMARY KEY (schedule_id, date)
);

CREATE TABLE workouts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  routine_id uuid REFERENCES routines(id) ON DELETE SET NULL,
  routine_snapshot jsonb,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','discarded')),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  paused_s int NOT NULL DEFAULT 0,
  pause_started_at timestamptz,
  notes text NOT NULL DEFAULT '',
  rating int,
  bodyweight_kg numeric,
  settings jsonb NOT NULL DEFAULT '{}',
  source text NOT NULL DEFAULT 'app',
  client_id text,
  schedule_id uuid REFERENCES schedules(id) ON DELETE SET NULL,
  scheduled_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workouts_user_time ON workouts (user_id, started_at DESC);
CREATE UNIQUE INDEX workouts_client ON workouts (user_id, client_id) WHERE client_id IS NOT NULL;

CREATE TABLE workout_exercises (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_id uuid NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES exercises(id),
  routine_exercise_id uuid,
  position int NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','skipped','partial')),
  skip_reason text,
  superset text,
  rest_s int,
  rest_after_s int,
  rep_rest_s int,
  started_at timestamptz,
  ended_at timestamptz
);
CREATE INDEX workout_exercises_w ON workout_exercises (workout_id, position);
CREATE INDEX workout_exercises_ex ON workout_exercises (user_id, exercise_id);

CREATE TABLE workout_sets (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_exercise_id uuid NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
  position int NOT NULL,
  kind text NOT NULL DEFAULT 'normal' CHECK (kind IN ('warmup','normal','drop','failure')),
  weight_kg numeric,
  reps int,
  duration_s int,
  distance_m numeric,
  rpe numeric,
  rir numeric,
  side text,
  done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  rest_planned_s int,
  rest_actual_s int,
  target_reps int,
  target_weight_kg numeric,
  prefilled boolean NOT NULL DEFAULT false
);
CREATE INDEX workout_sets_we ON workout_sets (workout_exercise_id, position);

CREATE TABLE notes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('exercise','routine','routine_exercise','workout','workout_exercise','activity')),
  target_id uuid NOT NULL,
  scope_routine_id uuid,
  body text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  difficulty int,
  pinned boolean NOT NULL DEFAULT false,
  workout_id uuid REFERENCES workouts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notes_target ON notes (user_id, target_type, target_id);

CREATE TABLE reminders (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('exercise','routine')),
  target_id uuid NOT NULL,
  scope_routine_id uuid,
  body text NOT NULL,
  trigger text NOT NULL DEFAULT 'next' CHECK (trigger IN ('next','every','after_n','date')),
  trigger_date date,
  trigger_n int,
  seen_n int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','dismissed')),
  action jsonb,
  created_workout_id uuid REFERENCES workouts(id) ON DELETE SET NULL,
  last_shown_workout_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz
);
CREATE INDEX reminders_target ON reminders (user_id, target_type, target_id) WHERE status = 'pending';

CREATE TABLE goals (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  scope text NOT NULL CHECK (scope IN ('general','routine','exercise','muscle','activity','body')),
  scope_id text,
  metric text NOT NULL,
  comparator text NOT NULL DEFAULT '>=' CHECK (comparator IN ('>=','<=')),
  target numeric NOT NULL,
  period text NOT NULL DEFAULT 'once' CHECK (period IN ('once','week','month')),
  start_date date NOT NULL DEFAULT current_date,
  deadline date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','achieved','archived')),
  achieved_at timestamptz,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE activities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  name text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  duration_s int NOT NULL DEFAULT 0,
  moving_s int,
  distance_m numeric,
  steps int,
  elevation_m numeric,
  avg_hr int,
  calories int,
  route jsonb,
  notes text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'manual',
  client_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activities_user_time ON activities (user_id, started_at DESC);
CREATE UNIQUE INDEX activities_client ON activities (user_id, client_id) WHERE client_id IS NOT NULL;

CREATE TABLE activity_types (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  icon text NOT NULL DEFAULT 'activity',
  has_distance boolean NOT NULL DEFAULT true,
  has_gps boolean NOT NULL DEFAULT false,
  UNIQUE (user_id, slug)
);

CREATE TABLE body_metrics (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  value numeric NOT NULL,
  measured_at timestamptz NOT NULL,
  note text NOT NULL DEFAULT ''
);
CREATE INDEX body_metrics_user ON body_metrics (user_id, kind, measured_at DESC);

CREATE TABLE daily_logs (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date date NOT NULL,
  kind text NOT NULL,
  value numeric NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  PRIMARY KEY (user_id, date, kind)
);

CREATE TABLE media (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'image',
  mime text NOT NULL,
  size int NOT NULL,
  data bytea,
  path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_user ON events (user_id, id);
`;
