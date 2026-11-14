import type { Goal, GoalDays, GoalScope } from "./types";
import type { Settings } from "./settings";
import { num, fromKg, fromM, fromCm } from "./units";
import { bodyMeasure, bodyName } from "./body";
import { daysIntoWeek } from "./training";

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

/** What a goal's automatic title needs besides the goal: the name of what it is about (routine, exercise, muscle group,
 *  activity type or body measure; none for "everything"), your units, and the first day of the week for chosen days. */
export interface GoalTitleOpts { name?: string | null; units?: Partial<Pick<Settings, "units">["units"]>; firstDay?: number }
type TitleGoal = Pick<Goal, "scope" | "scopeId" | "metric" | "comparator" | "target" | "period"> & { days?: GoalDays };

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** " a day", " on workdays", " on Mon, Wed", " a week", " a month", and for a goal counted once " in total" (or nothing) */
function perPeriod(g: TitleGoal, firstDay: number, once = " in total"): string {
  if (g.period === "week") return " a week";
  if (g.period === "month") return " a month";
  if (g.period !== "day") return once;
  if (g.days === "workdays") return " on workdays";
  if (Array.isArray(g.days) && g.days.length && g.days.length < 7)
    return " on " + [...g.days].sort((a, b) => daysIntoWeek(a, firstDay) - daysIntoWeek(b, firstDay)).map((d) => WEEKDAY_SHORT[d]).join(", ");
  return " a day";
}
/** "45 s", "2 min", "1 min 30 s" */
const secs = (s: number) => s < 60 ? `${num(s, 0)} s` : s % 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${s / 60} min`;
/** "once" / "twice" / "3 times" */
const times = (n: number) => n === 1 ? "once" : n === 2 ? "twice" : `${num(n, 1)} times`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A goal's automatic title, read as a sentence: "Walk 30 min a day", "3 workouts a week", "Bench Press estimated 1RM 100 kg",
 * "Body weight down to 75 kg". Worked out when shown, never stored, so it follows a renamed routine or a change of units;
 * a name the person gives the goal is kept apart and shown instead. Targets are as stored (kg, km, cm, min, s, h).
 */
export function goalAutoTitle(g: TitleGoal, o: GoalTitleOpts = {}): string {
  const n = o.name?.trim() || "", t = Number(g.target), fd = o.firstDay ?? 1;
  const wu = o.units?.weight ?? "kg", du = o.units?.distance ?? "km", lu = o.units?.length ?? "cm";
  const kg = (v: number) => `${num(fromKg(v, wu), 1)} ${wu}`;
  const per = perPeriod(g, fd);
  const lead = (s: string) => cap(n ? `${n} ${s}` : s);
  switch (g.metric) {
    case "workouts": return `${num(t, 1)} workout${t === 1 ? "" : "s"}${per}`;
    case "active_minutes": return `${num(t, 0)} active minutes${per}`;
    case "streak_weeks": return `${num(t, 0)} week${t === 1 ? "" : "s"} in a row reaching your weekly goal`;
    case "volume": return `Lift ${kg(t)}${per}`;
    case "routine_count": return lead(`${times(t)}${per}`);
    case "routine_duration": return `Finish ${n || "the routine"} within ${num(t, 0)} min`;
    case "routine_volume": return `Lift ${kg(t)} in one ${n || "session"}`;
    case "max_weight": return lead(kg(t));
    case "e1rm": return lead(`estimated 1RM ${kg(t)}`);
    case "max_reps": return lead(`${num(t, 0)} rep${t === 1 ? "" : "s"} in a set`);
    case "max_duration": return lead(`hold ${secs(t)}`);
    case "exercise_count": return lead(`${times(t)}${per}`);
    case "muscle_sets": return `${num(t, 1)} ${n ? n.toLowerCase() + " " : ""}set${t === 1 ? "" : "s"}${per}`;
    case "muscle_sessions": return `Train ${n ? n.toLowerCase() : "it"} ${times(t)}${per}`;
    // everything counts as sessions, gym workouts as workouts, one kind of activity by its name ("Walk 3 times a week")
    case "sessions": case "activity_count":
      if (g.scopeId === "workout") return `${num(t, 1)} workout${t === 1 ? "" : "s"}${per}`;
      return g.scopeId && n ? lead(`${times(t)}${per}`) : `${num(t, 1)} session${t === 1 ? "" : "s"}${per}`;
    case "activity_distance": return lead(`${num(fromM(t * 1000, du), 1)} ${du}${per}`);
    case "activity_minutes": return n && g.scopeId ? lead(`${num(t, 0)} min${per}`) : `${num(t, 0)} min of activity${per}`;
    // an average per day (steps) or night (sleep) over the period: a daily goal is just that day's
    case "steps_avg": return g.period === "day" ? `${num(t, 0)} steps${per}` : `Average ${num(t, 0)} steps a day`;
    case "sleep_h": return g.period === "day" ? `Sleep ${num(t, 1)} h${perPeriod(g, fd).replace(" a day", " a night")}` : `Average ${num(t, 1)} h of sleep a night`;
    case "body_weight": case "body_metric": {
      const kind = g.metric === "body_weight" ? "weight" : g.scopeId ?? "";
      const m = bodyMeasure(kind), u = m?.unit ?? "cm";
      const v = u === "kg" ? kg(t) : u === "cm" ? `${num(fromCm(t, lu), 1)} ${lu}` : `${num(t, 1)}%`;
      return `${n || m?.name || bodyName(kind)} ${g.comparator === "<=" ? "down" : "up"} to ${v}`;
    }
  }
  const m = GOAL_METRICS.find((x) => x.metric === g.metric);
  return lead(`${num(t, 1)} ${m?.unit ?? ""}${per.trim() === "in total" ? "" : per}`.replace(/\s+/g, " ").trim());
}

