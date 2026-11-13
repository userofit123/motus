// Stats and the home summary. Sessions come back with their times; the apps group them into days and weeks in their own time zone.
import { e1rm, GROUPS, WEEKLY_SET_RANGE, liftedKg, LIFTED_SQL, TRACKING_SQL } from "@motus/shared";
import type { Router, Ctx } from "../router";
import type { Sql } from "../db";
import { camel, startOfDay, tzOf } from "../util";
import { getSettings } from "./settings";
import { goalsWithProgress, ensureStarterGoal } from "./goals";
import { stepsByDay } from "./activities";
import { achievements, currentStreak, dayIn, weekIn } from "./achievements";
import { plannedMarked } from "./schedule";
import { workoutSummaries, recentRecords } from "./workouts";
import { routineSummaries } from "./routines";
import { suggestions } from "./suggest";
import { programState } from "./programs";

/** Every completed workout in a range, with its totals and sets per muscle. */
async function workoutRows(q: Sql, from: string, to: string) {
  const { rows } = await q.query(
    `SELECT w.id, w.name, w.routine_id, w.started_at, r.color, greatest(0, extract(epoch FROM w.ended_at - w.started_at)::int - w.paused_s) AS duration_s,
       coalesce(sum(${LIFTED_SQL}) FILTER (WHERE s.kind <> 'warmup'), 0) AS volume_kg,
       count(s.id) FILTER (WHERE s.kind <> 'warmup') AS sets, coalesce(sum(s.reps) FILTER (WHERE s.kind <> 'warmup'), 0) AS reps,
       count(DISTINCT we.id) FILTER (WHERE we.status = 'skipped') AS skipped, count(DISTINCT we.id) AS exercises
     FROM workouts w LEFT JOIN routines r ON r.id = w.routine_id
     LEFT JOIN workout_exercises we ON we.workout_id = w.id LEFT JOIN exercises e ON e.id = we.exercise_id
     LEFT JOIN workout_sets s ON s.workout_exercise_id = we.id AND s.done
     WHERE w.status = 'completed' AND w.started_at >= $1 AND w.started_at < $2
     GROUP BY w.id, r.color ORDER BY w.started_at`, [from, to]);
  const musc = (await q.query(
    `SELECT we.workout_id, e.primary_muscles, e.secondary_muscles, count(s.id) AS n
     FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id JOIN exercises e ON e.id = we.exercise_id
     JOIN workout_sets s ON s.workout_exercise_id = we.id AND s.done AND s.kind <> 'warmup'
     WHERE w.status = 'completed' AND w.started_at >= $1 AND w.started_at < $2 GROUP BY we.workout_id, e.id`, [from, to])).rows;
  return rows.map((r: any) => {
    const muscles: Record<string, number> = {}, primary = new Set<string>(), secondary = new Set<string>();
    for (const m of musc.filter((x: any) => x.workout_id === r.id)) {
      for (const p of m.primary_muscles) { muscles[p] = (muscles[p] ?? 0) + Number(m.n); primary.add(p); }
      for (const p of m.secondary_muscles) { muscles[p] = (muscles[p] ?? 0) + Number(m.n) * 0.5; secondary.add(p); }
    }
    return { ...camel<any>(r), primary: [...primary], secondary: [...secondary], durationS: Number(r.duration_s), volumeKg: Number(r.volume_kg), sets: Number(r.sets), reps: Number(r.reps), skipped: Number(r.skipped), exercises: Number(r.exercises), muscles };
  });
}

