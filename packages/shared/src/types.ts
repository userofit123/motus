// The shapes the API sends and receives. Weights are always kg and distances metres; the apps convert for display.

export type SetKind = "warmup" | "normal" | "drop" | "failure";
export type Tracking =
  | "weight_reps" // 80 kg × 8
  | "bodyweight_reps" // push-ups: reps, optional added weight
  | "assisted" // assisted pull-up: weight subtracts
  | "reps_only"
  | "duration" // plank
  | "weight_duration" // farmer's carry for time
  | "distance_duration" // run, row
  | "distance_weight"; // sled push

export interface Exercise {
  id: string;
  ownerId: string | null;
  source: string;
  name: string;
  aliases: string[];
  category: string;
  equipment: string | null;
  mechanic: string | null;
  force: string | null;
  level: string | null;
  tracking: Tracking;
  unilateral: boolean;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  images: string[];
  videoUrl: string | null;
  license: string | null;
  author: string | null;
  archived: boolean;
  // per person
  favourite?: boolean;
  hidden?: boolean;
  restS?: number | null;
  restAfterS?: number | null;
  timesDone?: number;
  lastDoneAt?: string | null;
}

export interface RoutineSet {
  id?: string;
  kind: SetKind;
  reps: number | null;
  repsMax: number | null;
  weightKg: number | null;
  durationS: number | null;
  distanceM: number | null;
  rpe: number | null;
  restS: number | null;
}

export interface Progression {
  kind: "linear" | "double";
  incrementKg: number;
  // double progression: work up to repsMax in every set, then add weight and go back to reps
  deloadAfter?: number; // failed sessions in a row before a deload
  deloadPct?: number; // e.g. 10 → −10%
}

export interface RoutineExercise {
  id?: string;
  exerciseId: string;
  exercise?: Exercise;
  superset: string | null;
  restS: number | null;
  restAfterS: number | null;
  repRestS: number | null;
  prefill: "last" | "target";
  prefillScope: "any" | "routine";
  progression: Progression | null;
  note: string;
  sets: RoutineSet[];
}

export interface RoutineSettings {
  [key: string]: unknown;
}

export interface Routine {
  id: string;
  folderId: string | null;
  name: string;
  description: string;
  color: string | null;
  basedOnId: string | null;
  position: number;
  pinned: boolean;
  archived: boolean;
  settings: RoutineSettings;
  createdAt: string;
  updatedAt: string;
  exercises: RoutineExercise[];
}

export interface RoutineSummary {
  id: string;
  folderId: string | null;
  name: string;
  description: string;
  color: string | null;
  pinned: boolean;
  archived: boolean;
  position: number;
  exerciseCount: number;
  setCount: number;
  estimateS: number;
  muscles: string[];
  lastDoneAt: string | null;
  timesDone: number;
  pendingReminders: number;
  exerciseNames: string[];
}

export interface Folder {
  id: string;
  name: string;
  position: number;
  color: string | null;
}

export type WorkoutStatus = "in_progress" | "completed" | "discarded";
export type ExerciseStatus = "pending" | "done" | "skipped" | "partial";

export interface WorkoutSet {
  id: string;
  position: number;
  kind: SetKind;
  weightKg: number | null;
  reps: number | null;
  durationS: number | null;
  distanceM: number | null;
  rpe: number | null;
  rir: number | null;
  side: string | null;
  done: boolean;
  doneAt: string | null;
  restPlannedS: number | null;
  restActualS: number | null;
  targetReps: number | null;
  targetWeightKg: number | null;
  prefilled: boolean;
  // the same set last time (for the "Previous" column)
  prev?: { weightKg: number | null; reps: number | null; durationS: number | null; distanceM: number | null } | null;
  pr?: string[];
}

export interface WorkoutExercise {
  id: string;
  exerciseId: string;
  exercise: Exercise;
  routineExerciseId: string | null;
  position: number;
  status: ExerciseStatus;
  skipReason: string | null;
  superset: string | null;
  restS: number | null;
  restAfterS: number | null;
  repRestS: number | null;
  startedAt: string | null;
  endedAt: string | null;
  sets: WorkoutSet[];
  reminders?: Reminder[];
  notes?: Note[];
  suggestion?: string | null;
}

