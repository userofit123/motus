// Programs (optional feature): weeks of routines followed in order. Where you are is worked out from the workouts you
// finished since the program started, so skipping the app for a week or logging out of order never breaks it.
// A program with no start date starts with the first of its workouts done after it was made, its date was taken away or
// it started again (counts_from, M-288). Its end is not set:
// it follows from its weeks, the last day of its last week counted from the start (M-289), as its weeks already run on.
import type { Router } from "../router";
import type { Sql } from "../db";
import { camel, id, str, intOrNull, bool, dateStr, visible } from "../util";
import { uuidv7 } from "../ids";
import { notFound, bad } from "../errors";
import { LIFTED_SQL, programEnd } from "@motus/shared";
import { dayIn } from "./achievements";

interface Week { days: string[]; deload?: boolean }
const DAY = 86400000;

/** A program's row as stored, with what the walk through its workouts reads. */
export interface ProgramRow { id: string; weeks: Week[] | null; start_date: string | null; counts_from: string | Date | null; created_at: string | Date; active?: boolean; deload_pct?: number }

/**
 * From when workouts count: the start date from the app's midnight (tzMin: minutes behind UTC, as dayIn), or with no date
 * the moment it was last set to count afresh (made, date taken away, started again: counts_from), else when it was made.
 * A dated program started again today counts from that moment (counts_from, the later of the two), so workouts done
 * earlier today no longer count, as the confirm says; setting another date clears it.
 */
export function countsFrom(p: Pick<ProgramRow, "start_date" | "counts_from" | "created_at">, tzMin: number): string {
  if (!p.start_date) return new Date(p.counts_from ?? p.created_at ?? Date.now()).toISOString();
  const midnight = Date.parse(String(p.start_date).slice(0, 10) + "T00:00:00Z") + tzMin * 60000;
  return new Date(Math.max(midnight, p.counts_from ? new Date(p.counts_from).getTime() : midnight)).toISOString();
}

/**
 * The program's days: startsOn its start date, or with none the day of its first workout (null until then); endsOn the last
 * day of its last week from there (programEnd); calendarWeek the week the calendar is in (0 before a set start; a program
 * waiting for its first workout is in week 1, since it starts whenever you do).
 */
export function programDays(p: Pick<ProgramRow, "start_date" | "weeks">, firstAt: string | null, today: string, tzMin: number) {
  const startsOn = p.start_date ? String(p.start_date).slice(0, 10) : firstAt ? dayIn(firstAt, tzMin) : null;
  const endsOn = programEnd(startsOn, (p.weeks ?? []).length);
  const from = startsOn ?? today;
  const calendarWeek = today < from ? 0 : Math.floor((Date.parse(today) - Date.parse(from)) / (7 * DAY)) + 1;
  return { startsOn, endsOn, calendarWeek };
}

