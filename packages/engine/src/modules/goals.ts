// Goals: general, per routine, per exercise, per muscle group, per activity and for the body.
// Progress is worked out from the data each time, so editing a past workout moves the goal too.
// Weeks, months and days follow the app's calendar (tz = its getTimezoneOffset(), as for /home and /achievements), not
// the process's: the server runs in UTC and the copy on a device in the person's zone, and both must agree.
import { e1rm, GROUPS, LIFTED_SQL, withDefaults, bodyMeasure, bodyUnit, bodyGoalDirection, goalDaysOf, orderGoals, type Goal, type GoalProgress, type Settings } from "@motus/shared";
import type { Router, Ctx } from "../router";
import type { Sql } from "../db";
import { camel, id, str, numOrNull, oneOf, dateStr, startOfDay, tzOf, visible } from "../util";
import { uuidv7 } from "../ids";
import { notFound, bad } from "../errors";
import { getSettings } from "./settings";
import { exerciseSessions } from "./library";
import { currentStreak, dayIn, weekIn } from "./achievements";
import { stepsByDay } from "./activities";

const DAY = 86400000;

interface Window { from: string; to: string; fromDay: string; toDay: string }
/** A daily goal's days as stored: null (every day), "workdays", or the chosen days of the week, as JSON. */
const daysIn = (v: unknown): string | null => v === "workdays" ? JSON.stringify("workdays")
  : Array.isArray(v) && v.length && v.length < 7 ? JSON.stringify([...new Set(v.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()) : null;

// hidden: still measured for goals made with it, no longer offered for new ones (sessions covers workouts and activity
// counts; every weekly or monthly goal now keeps its own streak)
export const METRICS: { scope: Goal["scope"]; metric: string; name: string; unit: string; periodic: boolean; comparator?: ">=" | "<="; hidden?: boolean }[] = [
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
  // which way a body goal heads is chosen per goal (suggested by bodyGoalDirection), so neither sets a comparator
  { scope: "body", metric: "body_weight", name: "Body weight", unit: "kg", periodic: false },
  { scope: "body", metric: "body_metric", name: "Measurement", unit: "cm", periodic: false },
];

function windowOf(g: Goal, now: Date, s: Settings, tzMin: number, offset = 0): Window {
  const span = (a: string, b: string): Window => ({ from: startOfDay(a, tzMin).toISOString(), to: startOfDay(b, tzMin).toISOString(), fromDay: a, toDay: b });
  const shift = (day: string, days: number) => new Date(new Date(day + "T12:00:00Z").getTime() + days * DAY).toISOString().slice(0, 10);
  if (g.period === "day") {
    // offset 0: the latest of the goal's days up to today; each step back skips the days it doesn't count on
    const on = goalDaysOf(g.days, s), dow = (d: string) => new Date(d + "T12:00:00Z").getUTCDay();
    let day = dayIn(now, tzMin);
    for (let k = 0; k < 7 && !on.includes(dow(day)); k++) day = shift(day, -1);
    for (let n = 0; n < offset; n++) { day = shift(day, -1); for (let k = 0; k < 7 && !on.includes(dow(day)); k++) day = shift(day, -1); }
    return span(day, shift(day, 1));
  }
  if (g.period === "week") {
    const start = shift(weekIn(now, tzMin, s.firstDay), -7 * offset);
    return span(start, shift(start, 7));
  }
  if (g.period === "month") {
    const [y, m] = dayIn(now, tzMin).split("-").map(Number) as [number, number];
    const first = (k: number) => new Date(Date.UTC(y, m - 1 - offset + k, 1)).toISOString().slice(0, 10);
    return span(first(0), first(1));
  }
  // from the day it started to the end of today
  return span(g.startDate, shift(dayIn(now, tzMin), 1));
}

async function valueFor(q: Sql, g: Goal, w: Window, s: Settings, now: Date, tzMin: number): Promise<number> {
  const P = [w.from, w.to];
  const one = async (sql: string, params: unknown[]) => Number((await q.query(sql, params)).rows[0]?.v ?? 0);
  const done = "w.status = 'completed' AND w.started_at >= $1 AND w.started_at < $2";
  switch (g.metric) {
    case "workouts": return one(`SELECT count(*) v FROM workouts w WHERE ${done}`, P);
    case "volume": return one(`SELECT coalesce(sum(${LIFTED_SQL}),0) v FROM workout_sets s JOIN workout_exercises we ON we.id=s.workout_exercise_id JOIN workouts w ON w.id=we.workout_id
      JOIN exercises e ON e.id=we.exercise_id WHERE ${done} AND s.done AND s.kind<>'warmup'`, P);
    case "active_minutes":
      return (await one(`SELECT coalesce(sum(extract(epoch FROM w.ended_at - w.started_at) - w.paused_s),0)/60 v FROM workouts w WHERE ${done}`, P))
        + (await one(`SELECT coalesce(sum(duration_s),0)/60 v FROM activities WHERE started_at >= $1 AND started_at < $2`, P));
    case "streak_weeks": return currentStreak(q, s, now, tzMin);
    case "routine_count": return one(`SELECT count(*) v FROM workouts w WHERE ${done} AND w.routine_id = $3`, [...P, g.scopeId]);
    case "routine_duration": return one(`SELECT coalesce(min(extract(epoch FROM w.ended_at - w.started_at) - w.paused_s)/60, 0) v FROM workouts w WHERE ${done} AND w.routine_id = $3`, [...P, g.scopeId]);
    case "routine_volume":
      return one(`SELECT coalesce(max(v),0) v FROM (SELECT sum(${LIFTED_SQL}) v FROM workout_sets s JOIN workout_exercises we ON we.id=s.workout_exercise_id JOIN workouts w ON w.id=we.workout_id
        JOIN exercises e ON e.id=we.exercise_id WHERE ${done} AND w.routine_id = $3 AND s.done AND s.kind<>'warmup' GROUP BY w.id) x`, [...P, g.scopeId]);
    case "max_weight": case "e1rm": case "max_reps": case "max_duration": case "exercise_count": {
      const ss = (await exerciseSessions(q, g.scopeId!, 1000)).filter((x) => x.startedAt >= w.from && x.startedAt < w.to);
      if (g.metric === "exercise_count") return ss.length;
      const sets = ss.flatMap((x) => x.sets).filter((x: any) => x.kind !== "warmup");
      if (g.metric === "max_weight") return Math.max(0, ...sets.map((x: any) => x.weightKg ?? 0));
      if (g.metric === "e1rm") return Math.max(0, ...sets.map((x: any) => e1rm(x.weightKg, x.reps) ?? 0));
      if (g.metric === "max_reps") return Math.max(0, ...sets.map((x: any) => x.reps ?? 0));
      return Math.max(0, ...sets.map((x: any) => x.durationS ?? 0));
    }
    case "muscle_sets": case "muscle_sessions": {
      const muscles = GROUPS.find((x) => x.id === g.scopeId)?.muscles ?? [g.scopeId];
      if (g.metric === "muscle_sessions")
        return one(`SELECT count(DISTINCT w.id) v FROM workout_exercises we JOIN workouts w ON w.id=we.workout_id JOIN exercises e ON e.id=we.exercise_id
          WHERE ${done} AND we.status<>'skipped' AND e.primary_muscles && $3::text[]`, [...P, muscles]);
      return one(`SELECT coalesce(sum(CASE WHEN e.primary_muscles && $3::text[] THEN 1 ELSE 0.5 END),0) v FROM workout_sets s JOIN workout_exercises we ON we.id=s.workout_exercise_id
        JOIN workouts w ON w.id=we.workout_id JOIN exercises e ON e.id=we.exercise_id
        WHERE ${done} AND s.done AND s.kind<>'warmup' AND (e.primary_muscles && $3::text[] OR e.secondary_muscles && $3::text[])`, [...P, muscles]);
    }
    case "activity_distance": return (await one(`SELECT coalesce(sum(distance_m),0) v FROM activities WHERE started_at >= $1 AND started_at < $2 AND ($3::text IS NULL OR type = $3)`, [...P, g.scopeId])) / 1000;
    case "sessions": {
      const w = g.scopeId === null || g.scopeId === "workout" ? await one(`SELECT count(*) v FROM workouts w WHERE ${done}`, P) : 0;
      const a = g.scopeId === "workout" ? 0 : await one(`SELECT count(*) v FROM activities WHERE started_at >= $1 AND started_at < $2 AND ($3::text IS NULL OR type = $3)`, [...P, g.scopeId]);
      return w + a;
    }
    case "activity_count": return one(`SELECT count(*) v FROM activities WHERE started_at >= $1 AND started_at < $2 AND ($3::text IS NULL OR type = $3)`, [...P, g.scopeId]);
    case "activity_minutes": return (await one(`SELECT coalesce(sum(duration_s),0) v FROM activities WHERE started_at >= $1 AND started_at < $2 AND ($3::text IS NULL OR type = $3)`, [...P, g.scopeId])) / 60;
    // steps are kept by calendar day, so they take the window's days rather than its instants; days with none don't count
    case "steps_avg": { const days = await stepsByDay(q, w.fromDay, w.toDay, tzMin); return days.length ? days.reduce((t, d) => t + d.value, 0) / days.length : 0; }
    case "body_weight": return one(`SELECT value v FROM body_metrics WHERE kind='weight' ORDER BY measured_at DESC LIMIT 1`, []);
    case "body_metric": return one(`SELECT value v FROM body_metrics WHERE kind=$1 ORDER BY measured_at DESC LIMIT 1`, [g.scopeId]);
  }
  return 0;
}

/** The body_metrics kind a body goal follows. */
const bodyKind = (g: Pick<Goal, "metric" | "scopeId">) => (g.metric === "body_weight" ? "weight" : g.scopeId ?? "");

export async function progressOf(q: Sql, g: Goal, s: Settings, now: Date, tzMin = 0): Promise<GoalProgress> {
  const current = Math.round((await valueFor(q, g, windowOf(g, now, s, tzMin), s, now, tzMin)) * 100) / 100;
  const lower = g.comparator === "<=";
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  let pct: number;
  if (g.scope === "body") {
    // a body goal runs from where you stood when it was set (the last entry before then, else the first after) to the target,
    // both ways: arms 36 → 38 cm at 37 cm is half way, not 97 %
    const set = (g as Goal & { createdAt?: string }).createdAt ?? `${g.startDate}T23:59:59Z`;
    const base = Number((await q.query(
      `SELECT coalesce((SELECT value FROM body_metrics WHERE kind = $1 AND measured_at <= $2 ORDER BY measured_at DESC LIMIT 1),
         (SELECT value FROM body_metrics WHERE kind = $1 ORDER BY measured_at LIMIT 1)) v`, [bodyKind(g), set])).rows[0]?.v ?? current);
    pct = !current ? 0 : lower ? (current <= g.target ? 1 : base > g.target ? clamp((base - current) / (base - g.target)) : 0)
      : (current >= g.target ? 1 : base < g.target ? clamp((current - base) / (g.target - base)) : 0);
  } else if (lower) pct = current && current <= g.target ? 1 : 0; // "finish within": met or not
  else pct = g.target > 0 ? clamp(current / g.target) : 0;
  // nothing logged reads as 0, which must not count as reaching a lower target
  const done = lower ? current > 0 && current <= g.target : current >= g.target;
  const history: { date: string; value: number }[] = [];
  if (g.period !== "once") {
    for (let i = 7; i >= 0; i--) { const w = windowOf(g, now, s, tzMin, i); history.push({ date: w.fromDay, value: Math.round((await valueFor(q, g, w, s, now, tzMin)) * 10) / 10 }); }
  } else if (g.scope === "exercise") {
    const ss = (await exerciseSessions(q, g.scopeId!, 30)).reverse();
    for (const x of ss) {
      const v = g.metric === "e1rm" ? x.e1rm : g.metric === "max_weight" ? x.maxWeightKg : g.metric === "max_reps" ? Math.max(0, ...x.sets.map((y: any) => y.reps ?? 0)) : x.durationS;
      if (v) history.push({ date: x.startedAt.slice(0, 10), value: Math.round(v * 10) / 10 });
    }
  } else if (g.scope === "body") {
    const { rows } = await q.query("SELECT measured_at, value FROM body_metrics WHERE kind = $1 ORDER BY measured_at DESC LIMIT 30", [bodyKind(g)]);
    rows.reverse().forEach((r: any) => history.push({ date: r.measured_at.slice(0, 10), value: Number(r.value) }));
  }
  let pace: string | undefined;
  if (g.period !== "once" && !done && !lower) {
    const left = Math.ceil(g.target - current);
    const today = dayIn(now, tzMin), w = windowOf(g, now, s, tzMin);
    // a daily goal on a day it doesn't count on: the last of its days is shown, and nothing more is due today
    pace = g.period !== "day" ? `${left} more ${g.period === "week" ? "this week" : "this month"}` : w.fromDay === today ? `${left} more today` : "Not one of its days";
  } else if (g.deadline && !done) {
    // calendar days left, today included (due today: 1 day left), on the app's calendar
    const days = Math.round((new Date(g.deadline + "T00:00:00Z").getTime() - new Date(dayIn(now, tzMin) + "T00:00:00Z").getTime()) / DAY) + 1;
    pace = days > 0 ? `${days} day${days === 1 ? "" : "s"} left` : "Deadline passed";
  }
  // body goals are in kg, % or cm by measure; the app shows kg and cm in the person's units
  const unit = g.scope === "body" ? bodyUnit(bodyKind(g)) : METRICS.find((m) => m.metric === g.metric)?.unit ?? "";
  const streak = g.period === "once" ? undefined : (await streakOf(q, g, s, now, tzMin, done)).current;
  return { current, pct, done, label: `${current} / ${g.target} ${unit}`.trim(), unit, history, pace, streak };
}

const MAX_PERIODS = 260; // five years of weeks: far enough back for any streak, short enough to stay quick
const metIn = async (q: Sql, g: Goal, s: Settings, now: Date, tzMin: number, offset: number) => (await valueFor(q, g, windowOf(g, now, s, tzMin, offset), s, now, tzMin)) >= g.target;

/**
 * Weeks (or months) in a row reaching a weekly or monthly goal. The current one counts once it's reached; until then the
 * run ending last week still stands. best: the longest run there has been, back to the first thing logged.
 */
export async function streakOf(q: Sql, g: Goal, s: Settings, now: Date, tzMin: number, nowDone?: boolean, withBest = false): Promise<{ current: number; best: number }> {
  if (g.period === "once") return { current: 0, best: 0 };
  let current = (nowDone ?? (await metIn(q, g, s, now, tzMin, 0))) ? 1 : 0;
  let i = 1;
  for (; i < MAX_PERIODS && (await metIn(q, g, s, now, tzMin, i)); i++) current++;
  if (!withBest) return { current, best: current };
  // the run above is one of them; before it, walk back to the first thing logged and keep the longest
  const first = (await q.query(`SELECT least((SELECT min(started_at) FROM workouts WHERE status = 'completed'), (SELECT min(started_at) FROM activities),
    (SELECT min(measured_at) FROM body_metrics), (SELECT min(date)::timestamptz FROM daily_logs)) v`)).rows[0]?.v;
  let best = current, run = 0;
  for (i++; i < MAX_PERIODS && first && windowOf(g, now, s, tzMin, i).to > new Date(first).toISOString(); i++) {
    run = (await metIn(q, g, s, now, tzMin, i)) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { current, best };
}

/** What went into a goal's current week, month or (for a one-off goal) everything since it started, newest first. */
async function goalLog(q: Sql, g: Goal, w: Window, tzMin: number): Promise<{ kind: string; id?: string; name: string; at: string; durationS?: number | null; distanceM?: number | null; value?: number | null }[]> {
  const P = [w.from, w.to];
  const done = "w.status = 'completed' AND w.started_at >= $1 AND w.started_at < $2";
  const wk = async (extra = "", params: unknown[] = []) => (await q.query(
    `SELECT w.id, w.name, w.started_at, extract(epoch FROM w.ended_at - w.started_at) - w.paused_s AS dur FROM workouts w WHERE ${done} ${extra} ORDER BY w.started_at DESC LIMIT 60`, [...P, ...params]))
    .rows.map((r: any) => ({ kind: "workout", id: r.id, name: r.name, at: r.started_at, durationS: r.dur == null ? null : Math.round(Number(r.dur)) }));
  const acts = async (type: string | null) => (await q.query(
    `SELECT id, type, name, started_at, duration_s, distance_m FROM activities WHERE started_at >= $1 AND started_at < $2 AND ($3::text IS NULL OR type = $3) ORDER BY started_at DESC LIMIT 60`, [...P, type]))
    .rows.map((r: any) => ({ kind: "activity", id: r.id, name: r.name || r.type, type: r.type, at: r.started_at, durationS: r.duration_s, distanceM: r.distance_m == null ? null : Number(r.distance_m) }));
  const both = (a: any[], b: any[]) => [...a, ...b].sort((x, y) => String(y.at).localeCompare(String(x.at))).slice(0, 60);
  switch (g.metric) {
    case "workouts": case "volume": return wk();
    case "active_minutes": return both(await wk(), await acts(null));
    case "routine_count": case "routine_duration": case "routine_volume": return wk("AND w.routine_id = $3", [g.scopeId]);
    case "muscle_sets": case "muscle_sessions": {
      const muscles = GROUPS.find((x) => x.id === g.scopeId)?.muscles ?? [g.scopeId];
      return wk(`AND EXISTS (SELECT 1 FROM workout_exercises we JOIN exercises e ON e.id = we.exercise_id WHERE we.workout_id = w.id AND we.status <> 'skipped'
        AND (e.primary_muscles && $3::text[] OR e.secondary_muscles && $3::text[]))`, [muscles]);
    }
    case "sessions": return g.scopeId === "workout" ? wk() : g.scopeId === null ? both(await wk(), await acts(null)) : acts(g.scopeId);
    case "activity_distance": case "activity_count": case "activity_minutes": return acts(g.scopeId);
    case "max_weight": case "e1rm": case "max_reps": case "max_duration": case "exercise_count":
      return (await exerciseSessions(q, g.scopeId!, 60)).filter((x) => x.startedAt >= w.from && x.startedAt < w.to).map((x) => ({
        kind: "workout", id: x.workoutId, name: x.workoutName, at: x.startedAt,
        value: g.metric === "e1rm" ? x.e1rm : g.metric === "max_weight" ? x.maxWeightKg : g.metric === "max_duration" ? x.durationS : g.metric === "max_reps" ? Math.max(0, ...x.sets.map((y: any) => y.reps ?? 0)) : null }));
    case "steps_avg": return (await stepsByDay(q, w.fromDay, w.toDay, tzMin)).map((r) => ({ kind: "day", name: "Steps", at: r.date, value: r.value }));
    case "body_weight": case "body_metric": return (await q.query("SELECT id, measured_at, value FROM body_metrics WHERE kind = $1 ORDER BY measured_at DESC LIMIT 30", [bodyKind(g)]))
      .rows.map((r: any) => ({ kind: "body", id: r.id, name: "", at: r.measured_at, value: Number(r.value) }));
  }
  return [];
}

/**
 * The daily step goal used to be a setting (stepGoal); it is now a goal counted every day. Made once (stepGoalSeeded),
 * and only for someone who used steps; everyone else sets one when they want it.
 * with an id from the person's id like the starter goal, so the server and each device make the same one.
 */
async function ensureStepGoal(q: Sql, userId: string) {
  const raw = (await q.query<{ data: any }>("SELECT data FROM user_settings WHERE user_id = $1", [userId])).rows[0]?.data ?? {};
  if (raw.stepGoalSeeded) return;
  const s = withDefaults(raw);
  // only for someone who used it: steps logged, or the old setting changed from its default
  const used = (raw.stepGoal != null && raw.stepGoal !== 8000) || (await q.query("SELECT 1 FROM daily_logs WHERE kind = 'steps' LIMIT 1")).rows.length > 0;
  const has = (await q.query("SELECT 1 FROM goals WHERE metric = 'steps_avg' AND period = 'day' LIMIT 1")).rows.length;
  if (used && !has && s.features.steps) {
    const gid = (await q.query<{ id: string }>("SELECT md5($1::text || ':daily-steps')::uuid AS id", [userId])).rows[0]!.id;
    await q.query(`INSERT INTO goals (id, user_id, title, scope, scope_id, metric, comparator, target, period, start_date)
      VALUES ($1, $2, 'Daily steps', 'activity', NULL, 'steps_avg', '>=', $3, 'day', current_date) ON CONFLICT (id) DO NOTHING`, [gid, userId, Math.max(1000, s.stepGoal)]);
  }
  await q.query(`INSERT INTO user_settings (user_id, data, updated_at) VALUES ($1, $2, now()) ON CONFLICT (user_id) DO UPDATE SET data = user_settings.data || $2, updated_at = now()`,
    [userId, JSON.stringify({ stepGoalSeeded: true })]);
}

/**
 * The old fixed weekly target (settings.weeklyGoal) became a goal, "Weekly target": gym workouts each week, first on Home
 * with its streak. Only someone who already used it gets it (a weekly number set, or workouts / activities logged); someone
 * with only activities logged gets it counting every session instead, as gym workouts alone would never fill it; new
 * people start with no goals. Decided once (goalsSeeded), so deleting it sticks and someone who starts logging later is
 * never handed it. Its id comes from the person's id, so the server and the copy on each device make the same goal.
 */
export async function ensureStarterGoal(q: Sql, userId: string) {
  await ensureStepGoal(q, userId);
  const raw = (await q.query<{ data: any }>("SELECT data FROM user_settings WHERE user_id = $1", [userId])).rows[0]?.data ?? {};
  if (raw.goalsSeeded) return;
  const s = withDefaults(raw);
  const gym = raw.weeklyGoal != null || (await q.query("SELECT 1 FROM workouts LIMIT 1")).rows.length > 0;
  const used = gym || (await q.query("SELECT 1 FROM activities LIMIT 1")).rows.length > 0;
  if (!used) {
    await q.query(`INSERT INTO user_settings (user_id, data, updated_at) VALUES ($1, $2, now()) ON CONFLICT (user_id) DO UPDATE SET data = user_settings.data || $2, updated_at = now()`, [userId, JSON.stringify({ goalsSeeded: true })]);
    return;
  }
  const gid = (await q.query<{ id: string }>("SELECT md5($1::text || ':weekly-target')::uuid AS id", [userId])).rows[0]!.id;
  await q.query(`INSERT INTO goals (id, user_id, title, scope, scope_id, metric, comparator, target, period, start_date)
    VALUES ($1, $2, 'Weekly target', 'activity', $4, 'sessions', '>=', $3, 'week', current_date) ON CONFLICT (id) DO NOTHING`, [gid, userId, Math.max(1, s.weeklyGoal), gym ? "workout" : null]);
  const goals = s.home.goals.some((x) => x.id === gid) ? s.home.goals : [{ id: gid, streak: true }, ...s.home.goals];
  const next = { goalsSeeded: true, home: { ...(raw.home ?? {}), goals } };
  await q.query(`INSERT INTO user_settings (user_id, data, updated_at) VALUES ($1, $2, now()) ON CONFLICT (user_id) DO UPDATE SET data = user_settings.data || $2, updated_at = now()`, [userId, JSON.stringify(next)]);
}

export async function goalsWithProgress(ctx: Ctx, tzMin: number, where = "status <> 'archived'"): Promise<Goal[]> {
  await ensureStarterGoal(ctx.q, ctx.userId);
  const s = await getSettings(ctx.q, ctx.userId);
  const rows = (await ctx.q.query(`SELECT * FROM goals WHERE ${where} ORDER BY status = 'achieved', created_at DESC`)).rows.map((x: any) => camel<Goal>(x));
  for (const g of rows) {
    g.target = Number(g.target);
    g.progress = await progressOf(ctx.q, g, s, ctx.now(), tzMin);
    // one-off goals are marked achieved the first time they are met
    if (g.status === "active" && g.period === "once" && g.progress.done) {
      await ctx.q.query("UPDATE goals SET status = 'achieved', achieved_at = now() WHERE id = $1", [g.id]);
      g.status = "achieved"; g.achievedAt = ctx.now().toISOString();
    }
  }
  // in the order you set (Reorder goals), achieved ones still after the rest
  return orderGoals(rows, s.goalsOrder).sort((a, b) => Number(a.status === "achieved") - Number(b.status === "achieved"));
}

/**
 * What a goal measures, checked the same way for a new goal and an edit. On an edit (prev) each field the body leaves out
 * keeps its value, and only a changed routine, exercise or muscle group is checked against what this person can see (an old
 * goal whose routine was deleted can still be renamed). A change of kind counts too: a kept scopeId was made for the old
 * kind (a routine's id is no exercise, "walk" no muscle group).
 */
async function goalFields(ctx: Ctx, b: Record<string, unknown>, prev?: Goal) {
  const has = (k: string) => !prev || k in b;
  const m = METRICS.find((x) => x.metric === (has("metric") ? b.metric : prev!.metric));
  if (!m) throw bad("Pick what to measure");
  const target = has("target") ? numOrNull(b.target, 0, 1e9) : Number(prev!.target);
  if (target == null || target <= 0) throw bad("Set a target");
  const raw = has("scopeId") ? b.scopeId : prev!.scopeId;
  const scopeId = raw && m.metric !== "body_weight" ? str(raw, 80) : null;
  if (["routine", "exercise", "muscle"].includes(m.scope) && !scopeId) throw bad(`Pick the ${m.scope === "muscle" ? "muscle group" : m.scope}`);
  if (m.metric === "body_metric" && (!bodyMeasure(scopeId ?? "") || scopeId === "weight")) throw bad("Pick what to measure");
  if (!prev || scopeId !== prev.scopeId || m.scope !== prev.scope) {
    if (m.scope === "muscle" && !GROUPS.some((g) => g.id === scopeId)) throw bad("Pick the muscle group");
    if (m.scope === "routine") await visible(ctx.q, "routines", id(scopeId), "routine");
    if (m.scope === "exercise") await visible(ctx.q, "exercises", id(scopeId), "exercise");
  }
  // only a body goal's direction is the person's choice (someone may want a bigger or a smaller waist); the others are fixed by what they measure
  const kind = bodyKind({ metric: m.metric, scopeId });
  let comparator: ">=" | "<=" = m.comparator ?? ">=";
  if (m.scope === "body") {
    const asked = b.comparator;
    if (asked === ">=" || asked === "<=") comparator = asked;
    // the same body measure keeps the way it was heading
    else if (prev && prev.scope === "body" && bodyKind(prev) === kind) comparator = prev.comparator;
    else {
      // when the app doesn't say, a body goal heads from where you are now towards the target, else the measure's usual way
      const now = (await ctx.q.query("SELECT value v FROM body_metrics WHERE kind = $1 ORDER BY measured_at DESC LIMIT 1", [kind])).rows[0];
      comparator = bodyGoalDirection(kind, target, now ? Number(now.v) : null);
    }
  }
  const period = m.periodic ? oneOf(has("period") ? b.period : prev!.period, ["once", "day", "week", "month"], "week") : "once";
  const days = period === "day" ? daysIn(has("days") ? b.days : prev!.days) : null;
  return { scope: m.scope, metric: m.metric, scopeId, target, comparator, period, days };
}

export function goalRoutes(r: Router) {
  r.get("/goal-metrics", async () => METRICS);
  r.get("/goals", async (ctx, _p, _b, qs) => goalsWithProgress(ctx, tzOf(qs), qs.all === "1" ? "true" : "status <> 'archived'"));
  r.get("/goals/:id", async (ctx, p, _b, qs) => {
    const g = (await goalsWithProgress(ctx, tzOf(qs), `id = '${id(p.id)}'`))[0];
    if (!g) throw notFound("Goal not found");
    return g;
  });
  // one goal in full, for its page: progress, the run of weeks or months reached, the last twelve of them and what went in
  r.get("/goals/:id/detail", async (ctx, p, _b, qs) => {
    const tz = tzOf(qs);
    const g = (await goalsWithProgress(ctx, tz, `id = '${id(p.id)}'`))[0];
    if (!g) throw notFound("Goal not found");
    const s = await getSettings(ctx.q, ctx.userId), now = ctx.now();
    const { current, best } = await streakOf(ctx.q, g, s, now, tz, g.progress?.done, true);
    const periods = [];
    if (g.period !== "once") for (let i = 11; i >= 0; i--) {
      const w = windowOf(g, now, s, tz, i);
      const value = Math.round((await valueFor(ctx.q, g, w, s, now, tz)) * 10) / 10;
      periods.push({ from: w.fromDay, value, met: value >= g.target });
    }
    return { goal: g, streak: current, best, periods, log: await goalLog(ctx.q, g, windowOf(g, now, s, tz), tz) };
  });
  r.post("/goals", async (ctx, _p, b, qs) => {
    const v = await goalFields(ctx, b);
    const gid = uuidv7();
    await ctx.q.query(
      `INSERT INTO goals (id, user_id, title, scope, scope_id, metric, comparator, target, period, start_date, deadline, notes, days) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [gid, ctx.userId, str(b.title, 120), v.scope, v.scopeId, v.metric, v.comparator, v.target, v.period,
        dateStr(b.startDate) ?? dayIn(ctx.now(), tzOf(qs)), dateStr(b.deadline), str(b.notes, 2000), v.days]);
    ctx.changed("goal");
    return { id: gid, comparator: v.comparator };
  });
  // every field the new-goal form sets can be changed later: progress is worked out from the logged data on each read,
  // so nothing recorded goes stale when what the goal measures changes
  r.put("/goals/:id", async (ctx, p, b) => {
    const row = (await ctx.q.query("SELECT * FROM goals WHERE id = $1", [id(p.id)])).rows[0];
    if (!row) throw notFound("Goal not found");
    const prev = camel<Goal>(row);
    const v = await goalFields(ctx, b, prev);
    // a change to what is measured or the target reopens a goal it had marked achieved; it is re-checked on the next read.
    // A target within rounding of the old one is no change: the form shows it in lb or miles and converts it back.
    const was = Number(prev.target), retargeted = Math.abs(v.target - was) > 1e-3 * Math.max(Math.abs(was), 1e-9);
    const moved = v.metric !== prev.metric || v.scopeId !== prev.scopeId || retargeted || v.comparator !== prev.comparator
      || v.period !== prev.period || v.days !== daysIn(prev.days);
    const status = b.status ? oneOf(b.status, ["active", "achieved", "archived"], "active") : moved && prev.status === "achieved" ? "active" : prev.status;
    const achievedAt = status === "active" ? null : prev.achievedAt;
    await ctx.q.query(
      `UPDATE goals SET title = $2, scope = $3, scope_id = $4, metric = $5, comparator = $6, target = $7, period = $8, days = $9::jsonb, start_date = $10, deadline = $11, notes = $12,
         status = $13, achieved_at = $14 WHERE id = $1`,
      [prev.id, b.title != null ? str(b.title, 120) : prev.title, v.scope, v.scopeId, v.metric, v.comparator, v.target, v.period, v.days,
        "startDate" in b ? dateStr(b.startDate) ?? prev.startDate : prev.startDate, "deadline" in b ? dateStr(b.deadline) : prev.deadline,
        b.notes != null ? str(b.notes, 2000) : prev.notes, status, achievedAt]);
    ctx.changed("goal");
    return { ok: true };
  });
  r.del("/goals/:id", async (ctx, p) => {
    await ctx.q.query("DELETE FROM goals WHERE id = $1", [id(p.id)]);
    ctx.changed("goal");
    return { ok: true };
  });
}
