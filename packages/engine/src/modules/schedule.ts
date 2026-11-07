// Schedules ("Leg day every Sunday and Wednesday at 18:00") and the calendar.
// Upcoming days are worked out from the rules each time, never stored ahead, so a skipped day stays skipped.
import type { Schedule } from "@motus/shared";
import type { Router } from "../router";
import type { Sql } from "../db";
import { camel, id, optId, str, intOrNull, oneOf, dateStr, visible, tzOf } from "../util";
import { dayIn } from "./achievements";
import { uuidv7 } from "../ids";
import { bad } from "../errors";

const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = (d: string) => new Date(d + "T12:00:00Z").getUTCDay();
const daysBetween = (a: string, b: string) => Math.round((new Date(b + "T12:00:00Z").getTime() - new Date(a + "T12:00:00Z").getTime()) / 86400000);

/** Every date a schedule falls on between from and to (inclusive), after skips and moves. */
export function occurrences(s: Schedule, exceptions: { date: string; kind: string; movedTo: string | null }[], from: string, to: string): string[] {
  const out = new Set<string>();
  const start = s.startDate > from ? s.startDate : from;
  const end = s.endDate && s.endDate < to ? s.endDate : to;
  if (s.active) {
    if (s.rule === "once") { if (s.startDate >= from && s.startDate <= to) out.add(s.startDate); }
    else for (let d = start; d <= end; d = addDays(d, 1)) {
      if (s.rule === "weekly" && s.days.includes(dow(d))) out.add(d);
      if (s.rule === "interval" && (s.intervalDays ?? 0) > 0 && daysBetween(s.startDate, d) % s.intervalDays! === 0) out.add(d);
    }
  }
  for (const e of exceptions) {
    out.delete(e.date);
    if (e.kind === "moved" && e.movedTo && e.movedTo >= from && e.movedTo <= to) out.add(e.movedTo);
  }
  return [...out].sort();
}

async function scheduleList(q: Sql): Promise<(Schedule & { exceptions: any[] })[]> {
  const { rows } = await q.query(`SELECT s.*, coalesce(r.name, initcap(s.activity_type)) AS name, r.color FROM schedules s LEFT JOIN routines r ON r.id = s.routine_id
    WHERE s.routine_id IS NULL OR r.deleted_at IS NULL ORDER BY s.created_at`);
  const ex = (await q.query("SELECT schedule_id, date, kind, moved_to FROM schedule_exceptions")).rows;
  return rows.map((r: any) => ({ ...camel<Schedule>(r), color: r.color, exceptions: ex.filter((e: any) => e.schedule_id === r.id).map((e: any) => ({ date: e.date, kind: e.kind, movedTo: e.moved_to })) }));
}

async function plannedBetween(q: Sql, from: string, to: string) {
  const list = await scheduleList(q);
  // soonest first (Home's "Up next" keeps the first few); on one day timed plans in time order, then those with no time
  return list.flatMap((s) => occurrences(s, s.exceptions, from, to).map((date) => ({
    scheduleId: s.id, date, routineId: s.routineId, activityType: s.activityType, name: s.name ?? "Planned", color: (s as any).color ?? null, timeOfDay: s.timeOfDay, remindMin: s.remindMin,
  }))).sort((a, b) => { const x = a.date + (a.timeOfDay ?? "~"), y = b.date + (b.timeOfDay ?? "~"); return x < y ? -1 : x > y ? 1 : 0; });
}

type Planned = Awaited<ReturnType<typeof plannedBetween>>[number];
type DoneW = { routineId: string | null; scheduleId: string | null; scheduledDate: string | null; startedAt: string };
type DoneA = { type: string; startedAt: string };

/** Whether a planned day is already done, so the calendar and Home show what was done instead of the plan as well.
 * A workout started from that very plan counts on the planned day even when done on another; otherwise a workout of
 * the planned routine, or an activity of the planned type, on that day in the app's time zone. */
function planDone(p: Planned, workouts: DoneW[], activities: DoneA[], tzMin: number): boolean {
  if (workouts.some((w) => w.scheduleId === p.scheduleId && w.scheduledDate === p.date)) return true;
  // routineId and activityType are each null on the other kind of plan: never let null match null (a free workout isn't a walk)
  if (p.routineId) return workouts.some((w) => w.routineId === p.routineId && dayIn(w.startedAt, tzMin) === p.date);
  if (p.activityType) return activities.some((a) => a.type === p.activityType && dayIn(a.startedAt, tzMin) === p.date);
  return false;
}

/** Planned days between from and to that aren't done yet. */
export async function plannedOpen(q: Sql, from: string, to: string, tzMin: number) {
  const planned = await plannedBetween(q, from, to);
  if (!planned.length) return planned;
  // a day either side, as the app's day can start up to 14 hours before or after UTC's
  const lo = addDays(from, -1), hi = addDays(to, 2);
  const workouts = (await q.query(
    `SELECT routine_id, schedule_id, scheduled_date, started_at FROM workouts
     WHERE status <> 'discarded' AND ((started_at >= $1::date AND started_at < $2::date) OR scheduled_date BETWEEN $3 AND $4)`, [lo, hi, from, to])).rows.map((x: any) => camel<DoneW>(x));
  const activities = (await q.query("SELECT type, started_at FROM activities WHERE started_at >= $1::date AND started_at < $2::date", [lo, hi])).rows.map((x: any) => camel<DoneA>(x));
  return planned.filter((p) => !planDone(p, workouts, activities, tzMin));
}

