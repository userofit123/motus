// Goals: general, per routine, per exercise, per muscle group, per activity and for the body.
// Progress is worked out from the data each time, so editing a past workout moves the goal too.
import { e1rm, GROUPS, ymd, weekStartOf, type Goal, type GoalProgress, type Settings } from "@motus/shared";
import type { Router, Ctx } from "../router";
import type { Sql } from "../db";
import { camel, id, str, numOrNull, oneOf, dateStr } from "../util";
import { uuidv7 } from "../ids";
import { notFound, bad } from "../errors";
import { getSettings } from "./settings";
import { exerciseSessions } from "./library";

export const METRICS: { scope: Goal["scope"]; metric: string; name: string; unit: string; periodic: boolean; comparator?: ">=" | "<=" }[] = [
  { scope: "general", metric: "workouts", name: "Workouts", unit: "workouts", periodic: true },
  { scope: "general", metric: "active_minutes", name: "Active minutes (workouts and activities)", unit: "min", periodic: true },
  { scope: "general", metric: "streak_weeks", name: "Weeks in a row meeting your weekly goal", unit: "weeks", periodic: false },
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
  { scope: "activity", metric: "activity_distance", name: "Distance", unit: "km", periodic: true },
  { scope: "activity", metric: "activity_count", name: "Number of sessions", unit: "times", periodic: true },
  { scope: "activity", metric: "activity_minutes", name: "Time", unit: "min", periodic: true },
  { scope: "activity", metric: "steps_avg", name: "Average daily steps", unit: "steps", periodic: true },
  { scope: "body", metric: "body_weight", name: "Body weight", unit: "kg", periodic: false, comparator: "<=" },
  { scope: "body", metric: "body_metric", name: "Measurement", unit: "cm", periodic: false, comparator: "<=" },
];

function windowOf(g: Goal, now: Date, s: Settings, offset = 0): { from: string; to: string } {
  if (g.period === "week") {
    const start = new Date(weekStartOf(now, s.firstDay) + "T00:00:00");
    start.setDate(start.getDate() - 7 * offset);
    const end = new Date(start); end.setDate(end.getDate() + 7);
    return { from: start.toISOString(), to: end.toISOString() };
  }
  if (g.period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - offset + 1, 1);
    return { from: start.toISOString(), to: end.toISOString() };
  }
  return { from: new Date(g.startDate + "T00:00:00").toISOString(), to: new Date(now.getTime() + 86400000).toISOString() };
}

async function valueFor(q: Sql, g: Goal, w: { from: string; to: string }, s: Settings, now: Date): Promise<number> {
  const P = [w.from, w.to];
  const one = async (sql: string, params: unknown[]) => Number((await q.query(sql, params)).rows[0]?.v ?? 0);
  const done = "w.status = 'completed' AND w.started_at >= $1 AND w.started_at < $2";
  switch (g.metric) {
    case "workouts": return one(`SELECT count(*) v FROM workouts w WHERE ${done}`, P);
    case "volume": return one(`SELECT coalesce(sum(s.weight_kg*s.reps),0) v FROM workout_sets s JOIN workout_exercises we ON we.id=s.workout_exercise_id JOIN workouts w ON w.id=we.workout_id WHERE ${done} AND s.done AND s.kind<>'warmup'`, P);
    case "active_minutes":
      return (await one(`SELECT coalesce(sum(extract(epoch FROM w.ended_at - w.started_at) - w.paused_s),0)/60 v FROM workouts w WHERE ${done}`, P))
        + (await one(`SELECT coalesce(sum(duration_s),0)/60 v FROM activities WHERE started_at >= $1 AND started_at < $2`, P));
    case "streak_weeks": return streakWeeks(q, s, now);
    case "routine_count": return one(`SELECT count(*) v FROM workouts w WHERE ${done} AND w.routine_id = $3`, [...P, g.scopeId]);
    case "routine_duration": return one(`SELECT coalesce(min(extract(epoch FROM w.ended_at - w.started_at) - w.paused_s)/60, 0) v FROM workouts w WHERE ${done} AND w.routine_id = $3`, [...P, g.scopeId]);
    case "routine_volume":
      return one(`SELECT coalesce(max(v),0) v FROM (SELECT sum(s.weight_kg*s.reps) v FROM workout_sets s JOIN workout_exercises we ON we.id=s.workout_exercise_id JOIN workouts w ON w.id=we.workout_id
        WHERE ${done} AND w.routine_id = $3 AND s.done AND s.kind<>'warmup' GROUP BY w.id) x`, [...P, g.scopeId]);
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
    case "activity_count": return one(`SELECT count(*) v FROM activities WHERE started_at >= $1 AND started_at < $2 AND ($3::text IS NULL OR type = $3)`, [...P, g.scopeId]);
    case "activity_minutes": return (await one(`SELECT coalesce(sum(duration_s),0) v FROM activities WHERE started_at >= $1 AND started_at < $2 AND ($3::text IS NULL OR type = $3)`, [...P, g.scopeId])) / 60;
    case "steps_avg": return one(`SELECT coalesce(avg(value),0) v FROM daily_logs WHERE kind='steps' AND date >= $1::timestamptz::date AND date < $2::timestamptz::date`, P);
    case "body_weight": return one(`SELECT value v FROM body_metrics WHERE kind='weight' ORDER BY measured_at DESC LIMIT 1`, []);
    case "body_metric": return one(`SELECT value v FROM body_metrics WHERE kind=$1 ORDER BY measured_at DESC LIMIT 1`, [g.scopeId]);
  }
  return 0;
}

