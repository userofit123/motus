// Programs (optional feature): weeks of routines. Where you are is worked out from the workouts you finished since the
// program started, each filling the first open day of its routine (fillDays), so skipping the app for a week or doing a
// week's routines in another order never breaks it; a day can also be set by hand (its workout, or skipped).
// A program with no start date starts with the first of its workouts done after it was made, its date was taken away or
// it started again (counts_from, M-288). Its end is not set:
// it follows from its weeks, the last day of its last week counted from the start (M-289), as its weeks already run on.
import type { Router } from "../router";
import type { Sql } from "../db";
import { camel, id, str, intOrNull, bool, dateStr, visible } from "../util";
import { uuidv7, isUuid } from "../ids";
import { notFound, bad } from "../errors";
import { LIFTED_SQL, programEnd } from "@motus/shared";
import { dayIn } from "./achievements";
import { plannedOpen, addDays } from "./schedule";

/** A day set by hand: the workout that counts for it, or null when it was skipped (M-290). */
interface Mark { routineId: string; workoutId: string | null }
/** marks: by day number (1 = the week's first workout) */
interface Week { days: string[]; deload?: boolean; marks?: Record<string, Mark> }
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

/** A finished workout and what the fill reads of it. */
export interface DoneRow { id: string; routine_id: string | null; program_id: string | null; started_at: string }

/**
 * Which finished workout counts for each planned workout (M-290). A day set by hand keeps its workout ("Choose the
 * workout"), or stays empty when marked skipped. Every other workout, in time order, fills the first open day of its
 * routine: week 1 before week 2, in any order inside a week, so doing Biceps before Triceps never pushes either into a
 * later round. A workout started from the program with no open day left for its routine is still the program's (extra).
 * next is the first open day; the program is finished when none is left. A hand-set workout that's gone counts as unset.
 */
export function fillDays(seq: { routineId: string }[], marks: (Mark | null)[], rows: DoneRow[], programId: string) {
  const has = new Set(rows.map((w) => w.id));
  // a workout set by hand for several days (an old copy of the weeks) counts once, for the first of them
  const seen = new Set<string>();
  const hit: (string | null)[] = seq.map((_, k) => {
    const wid = marks[k]?.workoutId;
    if (!wid || !has.has(wid) || seen.has(wid)) return null;
    seen.add(wid);
    return wid;
  });
  const skipped = seq.map((_, k) => marks[k]?.workoutId === null);
  const set = new Set(hit.filter((x): x is string => !!x));
  const extra: string[] = [];
  for (const w of rows) {
    if (set.has(w.id)) continue;
    const k = seq.findIndex((s, j) => s.routineId === w.routine_id && !hit[j] && !skipped[j]);
    if (k >= 0) hit[k] = w.id; else if (w.program_id === programId) extra.push(w.id);
  }
  const open = seq.findIndex((_, k) => !hit[k] && !skipped[k]);
  return { hit, skipped, extra, i: open < 0 ? seq.length : open, done: hit.filter(Boolean).length };
}

/** The planned workouts in order, and which finished workout counted for each (fillDays). */
export async function walk(q: Sql, p: ProgramRow, tzMin: number) {
  const weeks: Week[] = p.weeks ?? [];
  const seq = weeks.flatMap((w, wi) => w.days.map((r, di) => ({ routineId: r, week: wi + 1, day: di + 1, deload: !!w.deload })));
  // a mark only holds while its day still has the routine it was set for (the week may have been edited since)
  const marks = seq.map((s) => { const m = weeks[s.week - 1]!.marks?.[s.day]; return m && m.routineId === s.routineId ? m : null; });
  const pinned = marks.flatMap((m) => (m?.workoutId ? [m.workoutId] : []));
  // a workout set by hand counts whenever it was done, even before the program's start
  const rows: DoneRow[] = seq.length ? (await q.query(
    `SELECT id, routine_id, program_id, started_at FROM workouts WHERE status = 'completed'
       AND ((started_at >= $1::timestamptz AND (program_id = $2 OR routine_id = ANY($3::uuid[]))) OR id = ANY($4::uuid[])) ORDER BY started_at`,
    [countsFrom(p, tzMin), p.id, [...new Set(seq.map((s) => s.routineId))], pinned])).rows : [];
  const f = fillDays(seq, marks, rows, p.id);
  // set by hand: the chosen workout still counts, or the day was marked skipped
  const byHand = seq.map((_, k) => f.skipped[k]! || (!!marks[k]?.workoutId && f.hit[k] === marks[k]!.workoutId));
  const used = new Set([...f.hit.filter(Boolean), ...f.extra]);
  // the start is the first workout from counts_from on: a workout from before it, set by hand, fills its day but doesn't
  // move the start back (a program with no date would otherwise start, end and fall behind by that old workout)
  const from = Date.parse(countsFrom(p, tzMin));
  const at = rows.filter((w) => used.has(w.id) && new Date(w.started_at).getTime() >= from).map((w) => new Date(w.started_at).toISOString()).sort();
  const names = new Map((await q.query("SELECT id, name, color FROM routines WHERE id = ANY($1::uuid[])", [[...new Set(seq.map((s) => s.routineId))]])).rows.map((r: any) => [r.id, r]));
  const slots = seq.map((s) => ({ ...s, name: names.get(s.routineId)?.name ?? "Deleted routine", color: names.get(s.routineId)?.color ?? null }));
  // finishedAt: when the last day was filled (Achievements), once every day is done or skipped
  const last = f.hit.filter(Boolean).map((x) => rows.find((w) => w.id === x)!.started_at).map((t) => new Date(t).toISOString()).sort().at(-1) ?? null;
  return { slots, ...f, byHand, firstAt: at[0] ?? null, finishedAt: seq.length && f.i >= seq.length ? last : null };
}