/** The planned workouts in order, and which finished workout counted for each (walked in time order since the start). */
async function walk(q: Sql, p: ProgramRow, tzMin: number) {
  const weeks: Week[] = p.weeks ?? [];
  const seq = weeks.flatMap((w, wi) => w.days.map((r, di) => ({ routineId: r, week: wi + 1, day: di + 1, deload: !!w.deload })));
  const rows = seq.length ? (await q.query(
    "SELECT id, routine_id, program_id, started_at FROM workouts WHERE status = 'completed' AND started_at >= $1::timestamptz AND (program_id = $2 OR routine_id = ANY($3::uuid[])) ORDER BY started_at",
    [countsFrom(p, tzMin), p.id, [...new Set(seq.map((s) => s.routineId))]])).rows : [];
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

/** Where you are in the program and its days, from one walk through its workouts. */
export async function programInfo(q: Sql, p: ProgramRow, today: string, tzMin: number) {
  const { slots, i, firstAt } = await walk(q, p, tzMin);
  const state = slots.length ? { next: slots[i] ?? null, done: i, total: slots.length, finished: i >= slots.length } : { next: null, done: 0, total: 0 };
  return { state, ...programDays(p, firstAt, today, tzMin) };
}

/** One program in full: the plan week by week with what was done, where you are against the calendar, and totals. */
async function programDetail(q: Sql, p: ProgramRow, today: string, tzMin: number) {
  const { slots, hit, extra, i, firstAt } = await walk(q, p, tzMin);
  const { startsOn, endsOn, calendarWeek } = programDays(p, firstAt, today, tzMin);
  const ids = [...hit.filter((x): x is string => !!x), ...extra];
  const ws = new Map((ids.length ? (await q.query(
    `SELECT w.id, w.name, w.started_at, greatest(0, extract(epoch FROM coalesce(w.ended_at, w.started_at) - w.started_at)::int - w.paused_s) AS duration_s,
       coalesce((SELECT sum(${LIFTED_SQL}) FROM workout_sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN exercises e ON e.id = we.exercise_id
                 WHERE we.workout_id = w.id AND s.done AND s.kind <> 'warmup'), 0) AS volume_kg
     FROM workouts w WHERE w.id = ANY($1::uuid[])`, [ids])).rows : []).map((r: any) => [r.id, { ...camel<any>(r), week: null, day: null }]));
  slots.forEach((s, k) => { const w = hit[k] && ws.get(hit[k]!); if (w) Object.assign(w, { week: s.week, day: s.day }); });
  const plan = (p.weeks ?? []).map((w, wi) => ({ week: wi + 1, deload: !!w.deload, days: [] as any[] }));
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
    const start = b.startDate === null ? null : dateStr(b.startDate) ?? new Date().toISOString().slice(0, 10);
    await ctx.q.query("INSERT INTO programs (id, user_id, name, description, weeks, deload_pct, start_date, active, counts_from) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [pid, ctx.userId, str(b.name, 120).trim() || "Program", str(b.description, 2000), JSON.stringify(weeks), intOrNull(b.deloadPct, 0, 90) ?? 40,
        start, bool(b.active, true), start ? null : ctx.now().toISOString()]);
    ctx.changed("routine");
    return { id: pid };
  });
  r.put("/programs/:id", async (ctx, p, b) => {
    const weeks = b.weeks ? sanitize(b.weeks) : null;
    if (weeks) for (const w of weeks) for (const rid of w.days) await visible(ctx.q, "routines", rid, "routine");
    // startDate null takes the date away and left out keeps it. With no date the program starts with the first workout
    // done from then on (counts_from = now), so workouts from before a date was set never count again. restart (Start
    // again from week 1) does the same: with no date it stays without one; with a date (today) workouts done earlier today
    // stay out too. A different date counts from its midnight again (counts_from cleared); saving the same date keeps it.
    const setDate = b.startDate === null || dateStr(b.startDate) != null;
    const { rows } = await ctx.q.query(
      `UPDATE programs SET name = coalesce($2, name), description = coalesce($3, description), weeks = coalesce($4, weeks), deload_pct = coalesce($5, deload_pct),
         start_date = CASE WHEN $8 THEN $6::date ELSE start_date END, active = coalesce($7, active),
         counts_from = CASE WHEN $9 OR ($8 AND $6::date IS NULL AND start_date IS NOT NULL) THEN $10::timestamptz
           WHEN $8 AND $6::date IS NOT NULL AND start_date IS DISTINCT FROM $6::date THEN NULL ELSE counts_from END
       WHERE id = $1 RETURNING id`,
      [id(p.id), b.name ? str(b.name, 120) : null, b.description != null ? str(b.description, 2000) : null, weeks ? JSON.stringify(weeks) : null, intOrNull(b.deloadPct, 0, 90),
        dateStr(b.startDate), typeof b.active === "boolean" ? b.active : null, setDate, b.restart === true, ctx.now().toISOString()]);
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
