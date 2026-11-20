// Programs (optional feature): weeks of routines followed in order. Where you are is worked out from the workouts you
// finished since the program started, so skipping the app for a week or logging out of order never breaks it.
// A program with no start date starts with the first of its workouts done after it was made (M-288). Its end is not set:
// it follows from its weeks, the last day of its last week counted from the start (M-289), as its weeks already run on.
import type { Router } from "../router";
import type { Sql } from "../db";
import { camel, id, str, intOrNull, bool, dateStr, visible } from "../util";
import { uuidv7 } from "../ids";
import { notFound, bad } from "../errors";
import { LIFTED_SQL } from "@motus/shared";
import { dayIn } from "./achievements";

interface Week { days: string[]; deload?: boolean }
const DAY = 86400000;

/** From when workouts count: the start date, or with none the moment the program was made (so past workouts never count). */
export const countsFrom = (p: any): string => (p.start_date ? String(p.start_date).slice(0, 10) : new Date(p.created_at ?? Date.now()).toISOString());

/**
 * The program's days: startsOn its start date, or with none the day of its first workout (null until then); endsOn the last
 * day of its last week from there; calendarWeek the week the calendar is in (0 before a set start; a program waiting for its
 * first workout is in week 1, since it starts whenever you do).
 */
export function programDays(p: any, firstAt: string | null, today: string, tzMin: number) {
  const startsOn = p.start_date ? String(p.start_date).slice(0, 10) : firstAt ? dayIn(firstAt, tzMin) : null;
  const weeks = (p.weeks ?? []).length;
  const endsOn = startsOn && weeks ? new Date(Date.parse(startsOn) + (weeks * 7 - 1) * DAY).toISOString().slice(0, 10) : null;
  const from = startsOn ?? today;
  const calendarWeek = today < from ? 0 : Math.floor((Date.parse(today) - Date.parse(from)) / (7 * DAY)) + 1;
  return { startsOn, endsOn, calendarWeek };
}

/** The planned workouts in order, and which finished workout counted for each (walked in time order since the start). */
async function walk(q: Sql, p: any) {
  const weeks: Week[] = p.weeks ?? [];
  const seq = weeks.flatMap((w, wi) => w.days.map((r, di) => ({ routineId: r, week: wi + 1, day: di + 1, deload: !!w.deload })));
  const rows = seq.length ? (await q.query(
    "SELECT id, routine_id, program_id, started_at FROM workouts WHERE status = 'completed' AND started_at >= $1::timestamptz AND (program_id = $2 OR routine_id = ANY($3::uuid[])) ORDER BY started_at",
    [countsFrom(p), p.id, [...new Set(seq.map((s) => s.routineId))]])).rows : [];
  const hit: (string | null)[] = seq.map(() => null);
  const extra: string[] = []; // started from this program but out of order: still the program's, just not a step forward
  let i = 0, firstAt: string | null = null;
  for (const w of rows) {
    if (i < seq.length && w.routine_id === seq[i]!.routineId) hit[i++] = w.id; else if (w.program_id === p.id) extra.push(w.id); else continue;
    firstAt ??= w.started_at;
  }
  const names = new Map((await q.query("SELECT id, name, color FROM routines WHERE id = ANY($1::uuid[])", [[...new Set(seq.map((s) => s.routineId))]])).rows.map((r: any) => [r.id, r]));
  const slots = seq.map((s) => ({ ...s, name: names.get(s.routineId)?.name ?? "Deleted routine", color: names.get(s.routineId)?.color ?? null }));
  return { slots, hit, extra, i, firstAt };
}

export async function programState(q: Sql, p: any) {
  return (await programInfo(q, p, dayIn(new Date(), 0), 0)).state;
}

/** Where you are in the program and its days, from one walk through its workouts. */
export async function programInfo(q: Sql, p: any, today: string, tzMin: number) {
  const { slots, i, firstAt } = await walk(q, p);
  const state = slots.length ? { next: slots[i] ?? null, done: i, total: slots.length, finished: i >= slots.length } : { next: null, done: 0, total: 0 };
  return { state, ...programDays(p, firstAt, today, tzMin) };
}