/** Where you are in the program and its days, from one walk through its workouts. */
export async function programInfo(q: Sql, p: ProgramRow, today: string, tzMin: number) {
  const { slots, i, done, firstAt } = await walk(q, p, tzMin);
  const state = slots.length ? { next: slots[i] ?? null, done, total: slots.length, finished: i >= slots.length } : { next: null, done: 0, total: 0 };
  return { state, ...programDays(p, firstAt, today, tzMin) };
}

/** One program in full: the plan week by week with what was done, where you are against the calendar, and totals. */
async function programDetail(q: Sql, p: ProgramRow, today: string, tzMin: number) {
  const { slots, hit, skipped, byHand, extra, i, done, firstAt } = await walk(q, p, tzMin);
  const { startsOn, endsOn, calendarWeek } = programDays(p, firstAt, today, tzMin);
  const ids = [...hit.filter((x): x is string => !!x), ...extra];
  const ws = new Map((ids.length ? (await q.query(
    `SELECT w.id, w.name, w.started_at, greatest(0, extract(epoch FROM coalesce(w.ended_at, w.started_at) - w.started_at)::int - w.paused_s) AS duration_s,
       coalesce((SELECT sum(${LIFTED_SQL}) FROM workout_sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN exercises e ON e.id = we.exercise_id
                 WHERE we.workout_id = w.id AND s.done AND s.kind <> 'warmup'), 0) AS volume_kg
     FROM workouts w WHERE w.id = ANY($1::uuid[])`, [ids])).rows : []).map((r: any) => [r.id, { ...camel<any>(r), week: null, day: null }]));
  slots.forEach((s, k) => { const w = hit[k] && ws.get(hit[k]!); if (w) Object.assign(w, { week: s.week, day: s.day }); });
  // planning a routine plans it for the program too: its planned days (the next 12 weeks) go to its open days in order,
  // the same way a workout of it would fill them
  const planned = new Map<string, string[]>();
  for (const x of (await plannedOpen(q, today, addDays(today, 84), tzMin)).sort((a, b) => a.date.localeCompare(b.date)))
    if (x.routineId) planned.set(x.routineId, [...(planned.get(x.routineId) ?? []), x.date]);
  const plan = (p.weeks ?? []).map((w, wi) => ({ week: wi + 1, deload: !!w.deload, days: [] as any[] }));
  slots.forEach((s, k) => {
    const open = !hit[k] && !skipped[k];
    plan[s.week - 1]!.days.push({ ...s, workout: hit[k] ? ws.get(hit[k]!) ?? null : null, byHand: byHand[k],
      plannedOn: open ? planned.get(s.routineId)?.shift() ?? null : null,
      status: hit[k] ? "done" : skipped[k] ? "skipped" : k === i ? "next" : s.week < calendarWeek ? "late" : "todo" });
  });
  // how many should be done by now: every week the calendar has fully passed (a skipped day isn't due)
  const expected = slots.filter((s, k) => s.week < calendarWeek && !skipped[k]).length;
  const per = new Map<string, { routineId: string; name: string; done: number; planned: number }>();
  slots.forEach((s, k) => { const x = per.get(s.routineId) ?? { routineId: s.routineId, name: s.name, done: 0, planned: 0 }; x.planned++; if (hit[k]) x.done++; per.set(s.routineId, x); });
  const all = [...ws.values()];
  const finished = !!slots.length && i >= slots.length;
  return {
    state: { next: slots[i] ?? null, done, total: slots.length, finished },
    status: finished ? "finished" : p.active ? "active" : "paused",
    startsOn, endsOn, calendarWeek, plan,
    stats: { done, total: slots.length, weeksDone: plan.filter((w) => w.days.length && w.days.every((d) => d.status === "done")).length, expected,
      adherencePct: expected ? Math.min(100, Math.round((Math.min(done, expected) / expected) * 100)) : null,
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
    const weeks = await checkMarks(ctx.q, sanitize(b.weeks));
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
    let weeks = b.weeks ? await checkMarks(ctx.q, sanitize(b.weeks)) : null;
    if (weeks) for (const w of weeks) for (const rid of w.days) await visible(ctx.q, "routines", rid, "routine");
    // starting again drops the days set by hand too, so no workout from before counts
    if (b.restart === true) weeks = (weeks ?? (await ctx.q.query("SELECT weeks FROM programs WHERE id = $1", [id(p.id)])).rows[0]?.weeks ?? []).map((w: Week) => ({ days: w.days, deload: !!w.deload }));
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
  // one day of the plan set by hand (M-290): workoutId counts that workout for it, null marks it skipped, and auto
  // gives it back to the automatic fill
  r.put("/programs/:id/days", async (ctx, p, b) => {
    const row = (await ctx.q.query("SELECT weeks FROM programs WHERE id = $1", [id(p.id)])).rows[0];
    if (!row) throw notFound("Program not found");
    const weeks: Week[] = row.weeks ?? [];
    const week = intOrNull(b.week, 1, 52), day = intOrNull(b.day, 1, 14);
    const w = week ? weeks[week - 1] : undefined, routineId = w && day ? w.days[day - 1] : undefined;
    if (!w || !routineId) throw bad("No such day in this program");
    let mark: Mark | null = null;
    if (b.auto !== true && b.workoutId === null) mark = { routineId, workoutId: null };
    else if (b.auto !== true) {
      const wid = id(b.workoutId, "workout");
      // only a finished workout of this day's routine can count for it
      const wk = (await ctx.q.query("SELECT routine_id, status FROM workouts WHERE id = $1", [wid])).rows[0] as { routine_id: string | null; status: string } | undefined;
      if (!wk) throw bad("Unknown workout");
      if (wk.status !== "completed" || wk.routine_id !== routineId) throw bad("Only a finished workout of this routine can count for this day");
      // one workout counts for one day: choosing it here takes it from a day it was set for by hand
      for (const x of weeks) for (const [k, m] of Object.entries(x.marks ?? {})) if (m.workoutId === wid) delete x.marks![k];
      mark = { routineId, workoutId: wid };
    }
    const marks = { ...(w.marks ?? {}) };
    if (mark) marks[day!] = mark; else delete marks[day!];
    weeks[week! - 1] = { ...w, marks };
    await ctx.q.query("UPDATE programs SET weeks = $2 WHERE id = $1", [id(p.id), JSON.stringify(await checkMarks(ctx.q, sanitize(weeks)))]);
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
  return v.slice(0, 52).map((w: any) => {
    const days: string[] = (Array.isArray(w?.days) ? w.days : []).slice(0, 14).map((x: unknown) => id(x, "routine"));
    return { days, deload: !!w?.deload, ...withMarks(days, w?.marks) };
  });
}

/**
 * Days set by hand as sent keep only workouts that can count: the person's own (row-level security, as visible()),
 * finished, and of that day's routine; a workout sent for several days keeps the first of them. Others go back to
 * counting automatically.
 */
async function checkMarks(q: Sql, weeks: Week[]): Promise<Week[]> {
  const ids = [...new Set(weeks.flatMap((w) => Object.values(w.marks ?? {}).flatMap((m) => (m.workoutId ? [m.workoutId] : []))))];
  if (!ids.length) return weeks;
  const ok = new Map((await q.query("SELECT id, routine_id FROM workouts WHERE status = 'completed' AND id = ANY($1::uuid[])", [ids])).rows.map((r: any) => [r.id, r.routine_id]));
  const seen = new Set<string>();
  return weeks.map((w) => {
    if (!w.marks) return w;
    const marks: Record<string, Mark> = {};
    for (const k of Object.keys(w.marks).sort((a, b) => Number(a) - Number(b))) {
      const m = w.marks[k]!;
      if (m.workoutId && (ok.get(m.workoutId) !== m.routineId || seen.has(m.workoutId))) continue;
      if (m.workoutId) seen.add(m.workoutId);
      marks[k] = m;
    }
    const { marks: _, ...rest } = w;
    return Object.keys(marks).length ? { ...rest, marks } : rest;
  });
}

/** The marks a week keeps: only those whose day still holds the routine they were set for (an edit can move days). */
function withMarks(days: string[], v: unknown): { marks?: Record<string, Mark> } {
  if (!v || typeof v !== "object") return {};
  const marks: Record<string, Mark> = {};
  for (const [k, m] of Object.entries(v as Record<string, any>))
    if (days[Number(k) - 1] && m?.routineId === days[Number(k) - 1] && (m.workoutId === null || isUuid(m.workoutId))) marks[k] = { routineId: m.routineId, workoutId: m.workoutId };
  return Object.keys(marks).length ? { marks } : {};
}
