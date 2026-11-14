import type { GoalScope } from "./types";

/** One thing a goal can measure: what it is about, its unit (as stored: kg, km, min...) and whether it repeats each period. */
export interface GoalMetric { scope: GoalScope; metric: string; name: string; unit: string; periodic: boolean; comparator?: ">=" | "<="; hidden?: boolean }

// hidden: still measured for goals made with it, no longer offered for new ones (sessions covers workouts and activity
// counts; every weekly or monthly goal now keeps its own streak)
export const GOAL_METRICS: GoalMetric[] = [
  { scope: "general", metric: "workouts", name: "Workouts", unit: "workouts", periodic: true, hidden: true },
  { scope: "general", metric: "active_minutes", name: "Active minutes (workouts and activities)", unit: "min", periodic: true },
  { scope: "general", metric: "streak_weeks", name: "Weeks in a row meeting your weekly goal", unit: "weeks", periodic: false, hidden: true },
  { scope: "general", metric: "volume", name: "Total volume", unit: "kg", periodic: true },
  { scope: "routine", metric: "routine_count", name: "Times done", unit: "times", periodic: true },
  { scope: "routine", metric: "routine_duration", name: "Finish within", unit: "min", periodic: false, comparator: "<=" },
  { scope: "routine", metric: "routine_volume", name: "Volume in one session", unit: "kg", periodic: false },
  { scope: "exercise", metric: "max_weight", name: "Heaviest weight", unit: "kg", periodic: false },
  { scope: "exercise", metric: "e1rm", name: "Estimated one-rep max", unit: "kg", periodic: false },
  { scope: "exercise", metric: "max_reps", name: "Most reps in a set", unit: "reps", periodic: false },
  { scope: "exercise", metric: "max_duration", name: "Longest hold", unit: "s", periodic: false },
  { scope: "exercise", metric: "exercise_count", name: "Times done", unit: "times", periodic: true },
  { scope: "muscle", metric: "muscle_sets", name: "Working sets", unit: "sets", periodic: true },
  { scope: "muscle", metric: "muscle_sessions", name: "Sessions training it", unit: "times", periodic: true },
  // sessions: scopeId null = workouts and every activity, "workout" = gym workouts, else one activity type
  { scope: "activity", metric: "sessions", name: "Sessions", unit: "sessions", periodic: true },
  { scope: "activity", metric: "activity_distance", name: "Distance", unit: "km", periodic: true },
  { scope: "activity", metric: "activity_count", name: "Number of sessions", unit: "times", periodic: true, hidden: true },
  { scope: "activity", metric: "activity_minutes", name: "Time", unit: "min", periodic: true },
  { scope: "activity", metric: "steps_avg", name: "Average daily steps", unit: "steps", periodic: true },
  // the daily log's sleep (typed, or from a band): an average over the nights that have one, as steps_avg over days
  { scope: "general", metric: "sleep_h", name: "Average sleep", unit: "h", periodic: true, comparator: ">=" },
  // which way a body goal heads is chosen per goal (suggested by bodyGoalDirection), so neither sets a comparator
  { scope: "body", metric: "body_weight", name: "Body weight", unit: "kg", periodic: false },
  { scope: "body", metric: "body_metric", name: "Measurement", unit: "cm", periodic: false },
];