/** One program in full: the plan week by week with what was done, where you are against the calendar, and totals. */
async function programDetail(q: Sql, p: any, today: string, tzMin: number) {
  const { slots, hit, extra, i, firstAt } = await walk(q, p);
  const { startsOn, endsOn, calendarWeek } = programDays(p, firstAt, today, tzMin);
  const ids = [...hit.filter((x): x is string => !!x), ...extra];
  const ws = new Map((ids.length ? (await q.query(
    `SELECT w.id, w.name, w.started_at, greatest(0, extract(epoch FROM coalesce(w.ended_at, w.started_at) - w.started_at)::int - w.paused_s) AS duration_s,
       coalesce((SELECT sum(${LIFTED_SQL}) FROM workout_sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN exercises e ON e.id = we.exercise_id
                 WHERE we.workout_id = w.id AND s.done AND s.kind <> 'warmup'), 0) AS volume_kg
     FROM workouts w WHERE w.id = ANY($1::uuid[])`, [ids])).rows : []).map((r: any) => [r.id, { ...camel<any>(r), week: null, day: null }]));
  slots.forEach((s, k) => { const w = hit[k] && ws.get(hit[k]!); if (w) Object.assign(w, { week: s.week, day: s.day }); });
  const plan = (p.weeks as Week[]).map((w, wi) => ({ week: wi + 1, deload: !!w.deload, days: [] as any[] }));
  slots.forEach((s, k) => plan[s.week - 1]!.days.push({ ...s, workout: hit[k] ? ws.get(hit[k]!) ?? null : null,
    status: hit[k] ? "done" : k === i ? "next" : s.week < calendarWeek ? "late" : "todo" }));
  // how many should be done by now: every week the calendar has fully passed
  const expected = slots.filter((s) => s.week < calendarWeek).length;
  const per = new Map<string, { routineId: string; name: string; done: number; planned: number }>();
  slots.forEach((s, k) => { const x = per.get(s.routineId) ?? { routineId: s.routineId, name: s.name, done: 0, planned: 0 }; x.planned++; if (hit[k]) x.done++; per.set(s.routineId, x); });
  const all = [...ws.values()];
  return {
    state: { next: slots[i] ?? null, done: i, total: slots.length, finished: !!slots.length && i >= slots.length },
    status: i >= slots.length && slots.length ? "finished" : p.active ? "active" : "paused",
    startsOn, endsOn, calendarWeek, plan,
    stats: { done: i, total: slots.length, weeksDone: plan.filter((w) => w.days.length && w.days.every((d) => d.status === "done")).length, expected,
      adherencePct: expected ? Math.min(100, Math.round((Math.min(i, expected) / expected) * 100)) : null,
      volumeKg: all.reduce((a, w) => a + Number(w.volumeKg), 0), durationS: all.reduce((a, w) => a + Number(w.durationS), 0), perRoutine: [...per.values()] },
    recent: all.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 10),
  };
}

export function programRoutes(r: Router) {
  r.get("/programs", async ({ q }, _p, _b, qs) => {
    const rows = (await q.query("SELECT * FROM programs ORDER BY active DESC, created_at DESC")).rows;
    const tzMin = Number(qs.tz) || 0, today = dayIn(new Date(), tzMin);
    const out = [];
    for (const p of rows) { const c = camel<any>(p); delete c.userId; out.push({ ...c, ...(await programInfo(q, p, today, tzMin)) }); }
    return out;
  });
  r.get("/programs/:id", async ({ q }, p, _b, qs) => {
    const row = (await q.query("SELECT * FROM programs WHERE id = $1", [id(p.id)])).rows[0];
    if (!row) throw notFound("Program not found");
    // today in the app's time zone (tz = its offset from UTC in minutes), so the week turns over at its midnight
    const tzMin = Number(qs.tz) || 0;
    const c = camel<any>(row); delete c.userId;
    return { ...c, ...(await programDetail(q, row, dayIn(new Date(), tzMin), tzMin)) };
  });
  r.post("/programs", async (ctx, _p, b) => {
    const weeks = sanitize(b.weeks);
    for (const w of weeks) for (const rid of w.days) await visible(ctx.q, "routines", rid, "routine");
    const pid = uuidv7();
    await ctx.q.query("INSERT INTO programs (id, user_id, name, description, weeks, deload_pct, start_date, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [pid, ctx.userId, str(b.name, 120).trim() || "Program", str(b.description, 2000), JSON.stringify(weeks), intOrNull(b.deloadPct, 0, 90) ?? 40,
        b.startDate === null ? null : dateStr(b.startDate) ?? new Date().toISOString().slice(0, 10), bool(b.active, true)]);
    ctx.changed("routine");
    return { id: pid };
  });
  r.put("/programs/:id", async (ctx, p, b) => {
    const weeks = b.weeks ? sanitize(b.weeks) : null;
    if (weeks) for (const w of weeks) for (const rid of w.days) await visible(ctx.q, "routines", rid, "routine");
    const { rows } = await ctx.q.query(
      `UPDATE programs SET name = coalesce($2, name), description = coalesce($3, description), weeks = coalesce($4, weeks), deload_pct = coalesce($5, deload_pct),
         start_date = CASE WHEN $8 THEN $6::date ELSE start_date END, active = coalesce($7, active) WHERE id = $1 RETURNING id`,
      // startDate null takes the date away (the program then starts with its first workout); left out, the date stays
      [id(p.id), b.name ? str(b.name, 120) : null, b.description != null ? str(b.description, 2000) : null, weeks ? JSON.stringify(weeks) : null, intOrNull(b.deloadPct, 0, 90),
        dateStr(b.startDate), typeof b.active === "boolean" ? b.active : null, b.startDate === null || dateStr(b.startDate) != null]);
    if (!rows.length) throw notFound("Program not found");
    ctx.changed("routine");
    return { ok: true };
  });
  r.del("/programs/:id", async (ctx, p) => {
    await ctx.q.query("DELETE FROM programs WHERE id = $1", [id(p.id)]);
    ctx.changed("routine");
    return { ok: true };
  });
}

function sanitize(v: unknown): Week[] {
  if (!Array.isArray(v)) throw bad("Expected weeks");
  return v.slice(0, 52).map((w: any) => ({ days: (Array.isArray(w?.days) ? w.days : []).slice(0, 14).map((x: unknown) => id(x, "routine")), deload: !!w?.deload }));
}