async function exerciseStats(q: Sql, from: string, to: string) {
  const { rows } = await q.query(
    `SELECT e.id, e.name, e.primary_muscles, ${TRACKING_SQL} AS tracking, w.id AS workout_id, w.started_at, we.status,
       coalesce(json_agg(json_build_object('w', s.weight_kg, 'r', s.reps, 'd', s.duration_s, 'm', s.distance_m)) FILTER (WHERE s.id IS NOT NULL), '[]') AS sets
     FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id JOIN exercises e ON e.id = we.exercise_id LEFT JOIN exercise_prefs p ON p.exercise_id = e.id
     LEFT JOIN workout_sets s ON s.workout_exercise_id = we.id AND s.done AND s.kind <> 'warmup'
     WHERE w.status = 'completed' AND w.started_at >= $1 AND w.started_at < $2
     GROUP BY e.id, w.id, we.id, p.tracking ORDER BY w.started_at`, [from, to]);
  const by = new Map<string, any>();
  for (const r of rows) {
    const x = by.get(r.id) ?? { exerciseId: r.id, name: r.name, muscles: r.primary_muscles, tracking: r.tracking, times: 0, skipped: 0, lastAt: null, bestE1rm: 0, bestWeightKg: 0, volumeKg: 0, trend: [] as any[] };
    by.set(r.id, x);
    if (r.status === "skipped") { x.skipped++; continue; }
    x.times++;
    x.lastAt = r.started_at;
    const sets = r.sets as any[];
    const best = Math.max(0, ...sets.map((s) => e1rm(Number(s.w), s.r) ?? 0));
    const top = Math.max(0, ...sets.map((s) => Number(s.w) || 0));
    x.bestE1rm = Math.max(x.bestE1rm, best);
    x.bestWeightKg = Math.max(x.bestWeightKg, top);
    x.volumeKg += sets.reduce((a, s) => a + liftedKg(s.w, s.r, r.tracking), 0);
    x.trend.push({ at: r.started_at, e1rm: Math.round(best * 10) / 10, top, reps: sets.reduce((a, s) => a + (s.r ?? 0), 0) });
  }
  // stalled: done 4+ times and the best of the last 4 sessions is no better than before them
  for (const x of by.values()) {
    const t = x.trend as any[];
    const metric = (p: any) => p.e1rm || p.reps;
    if (t.length >= 5) {
      const last4 = Math.max(...t.slice(-4).map(metric)), before = Math.max(...t.slice(0, -4).map(metric));
      x.stalled = last4 <= before;
    } else x.stalled = false;
    const first = t[0] ? metric(t[0]) : 0, lastV = t.at(-1) ? metric(t.at(-1)) : 0;
    x.change = first ? (lastV - first) / first : 0;
  }
  return [...by.values()];
}