export function scheduleRoutes(r: Router) {
  r.get("/schedules", async ({ q }) => scheduleList(q));
  r.post("/schedules", async (ctx, _p, b) => {
    const sid = uuidv7();
    const rule = oneOf(b.rule, ["once", "weekly", "interval"], "weekly");
    const days = Array.isArray(b.days) ? b.days.map(Number).filter((d: number) => d >= 0 && d <= 6) : [];
    if (rule === "weekly" && !days.length) throw bad("Pick at least one day");
    if (!b.routineId && !b.activityType) throw bad("Pick a routine or an activity");
    await visible(ctx.q, "routines", optId(b.routineId), "routine");
    await ctx.q.query(
      `INSERT INTO schedules (id, user_id, routine_id, activity_type, rule, days, interval_days, start_date, end_date, time_of_day, remind_min, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)`,
      [sid, ctx.userId, optId(b.routineId), b.activityType ? str(b.activityType, 40) : null, rule, days, intOrNull(b.intervalDays, 1, 365), dateStr(b.startDate) ?? new Date().toISOString().slice(0, 10),
        dateStr(b.endDate), b.timeOfDay ? str(b.timeOfDay, 5) : null, intOrNull(b.remindMin, 0, 1440)]);
    ctx.changed("schedule");
    return { id: sid };
  });
  r.put("/schedules/:id", async (ctx, p, b) => {
    await ctx.q.query(
      `UPDATE schedules SET rule = coalesce($2, rule), days = coalesce($3, days), interval_days = $4, start_date = coalesce($5, start_date), end_date = $6,
         time_of_day = $7, remind_min = $8, active = coalesce($9, active) WHERE id = $1`,
      [id(p.id), b.rule ? oneOf(b.rule, ["once", "weekly", "interval"], "weekly") : null, Array.isArray(b.days) ? b.days.map(Number) : null, intOrNull(b.intervalDays, 1, 365),
        dateStr(b.startDate), dateStr(b.endDate), b.timeOfDay ? str(b.timeOfDay, 5) : null, intOrNull(b.remindMin, 0, 1440), typeof b.active === "boolean" ? b.active : null]);
    ctx.changed("schedule");
    return { ok: true };
  });
  r.del("/schedules/:id", async (ctx, p) => {
    await ctx.q.query("DELETE FROM schedules WHERE id = $1", [id(p.id)]);
    ctx.changed("schedule");
    return { ok: true };
  });
  // skip one day, or move it to another day
  r.post("/schedules/:id/exception", async (ctx, p, b) => {
    const date = dateStr(b.date);
    if (!date) throw bad("Missing date");
    if (b.clear) await ctx.q.query("DELETE FROM schedule_exceptions WHERE schedule_id = $1 AND date = $2", [id(p.id), date]);
    else await ctx.q.query(
      `INSERT INTO schedule_exceptions (schedule_id, user_id, date, kind, moved_to) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (schedule_id, date) DO UPDATE SET kind = $4, moved_to = $5`,
      [id(p.id), ctx.userId, date, b.movedTo ? "moved" : "skipped", dateStr(b.movedTo)]);
    ctx.changed("schedule");
    return { ok: true };
  });

  // the calendar: done workouts and activities (times, bucketed into days by the app in its own time zone) and the planned
  // days not done yet (a done plan shows as what was done, not twice)
  r.get("/calendar", async ({ q }, _p, _b, qs) => {
    const from = dateStr(qs.from), to = dateStr(qs.to);
    if (!from || !to) throw bad("from and to are required");
    const lo = addDays(from, -1), hi = addDays(to, 2);
    const workouts = (await q.query(
      `SELECT w.id, w.name, w.routine_id, w.started_at, w.status, r.color,
         greatest(0, extract(epoch FROM coalesce(w.ended_at, now()) - w.started_at)::int - w.paused_s) AS duration_s,
         (SELECT count(*) FROM workout_sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id WHERE we.workout_id = w.id AND s.done) AS sets
       FROM workouts w LEFT JOIN routines r ON r.id = w.routine_id WHERE w.status <> 'discarded' AND w.started_at >= $1::date AND w.started_at < $2::date ORDER BY w.started_at`, [lo, hi])).rows.map((x: any) => camel(x));
    const activities = (await q.query(
      `SELECT id, type, name, started_at, duration_s, distance_m FROM activities WHERE started_at >= $1::date AND started_at < $2::date ORDER BY started_at`, [lo, hi])).rows.map((x: any) => camel(x));
    const planned = await plannedOpen(q, from, to, tzOf(qs));
    return { workouts, activities, planned };
  });
}