/** Weeks in a row (ending this week or last) with at least the weekly goal of workouts. */
export async function streakWeeks(q: Sql, s: Settings, now: Date): Promise<number> {
  const { rows } = await q.query("SELECT started_at FROM workouts WHERE status = 'completed' AND started_at > now() - interval '3 years'");
  const per = new Map<string, number>();
  for (const r of rows) { const k = weekStartOf(new Date(r.started_at), s.firstDay); per.set(k, (per.get(k) ?? 0) + 1); }
  const goal = Math.max(1, s.weeklyGoal);
  let n = 0;
  const cur = new Date(weekStartOf(now, s.firstDay) + "T12:00:00");
  // this week counts once it meets the goal; until then the streak runs to last week
  if ((per.get(ymd(cur)) ?? 0) >= goal) n++;
  for (;;) {
    cur.setDate(cur.getDate() - 7);
    if ((per.get(ymd(cur)) ?? 0) >= goal) n++; else break;
  }
  return n;
}

export async function progressOf(q: Sql, g: Goal, s: Settings, now: Date): Promise<GoalProgress> {
  const current = Math.round((await valueFor(q, g, windowOf(g, now, s), s, now)) * 100) / 100;
  const lower = g.comparator === "<=";
  // for "get down to" goals progress runs from the starting value to the target
  let pct: number;
  if (lower) {
    const first = Number((await q.query(g.scope === "body" ? "SELECT value v FROM body_metrics WHERE kind = $1 AND measured_at >= $2 ORDER BY measured_at LIMIT 1" : "SELECT NULL v",
      g.scope === "body" ? [g.metric === "body_weight" ? "weight" : g.scopeId, g.startDate] : [])).rows[0]?.v ?? current);
    pct = current <= g.target ? 1 : first > g.target ? Math.max(0, Math.min(1, (first - current) / (first - g.target))) : 0;
    if (!current) pct = 0;
  } else pct = g.target > 0 ? Math.max(0, Math.min(1, current / g.target)) : 0;
  const done = lower ? current > 0 && current <= g.target : current >= g.target;
  const history: { date: string; value: number }[] = [];
  if (g.period !== "once") {
    for (let i = 7; i >= 0; i--) { const w = windowOf(g, now, s, i); history.push({ date: w.from.slice(0, 10), value: Math.round((await valueFor(q, g, w, s, now)) * 10) / 10 }); }
  } else if (g.scope === "exercise") {
    const ss = (await exerciseSessions(q, g.scopeId!, 30)).reverse();
    for (const x of ss) {
      const v = g.metric === "e1rm" ? x.e1rm : g.metric === "max_weight" ? x.maxWeightKg : g.metric === "max_reps" ? Math.max(0, ...x.sets.map((y: any) => y.reps ?? 0)) : x.durationS;
      if (v) history.push({ date: x.startedAt.slice(0, 10), value: Math.round(v * 10) / 10 });
    }
  } else if (g.scope === "body") {
    const { rows } = await q.query("SELECT measured_at, value FROM body_metrics WHERE kind = $1 ORDER BY measured_at DESC LIMIT 30", [g.metric === "body_weight" ? "weight" : g.scopeId]);
    rows.reverse().forEach((r: any) => history.push({ date: r.measured_at.slice(0, 10), value: Number(r.value) }));
  }
  let pace: string | undefined;
  if (g.period !== "once" && !done && !lower) {
    const left = Math.ceil(g.target - current);
    pace = `${left} more ${g.period === "week" ? "this week" : "this month"}`;
  } else if (g.deadline && !done) {
    const days = Math.ceil((new Date(g.deadline + "T23:59:59").getTime() - now.getTime()) / 86400000);
    pace = days >= 0 ? `${days} day${days === 1 ? "" : "s"} left` : "Deadline passed";
  }
  // a measurement is in cm, except body fat (%)
  const unit = g.metric === "body_metric" && g.scopeId === "body_fat" ? "%" : METRICS.find((m) => m.metric === g.metric)?.unit ?? "";
  return { current, pct, done, label: `${current} / ${g.target} ${unit}`.trim(), unit, history, pace };
}

