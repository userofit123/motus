// Live updates: every change announces the topics it touches, and every screen's data is filed under topics.
// A change to a set, for example, touches the workout, the exercise's history, records, stats, goals, home and the calendar.
// This file is the single place that says what affects what (PLAN.md §5).
export const TOPICS = {
  workout: ["workouts", "exercises", "stats", "goals", "home", "calendar", "routines", "reminders", "notes"],
  routine: ["routines", "home", "calendar", "stats"],
  exercise: ["exercises", "routines", "workouts"],
  note: ["notes", "workouts", "routines", "exercises"],
  reminder: ["reminders", "routines", "workouts", "home", "exercises"],
  goal: ["goals", "home"],
  // "health": the Health Connect import log lists steps, sleep, weight and activities, so their changes refresh it
  activity: ["activities", "stats", "goals", "home", "calendar", "health"],
  body: ["body", "stats", "goals", "home", "health"],
  health: ["health", "activities", "body", "stats", "goals", "home", "calendar"],
  schedule: ["schedules", "calendar", "home"],
  settings: ["settings", "home", "stats", "goals"],
  everything: ["*"],
} as const;
export type Change = keyof typeof TOPICS;
