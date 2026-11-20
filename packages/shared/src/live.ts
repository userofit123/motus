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
  // "health": the Health Connect import log lists steps, sleep, weight and activities, so their changes refresh it;
  // "nightscores": a day's sleep hours typed in the daily log are its night's time asleep, which its sleep score reads
  activity: ["activities", "stats", "goals", "home", "calendar", "health", "nightscores"],
  body: ["body", "stats", "goals", "home", "health"],
  // workouts: a band's heart rate is added to workouts afterwards (/health/ranges); routines and exercises show it per
  // routine and per exercise session; goals: sleep hours
  // readings: an import log key deleted (or its data deleted elsewhere) takes its Health Connect records (migration 040)
  health: ["health", "nightscores", "activities", "workouts", "routines", "exercises", "body", "stats", "goals", "home", "calendar", "readings"],
  // every Health Connect record as it is (M-238): only screens that read the records themselves
  readings: ["readings"],
  // routines: a program's page shows the day each open routine is planned for (M-290)
  schedule: ["schedules", "calendar", "home", "routines"],
  // nightscores: each night's own sleep score depends on the birth year (the hours for your age, none under 18) and the
  // Health scores feature, so only those nights reload, not every health screen
  settings: ["settings", "home", "stats", "goals", "nightscores"],
  everything: ["*"],
} as const;
export type Change = keyof typeof TOPICS;