export function statsRoutes(r: Router) {
  r.get("/stats", async (ctx, _p, _b, qs) => {
    const to = qs.to || new Date(ctx.now().getTime() + 86400000).toISOString();
    const from = qs.from || "1970-01-01";
    const workouts = await workoutRows(ctx.q, from, to);
    const activities = (await ctx.q.query(
      "SELECT id, type, name, started_at, duration_s, distance_m, steps, elevation_m FROM activities WHERE started_at >= $1 AND started_at < $2 ORDER BY started_at", [from, to])).rows.map((x: any) => camel(x));
    const exercises = await exerciseStats(ctx.q, from, to);
    const routines = new Map<string, any>();
    for (const w of workouts) {
      if (!w.routineId) continue;
      const x = routines.get(w.routineId) ?? { routineId: w.routineId, name: w.name, color: w.color, times: 0, totalS: 0, volumeKg: 0, skipped: 0, exercises: 0, trend: [] as any[] };
      routines.set(w.routineId, x);
      x.times++; x.totalS += w.durationS; x.volumeKg += w.volumeKg; x.skipped += w.skipped; x.exercises += w.exercises;
      x.trend.push({ at: w.startedAt, durationS: w.durationS, volumeKg: w.volumeKg });
    }
    const est = new Map((await routineSummaries(ctx.q, ctx.userId)).map((r) => [r.id, r]));
    const routineList = [...routines.values()].map((x) => ({ ...x, name: est.get(x.routineId)?.name ?? x.name, avgDurationS: Math.round(x.totalS / x.times), estimateS: est.get(x.routineId)?.estimateS ?? null, skipRate: x.exercises ? x.skipped / x.exercises : 0 }));
    const muscles: Record<string, number> = {};
    for (const w of workouts) for (const [m, n] of Object.entries(w.muscles as Record<string, number>)) muscles[m] = (muscles[m] ?? 0) + n;
    const body = (await ctx.q.query("SELECT kind, value, measured_at FROM body_metrics ORDER BY measured_at")).rows.map((x: any) => camel(x));
    // steps with the recorded activities counted in, by the app's calendar (tz), as on Home and in goals
    const fromDay = from === "1970-01-01" ? "2000-01-01" : dayIn(from, tzOf(qs));
    const daily: { date: string | Date; kind: string; value: number | string }[] = [
      ...(await ctx.q.query<{ date: string | Date; kind: string; value: number | string }>("SELECT date, kind, value FROM daily_logs WHERE date >= $1::date AND kind <> 'steps'", [fromDay])).rows,
      ...(await stepsByDay(ctx.q, fromDay, null, tzOf(qs)))].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return { from, to, workouts, activities, exercises, routines: routineList, muscles, groups: GROUPS, weeklyRange: WEEKLY_SET_RANGE, body, daily };
  });

  r.get("/home", async (ctx, _p, _b, qs) => {
    await ensureStarterGoal(ctx.q, ctx.userId); // before reading settings: it may add the starter goal to Home
    const s = await getSettings(ctx.q, ctx.userId);
    const now = ctx.now();
    // the app's offset from UTC, so "this week" and "today" match its calendar. Dates are worked out in UTC from the
    // shifted time: this also runs in the app's own copy, where the process's time zone is the person's, not UTC
    const tzMin = Number(qs.tz) || 0;
    const weekStart = weekIn(now, tzMin, s.firstDay);
    const ws = new Date(new Date(weekStart + "T00:00:00Z").getTime() + tzMin * 60000);
    const eightAgo = new Date(ws.getTime() - 7 * 7 * 86400000);
    const rows = await workoutRows(ctx.q, eightAgo.toISOString(), new Date(now.getTime() + 86400000).toISOString());
    const acts = (await ctx.q.query("SELECT type, started_at, duration_s, distance_m, steps FROM activities WHERE started_at >= $1", [eightAgo.toISOString()])).rows;
    const weeks = Array.from({ length: 8 }, (_, i) => {
      const a = new Date(eightAgo.getTime() + i * 7 * 86400000), b = new Date(a.getTime() + 7 * 86400000);
      const w = rows.filter((x) => new Date(x.startedAt) >= a && new Date(x.startedAt) < b);
      const ac = acts.filter((x: any) => new Date(x.started_at) >= a && new Date(x.started_at) < b);
      return {
        start: a.toISOString(), workouts: w.length, volumeKg: w.reduce((t, x) => t + x.volumeKg, 0),
        timeS: w.reduce((t, x) => t + x.durationS, 0) + ac.reduce((t: number, x: any) => t + x.duration_s, 0),
        walkM: ac.filter((x: any) => x.type === "walk").reduce((t: number, x: any) => t + Number(x.distance_m ?? 0), 0),
      };
    });
    // condition: sets per muscle this past week, today and the 6 days before on the app's calendar, the same days Home's
    // muscle groups count as worked this week. tzMin is today's offset, so in the week after a clock change the window
    // starts an hour off from that day's real local midnight, and a workout in that hour can disagree with the groups' dots
    const today = dayIn(now, tzMin);
    const weekAgo = new Date(startOfDay(today, tzMin).getTime() - 6 * 86400000);
    const recent = rows.filter((x) => new Date(x.startedAt) >= weekAgo);
    const muscles7: Record<string, number> = {};
    for (const w of recent) for (const [m, n] of Object.entries(w.muscles as Record<string, number>)) muscles7[m] = (muscles7[m] ?? 0) + n;
    // for the muscle figure: worked as a main muscle this week, and worked only as a helper
    const main7 = [...new Set(recent.flatMap((w) => w.primary))];
    const helpers7 = [...new Set(recent.flatMap((w) => w.secondary))].filter((m) => !main7.includes(m));
    const lastByGroup = (await ctx.q.query(
      `SELECT unnest(e.primary_muscles) AS m, max(w.started_at) AS at FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id JOIN exercises e ON e.id = we.exercise_id
       WHERE w.status = 'completed' AND we.status <> 'skipped' GROUP BY 1`)).rows;
    const groupDays = GROUPS.filter((g) => g.id !== "neck").map((g) => {
      const at = lastByGroup.filter((x: any) => g.muscles.includes(x.m)).map((x: any) => x.at).sort().at(-1) ?? null;
      return { id: g.id, name: g.name, lastAt: at };
    });
    const last = (await workoutSummaries(ctx.q, "w.status = 'completed'", [], 1))[0] ?? null;
    const active = (await ctx.q.query("SELECT id, name, started_at FROM workouts WHERE status = 'in_progress' ORDER BY started_at DESC LIMIT 1")).rows[0] ?? null;
    const end = dayIn(new Date(now.getTime() + 7 * 86400000), tzMin);
    // the same rule as the calendar: a plan done (by its routine, its activity type, or started from it) drops out.
    // The whole week, uncut: Today lists every plan for today and marks the week's planned days; Up next shortens itself
    const marked = await plannedMarked(ctx.q, today, end, tzMin);
    const upNext = marked.filter((p) => !p.done).map(({ done: _, ...p }) => p);
    // today's plans done or not, so Today says "Nothing else planned" once you've done them all, "Nothing planned" otherwise
    const plannedToday = marked.filter((p) => p.date === today).length;
    // the programs you're following get their own card on Home, so their next workout isn't also a suggestion
    // with Programs switched off they are absent from Home, Today and suggestions included
    const programsOn = !!s.features.programs;
    const programs = [];
    for (const p of programsOn ? (await ctx.q.query("SELECT * FROM programs WHERE active ORDER BY created_at DESC")).rows : []) {
      const st = await programState(ctx.q, p);
      if (!st.total || st.finished) continue;
      const start = String(p.start_date).slice(0, 10);
      const calendarWeek = today < start ? 0 : Math.floor((Date.parse(today) - Date.parse(start)) / (7 * 86400000)) + 1;
      programs.push({ id: p.id, name: p.name, weeks: (p.weeks ?? []).length, deloadPct: p.deload_pct, startDate: start, calendarWeek, ...st });
    }
    const routines = await routineSummaries(ctx.q, ctx.userId);
    const suggest = (await suggestions(ctx.q, routines, now, s.home.hidden)).filter((x) => x.kind !== "program" || (programsOn && !programs.length));
    const allGoals = await goalsWithProgress(ctx, tzMin);
    const goals = allGoals.filter((g) => g.status === "active").slice(0, 3);
    // the goals picked for the top of Home, in the order picked, each saying whether its streak shows beside it
    const homeGoals = (s.home.goals ?? []).flatMap((h) => { const g = allGoals.find((x) => x.id === h.id); return g ? [{ ...g, showStreak: h.streak && g.period !== "once" }] : []; });
    const reminders = (await ctx.q.query(
      `SELECT m.*, coalesce(e.name, r.name) AS target_name FROM reminders m LEFT JOIN exercises e ON m.target_type='exercise' AND e.id = m.target_id
       LEFT JOIN routines r ON m.target_type='routine' AND r.id = m.target_id WHERE m.status = 'pending' ORDER BY m.created_at DESC LIMIT 5`)).rows.map((x: any) => camel(x));
    const bw = (await ctx.q.query("SELECT value, measured_at FROM body_metrics WHERE kind = 'weight' ORDER BY measured_at DESC LIMIT 30")).rows.map((x: any) => ({ value: Number(x.value), at: x.measured_at }));
    const feed = [
      ...(await workoutSummaries(ctx.q, "w.status = 'completed'", [], 8)).map((w) => ({ kind: "workout", ...w })),
      ...(await ctx.q.query("SELECT id, type, name, started_at, duration_s, distance_m, steps FROM activities ORDER BY started_at DESC LIMIT 8")).rows.map((x: any) => ({ kind: "activity", ...camel<any>(x) })),
    ].sort((a: any, b: any) => b.startedAt.localeCompare(a.startedAt)).slice(0, 8);
    // the days (in the app's calendar) with a finished workout or an activity: the week strip and the streak grid
    const days = [...new Set([...rows.map((x) => dayIn(x.startedAt, tzMin)), ...acts.map((x: any) => dayIn(x.started_at, tzMin))])].sort();
    // records set in the last 30 days, only while the Records block is on (a bounded number of queries: it reruns on most changes)
    const records = s.home.blocks.some((b) => b.id === "records" && b.on)
      ? await recentRecords(ctx.q, new Date(now.getTime() - 30 * 86400000).toISOString(), 6) : [];
    return {
      days, records,
      weeks, thisWeek: weeks.at(-1), lastWeek: weeks.at(-2), streak: await currentStreak(ctx.q, s, now, tzMin), homeGoals,
      last,
      active: active ? camel(active) : null, programs, upNext, plannedToday, suggest, goals, reminders, bodyweight: bw, feed, muscles7, main7, helpers7, groupDays,
      totalWorkouts: Number((await ctx.q.query("SELECT count(*) n FROM workouts WHERE status = 'completed'")).rows[0].n),
      // with no routines and nothing done yet, Home opens with a way to begin
      routineCount: routines.length,
      activityCount: Number((await ctx.q.query("SELECT count(*) n FROM activities")).rows[0].n),
    };
  });

  // registered here, not in achievements.ts: that would need goals.ts, which already imports achievements.ts
  r.get("/achievements", async (ctx, _p, _b, qs) => {
    await ensureStarterGoal(ctx.q, ctx.userId); // before reading settings: the streak follows the weekly goal it makes
    return achievements(ctx.q, await getSettings(ctx.q, ctx.userId), Number(qs.tz) || 0);
  });
}