export async function goalsWithProgress(ctx: Ctx, where = "status <> 'archived'"): Promise<Goal[]> {
  const s = await getSettings(ctx.q, ctx.userId);
  const rows = (await ctx.q.query(`SELECT * FROM goals WHERE ${where} ORDER BY status = 'achieved', created_at DESC`)).rows.map((x: any) => camel<Goal>(x));
  for (const g of rows) {
    g.target = Number(g.target);
    g.progress = await progressOf(ctx.q, g, s, ctx.now());
    // one-off goals are marked achieved the first time they are met
    if (g.status === "active" && g.period === "once" && g.progress.done) {
      await ctx.q.query("UPDATE goals SET status = 'achieved', achieved_at = now() WHERE id = $1", [g.id]);
      g.status = "achieved"; g.achievedAt = ctx.now().toISOString();
    }
  }
  return rows;
}

export function goalRoutes(r: Router) {
  r.get("/goal-metrics", async () => METRICS);
  r.get("/goals", async (ctx, _p, _b, qs) => goalsWithProgress(ctx, qs.all === "1" ? "true" : "status <> 'archived'"));
  r.get("/goals/:id", async (ctx, p) => {
    const g = (await goalsWithProgress(ctx, `id = '${id(p.id)}'`))[0];
    if (!g) throw notFound("Goal not found");
    return g;
  });
  r.post("/goals", async (ctx, _p, b) => {
    const m = METRICS.find((x) => x.metric === b.metric);
    if (!m) throw bad("Pick what to measure");
    const target = numOrNull(b.target, 0, 1e9);
    if (target == null || target <= 0) throw bad("Set a target");
    if (["routine", "exercise", "muscle"].includes(m.scope) && !b.scopeId) throw bad(`Pick the ${m.scope === "muscle" ? "muscle group" : m.scope}`);
    // a body goal heads from where you are now towards the target: up if you're below it, down if above
    let cmp = oneOf(b.comparator, [">=", "<="], m.comparator ?? ">=");
    if (m.scope === "body" && !b.comparator) {
      const now = (await ctx.q.query("SELECT value v FROM body_metrics WHERE kind = $1 ORDER BY measured_at DESC LIMIT 1", [m.metric === "body_weight" ? "weight" : b.scopeId])).rows[0];
      if (now) cmp = Number(now.v) < target ? ">=" : "<=";
    }
    const gid = uuidv7();
    await ctx.q.query(
      `INSERT INTO goals (id, user_id, title, scope, scope_id, metric, comparator, target, period, start_date, deadline, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [gid, ctx.userId, str(b.title, 120), m.scope, b.scopeId ? str(b.scopeId, 80) : null, m.metric, cmp, target,
        m.periodic ? oneOf(b.period, ["once", "week", "month"], "week") : "once", dateStr(b.startDate) ?? ymd(ctx.now()), dateStr(b.deadline), str(b.notes, 2000)]);
    ctx.changed("goal");
    return { id: gid, comparator: cmp };
  });
  r.put("/goals/:id", async (ctx, p, b) => {
    const { rows } = await ctx.q.query(
      `UPDATE goals SET title = coalesce($2, title), target = coalesce($3, target), deadline = CASE WHEN $8::boolean THEN $4 ELSE deadline END, status = coalesce($5, status), notes = coalesce($6, notes),
         period = coalesce($7, period), achieved_at = CASE WHEN $5 = 'active' THEN NULL ELSE achieved_at END WHERE id = $1 RETURNING id`,
      [id(p.id), b.title != null ? str(b.title, 120) : null, numOrNull(b.target, 0, 1e9), dateStr(b.deadline), b.status ? oneOf(b.status, ["active", "achieved", "archived"], "active") : null,
        b.notes != null ? str(b.notes, 2000) : null, b.period ? oneOf(b.period, ["once", "week", "month"], "once") : null, "deadline" in b]);
    if (!rows.length) throw notFound("Goal not found");
    ctx.changed("goal");
    return { ok: true };
  });
  r.del("/goals/:id", async (ctx, p) => {
    await ctx.q.query("DELETE FROM goals WHERE id = $1", [id(p.id)]);
    ctx.changed("goal");
    return { ok: true };
  });
}