export interface Workout {
  id: string;
  routineId: string | null;
  name: string;
  status: WorkoutStatus;
  startedAt: string;
  endedAt: string | null;
  pausedS: number;
  pauseStartedAt: string | null;
  notes: string;
  rating: number | null;
  bodyweightKg: number | null;
  settings: Record<string, unknown>;
  source: string;
  exercises: WorkoutExercise[];
  reminders?: Reminder[];
  routineNotes?: Note[];
}

export interface WorkoutSummary {
  id: string;
  routineId: string | null;
  name: string;
  status: WorkoutStatus;
  startedAt: string;
  endedAt: string | null;
  durationS: number;
  exerciseCount: number;
  setCount: number;
  volumeKg: number;
  prCount: number;
  color: string | null;
}

export type NoteTarget = "exercise" | "routine" | "routine_exercise" | "workout" | "workout_exercise" | "activity";
export interface Note {
  id: string;
  targetType: NoteTarget;
  targetId: string;
  scopeRoutineId: string | null;
  body: string;
  tags: string[];
  difficulty: number | null;
  pinned: boolean;
  workoutId: string | null;
  workoutName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderAction {
  weightKg?: number; // add to the pre-filled weight
  reps?: number; // add to the pre-filled reps
  restS?: number; // set the rest
}
export interface Reminder {
  id: string;
  targetType: "exercise" | "routine";
  targetId: string;
  scopeRoutineId: string | null;
  body: string;
  trigger: "next" | "every" | "after_n" | "date";
  triggerDate: string | null;
  triggerN: number | null;
  seenN: number;
  status: "pending" | "done" | "dismissed";
  action: ReminderAction | null;
  createdWorkoutId: string | null;
  createdAt: string;
  doneAt: string | null;
  targetName?: string;
}

export type GoalScope = "general" | "routine" | "exercise" | "muscle" | "activity" | "body";
export interface Goal {
  id: string;
  title: string;
  scope: GoalScope;
  scopeId: string | null;
  metric: string;
  comparator: ">=" | "<=";
  target: number;
  period: "once" | "week" | "month";
  startDate: string;
  deadline: string | null;
  status: "active" | "achieved" | "archived";
  achievedAt: string | null;
  notes: string;
  createdAt: string;
  progress?: GoalProgress;
}
export interface GoalProgress {
  current: number;
  pct: number;
  done: boolean;
  label: string;
  history: { date: string; value: number }[];
  pace?: string;
}

export interface Activity {
  id: string;
  type: string;
  name: string;
  startedAt: string;
  endedAt: string | null;
  durationS: number;
  movingS: number | null;
  distanceM: number | null;
  steps: number | null;
  elevationM: number | null;
  avgHr: number | null;
  calories: number | null;
  route: [number, number, number?, number?][] | null; // [lat, lon, unix seconds, altitude]
  notes: string;
  source: string;
}

export interface ActivityType {
  id?: string;
  slug: string;
  name: string;
  icon: string;
  hasDistance: boolean;
  hasGps: boolean;
}

export interface BodyMetric {
  id: string;
  kind: string;
  value: number;
  measuredAt: string;
  note: string;
}

export interface Schedule {
  id: string;
  routineId: string | null;
  activityType: string | null;
  rule: "once" | "weekly" | "interval";
  days: number[];
  intervalDays: number | null;
  startDate: string;
  endDate: string | null;
  timeOfDay: string | null;
  remindMin: number | null;
  active: boolean;
  name?: string;
}

export interface CalendarEntry {
  kind: "workout" | "activity" | "planned";
  id: string;
  date: string; // YYYY-MM-DD local
  name: string;
  color: string | null;
  durationS: number;
  status?: string;
  routineId?: string | null;
  scheduleId?: string;
  activityType?: string;
  distanceM?: number | null;
  missed?: boolean;
}

export interface Me {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: "admin" | "user";
  mode: "server" | "local";
}

export interface LiveEvent {
  topics: string[];
  at: number;
}
