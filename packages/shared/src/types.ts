// The shapes the API sends and receives. Weights are always kg and distances metres; the apps convert for display.

export type SetKind = "warmup" | "normal" | "drop" | "failure";
/** Rest after each kind of set other than working sets (those use the exercise's own rest), in seconds; null = as working sets. */
export type RestByKind = Partial<Record<Exclude<SetKind, "normal">, number | null>>;
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
  /** this exercise's own weight step (kg), when set; else the Settings increment */
  incrementKg?: number | null;
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
  deloadKg?: number | null; // a fixed amount instead, for machines whose stack has no 10% steps
}

export interface RoutineExercise {
  id?: string;
  exerciseId: string;
  exercise?: Exercise;
  superset: string | null;
  restS: number | null;
  restAfterS: number | null;
  restByKind?: RestByKind | null;
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
  /** how long the plan takes by the numbers */
  estimateS: number;
  /** how long it really takes: the average of its last few workouts (`of` of them), null before it's been done */
  usual: { s: number; of: number; newest: boolean } | null;
  muscles: string[];
  /** muscles that only help (no exercise here works them as a main muscle) */
  helpers?: string[];
  lastDoneAt: string | null;
  timesDone: number;
  pendingReminders: number;
  exerciseNames: string[];
}

/** A program: weeks of routines done in order, some weeks lighter (deload). */
export interface Program {
  id: string;
  name: string;
  description: string;
  weeks: { days: string[]; deload?: boolean }[];
  deloadPct: number;
  startDate: string;
  active: boolean;
  createdAt: string;
  state: ProgramState;
}
export interface ProgramSlot { routineId: string; week: number; day: number; deload: boolean; name: string; color: string | null }
/** Where you are: the next routine in order, and how many of the planned workouts are done. */
export interface ProgramState { next: ProgramSlot | null; done: number; total: number; finished?: boolean }
export interface ProgramWorkout { id: string; name: string; startedAt: string; durationS: number; volumeKg: number; week: number | null; day: number | null }
/** One program in full, for its page. */
export interface ProgramDetail extends Program {
  status: "active" | "paused" | "finished";
  /** The week the calendar is in since the start (0 = not started yet); compared with state.next.week to see if you're behind. */
  calendarWeek: number;
  /** done: finished (with its workout); next: the one to do now; late: from a week the calendar has passed; todo: still to come */
  plan: { week: number; deload: boolean; days: (ProgramSlot & { status: "done" | "next" | "late" | "todo"; workout: ProgramWorkout | null })[] }[];
  stats: { done: number; total: number; weeksDone: number; expected: number; adherencePct: number | null; volumeKg: number; durationS: number;
    perRoutine: { routineId: string; name: string; done: number; planned: number }[] };
  /** Workouts in this program, newest first: the ones that counted, and any extra started from it */
  recent: ProgramWorkout[];
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
  /** the top of the rep range when the routine gives one ("8-12": 8 and 12) */
  targetRepsMax?: number | null;
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
  /** swapped during this workout: it keeps the routine slot (routineExerciseId) while the slot holds another exercise */
  swapped?: boolean;
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
  // every working set of the exercise's last session (the one `prev` comes from), for comparing whole sessions
  last?: { weightKg: number | null; reps: number | null; durationS: number | null; distanceM: number | null }[];
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
  // "Ready for more weight" accepted on the Finish screen: the working sets start at exactly this weight and these reps
  setWeightKg?: number;
  setReps?: number;
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
  targetName?: string | null;
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
  period: "once" | "day" | "week" | "month";
  /** a daily goal's days: null every day, "workdays" the work week in settings, or chosen days (Sunday = 0) */
  days?: GoalDays;
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
  /** the unit current and target are stored in (kg, km, …), so the app can show them in yours */
  unit?: string;
  history: { date: string; value: number }[];
  pace?: string;
  /** weekly and monthly goals: weeks (or months) in a row reaching it, ending with this one once it's reached, else the last */
  streak?: number;
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
  /** on foot: steps are counted while recording one */
  hasSteps?: boolean;
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
  rule: "once" | "weekly" | "interval" | "monthly";
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

export type GoalDays = null | "workdays" | number[];

/** Home (/home): what's planned for a day in the coming week. */
export interface HomePlan { scheduleId: string; date: string; routineId: string | null; activityType: string | null; name: string; color: string | null; timeOfDay: string | null }
/** Home: a program you follow, where you are in it (absent while Programs is switched off). */
export interface HomeProgram extends Omit<ProgramState, "next"> { next: ProgramSlot; id: string; name: string; weeks: number; deloadPct: number; startDate: string; calendarWeek: number }
/** Home: a routine or muscle worth doing next. */
export interface HomeSuggestion { key: string; kind: "program" | "order" | "missed" | "rested" | "oldest"; title: string; reason: string; routineId: string | null; color: string | null; muscle?: string }
/** Home: a record from the last 30 days; the set that broke the most records stands for its exercise in that workout. */
export interface HomeRecord {
  workoutId: string; at: string; exerciseId: string; name: string; tracking: Tracking | undefined; kinds: string[];
  weightKg: number | null; reps: number | null; durationS: number | null; distanceM: number | null;
}
/** Home's summary: the parts the Today block reads. */
export interface HomeToday {
  active: { id: string; name: string; startedAt: string } | null;
  last: WorkoutSummary | null;
  daysSinceLast: number | null;
  /** the days (app calendar) with a finished workout or an activity */
  days: string[];
  upNext: HomePlan[];
  programs: HomeProgram[];
  suggest: HomeSuggestion[];
}
/** Home: a week's totals (the last eight, oldest first). */
export interface HomeWeek { start: string; workouts: number; volumeKg: number; timeS: number; walkM: number }
/** Home: a muscle group and how long since it was trained (null: never). */
export interface HomeGroup { id: string; name: string; lastAt: string | null; days: number | null }
/** Home: one line of recent activity, a workout summary or an activity. */
export type HomeFeedItem = ({ kind: "workout" } & WorkoutSummary) | { kind: "activity"; id: string; type: string; name: string | null; startedAt: string; durationS: number; distanceM: number | null };
/** Home (/home): everything the blocks read. */
export interface HomeData extends HomeToday {
  records: HomeRecord[];
  streak: number;
  weeks: HomeWeek[]; thisWeek: HomeWeek; lastWeek: HomeWeek;
  homeGoals: (Goal & { showStreak: boolean })[];
  goals: Goal[];
  reminders: Reminder[];
  bodyweight: { value: number; at: string }[];
  feed: HomeFeedItem[];
  muscles7: Record<string, number>; main7: string[]; helpers7: string[];
  groupDays: HomeGroup[];
  totalWorkouts: number; routineCount: number; activityCount: number;
}
