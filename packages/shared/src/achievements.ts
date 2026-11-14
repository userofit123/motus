// Achievements (optional feature): milestones worked out from what you logged each time they're asked for, never
// stored, so editing or deleting a workout moves them too. Each is a ladder of steps in the units you use: 100 km and
// 100 mi are both round numbers to aim for, 160.9 km is not.
import type { WeightUnit, DistanceUnit } from "./units";
import { toKg, toM, num } from "./units";

/** What a ladder counts, in stored units: weights in kg, distances in metres, time in seconds. */
export type AchievementUnit = "count" | "kg" | "m" | "s" | "weeks";
export interface AchievementDef {
  id: string;
  title: string;
  /** what the number means, for the card under the title */
  desc: string;
  unit: AchievementUnit;
  /** steps as you'd say them: workouts, tonnes or thousands of lb, km or mi, hours, weeks */
  steps: number[] | ((u: { weight: WeightUnit; distance: DistanceUnit }) => number[]);
  /** left out until there's something towards it, so a ladder for cycling doesn't sit at 0 for someone who never cycles */
  untilStarted?: boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "workouts", title: "Workouts", desc: "Workouts finished", unit: "count", steps: [1, 10, 25, 50, 100, 250, 500, 1000] },
  { id: "streak", title: "Weekly target", desc: "Your longest run of weeks in a row that met your weekly workout goal", unit: "weeks", steps: [4, 8, 12, 26, 52] },
  { id: "records", title: "Personal records", desc: "Times you beat your best on an exercise (weight, estimated 1RM, reps, time or distance)", unit: "count", steps: [1, 10, 25, 50, 100, 250] },
  { id: "lifted", title: "Weight lifted", desc: "Weight × reps over every working set", unit: "kg", steps: (u) => (u.weight === "lb" ? [2, 20, 100, 200, 1000, 2000] : [1, 10, 50, 100, 500, 1000]) },
  { id: "hours", title: "Time training", desc: "Time in finished workouts, pauses left out", unit: "s", steps: [10, 25, 50, 100, 250, 500] },
  { id: "walk", title: "Walking", desc: "Distance of walks and hikes", unit: "m", steps: [10, 50, 100, 250, 500, 1000] },
  { id: "run", title: "Running", desc: "Distance of runs", unit: "m", steps: [10, 50, 100, 250, 500, 1000], untilStarted: true },
  { id: "cycle", title: "Cycling", desc: "Distance of rides", unit: "m", steps: [100, 250, 500, 1000, 2500, 5000], untilStarted: true },
  { id: "programs", title: "Programs", desc: "Programs followed to the end", unit: "count", steps: [1, 3, 5, 10], untilStarted: true },
  { id: "weighins", title: "Weigh-ins", desc: "Weeks with at least one body-weight entry", unit: "weeks", steps: [4, 12, 26, 52], untilStarted: true },
];

/** A step in stored units (kg, metres, seconds). */
export function achievementTarget(d: AchievementDef, step: number, u: { weight: WeightUnit; distance: DistanceUnit }): number {
  if (d.unit === "kg") return toKg(step * 1000, u.weight); // tonnes, or thousands of lb
  if (d.unit === "m") return toM(step, u.distance);
  if (d.unit === "s") return step * 3600;
  return step;
}

/** "100 workouts", "10 t lifted", "20k lb lifted", "50 km walked", "12 weeks in a row" */
export function achievementName(d: AchievementDef, step: number, u: { weight: WeightUnit; distance: DistanceUnit }): string {
  const n = num(step, 0);
  switch (d.id) {
    case "workouts": return step === 1 ? "First workout" : `${n} workouts`;
    case "streak": return `${n} weeks in a row`;
    case "records": return step === 1 ? "First record" : `${n} records`;
    case "lifted": return u.weight === "lb" ? `${n}k lb lifted` : `${n} ${step === 1 ? "tonne" : "tonnes"} lifted`;
    case "hours": return `${n} hours trained`;
    case "walk": return `${n} ${u.distance} walked`;
    case "run": return `${n} ${u.distance} run`;
    case "cycle": return `${n} ${u.distance} cycled`;
    case "programs": return step === 1 ? "First program finished" : `${n} programs finished`;
    case "weighins": return `${n} weeks of weigh-ins`;
    default: return `${d.title} ${n}`;
  }
}
