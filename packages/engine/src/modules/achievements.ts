// Achievements: each ladder is a running total over time (workouts, kg lifted, km walked…), so every step can say
// when it was reached. Worked out on request from the logged data, never stored: deleting a workout moves them too.
// Weeks follow the app's calendar (tz = its getTimezoneOffset()), not the server's, so the server and the copy on a
// device agree.
import { ACHIEVEMENTS, achievementName, achievementTarget, e1rm, LIFTED_SQL, type Settings } from "@motus/shared";
import type { Sql } from "../db";

const DAY = 86400000;
/** The calendar day an instant falls on, for an app whose clock is tzMin minutes behind UTC. */
export const dayIn = (at: string | Date, tzMin: number) => new Date(new Date(at).getTime() - tzMin * 60000).toISOString().slice(0, 10);
/** The first day (YYYY-MM-DD) of the week an instant falls in, on the app's calendar. */
export function weekIn(at: string | Date, tzMin: number, firstDay: number): string {
  const d = new Date(dayIn(at, tzMin) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - firstDay + 7) % 7));
  return d.toISOString().slice(0, 10);
}
const nextWeek = (w: string) => new Date(new Date(w + "T12:00:00Z").getTime() + 7 * DAY).toISOString().slice(0, 10);
const prevWeek = (w: string) => new Date(new Date(w + "T12:00:00Z").getTime() - 7 * DAY).toISOString().slice(0, 10);

/**
 * The weekly target the streak follows: the first weekly sessions goal on Home (what counts: everything, gym workouts or
 * one activity type), else the oldest active one. There is no fixed target any more: with no such goal there is no streak.
 */
async function weeklyTarget(q: Sql, s: Settings): Promise<{ target: number; what: string | null } | null> {
  const ids = (s.home.goals ?? []).map((x) => x.id);
  const { rows } = await q.query("SELECT id, metric, scope_id, target FROM goals WHERE status = 'active' AND period = 'week' AND metric IN ('sessions', 'workouts') ORDER BY created_at");
  const g = ids.map((i) => rows.find((r: any) => r.id === i)).find(Boolean) ?? rows[0];
  return g ? { target: Math.max(1, Number(g.target)), what: g.metric === "workouts" ? "workout" : g.scope_id } : null;
}

/** Each week that reached the weekly target, with the moment it did (the session that made it). */
async function targetWeeks(q: Sql, s: Settings, tzMin: number): Promise<Map<string, string>> {
  const wt = await weeklyTarget(q, s);
  if (!wt) return new Map();
  const { target: goal, what } = wt;
  const { rows } = await q.query(`SELECT started_at FROM (
      SELECT started_at FROM workouts WHERE status = 'completed' AND ($1::text IS NULL OR $1 = 'workout')
      UNION ALL SELECT started_at FROM activities WHERE $1::text IS NULL OR ($1 <> 'workout' AND type = $1)) x ORDER BY started_at`, [what]);
  const n = new Map<string, number>(), met = new Map<string, string>();
  for (const r of rows) {
    const k = weekIn(r.started_at, tzMin, s.firstDay);
    n.set(k, (n.get(k) ?? 0) + 1);
    if (n.get(k)! >= goal && !met.has(k)) met.set(k, r.started_at);
  }
  return met;
}

/** Weeks in a row reaching the weekly target, ending this week (once it's reached) or last week. */
export async function currentStreak(q: Sql, s: Settings, now: Date, tzMin: number): Promise<number> {
  const met = await targetWeeks(q, s, tzMin);
  let w = weekIn(now, tzMin, s.firstDay), n = met.has(w) ? 1 : 0;
  for (w = prevWeek(w); met.has(w); w = prevWeek(w)) n++;
  return n;
}

type Series = [at: string, total: number][];
/** Running totals from events in time order. */
const running = (ev: { at: string; v: number }[]): Series => { let t = 0; return ev.filter((e) => e.v > 0).map((e) => [e.at, (t += e.v)]); };

/** Exercise sessions that beat every earlier session of that exercise; the first time doing one is not a record. */
async function recordSeries(q: Sql): Promise<Series> {
  const { rows } = await q.query(
    `SELECT we.exercise_id, e.tracking, w.id AS workout_id, w.started_at, s.weight_kg, s.reps, s.duration_s, s.distance_m
     FROM workout_sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN workouts w ON w.id = we.workout_id JOIN exercises e ON e.id = we.exercise_id
     WHERE w.status = 'completed' AND s.done AND s.kind <> 'warmup' ORDER BY we.exercise_id, w.started_at, w.id, s.position`);
  const events: { at: string; v: number }[] = [];
  let i = 0;
  while (i < rows.length) {
    const ex = rows[i].exercise_id, tracking = rows[i].tracking;
    // assisted exercises log the help as weight: less is better, so only more reps at the same or less help counts
    const assisted = tracking === "assisted";
    const prev: any[] = [];
    let first = true;
    while (i < rows.length && rows[i].exercise_id === ex) {
      const wid = rows[i].workout_id, at = rows[i].started_at, sets: any[] = [];
      while (i < rows.length && rows[i].exercise_id === ex && rows[i].workout_id === wid) sets.push(rows[i++]);
      if (!first) {
        const w = (s: any) => Number(s.weight_kg) || 0;
        const maxW = Math.max(0, ...prev.map(w)), maxE = Math.max(0, ...prev.map((s) => e1rm(w(s), s.reps) ?? 0));
        const maxD = Math.max(0, ...prev.map((s) => s.duration_s ?? 0)), maxM = Math.max(0, ...prev.map((s) => Number(s.distance_m) || 0));
        const repsAt = (s: any) => Math.max(0, ...prev.filter((p) => (assisted ? w(p) <= w(s) : w(p) >= w(s))).map((p) => p.reps ?? 0));
        const beat = sets.some((s) => (!assisted && w(s) > maxW) || (!assisted && (e1rm(w(s), s.reps) ?? 0) > maxE + 0.01)
          || (s.reps > 0 && s.reps > repsAt(s)) || (s.duration_s ?? 0) > maxD || (Number(s.distance_m) || 0) > maxM);
        if (beat) events.push({ at, v: 1 });
      }
      first = false;
      prev.push(...sets);
    }
  }
  return running(events.sort((a, b) => a.at.localeCompare(b.at)));
}

/** Best run of weeks in a row reaching the weekly target, as it grew. */
async function streakSeries(q: Sql, s: Settings, tzMin: number): Promise<Series> {
  const met = [...(await targetWeeks(q, s, tzMin))].sort((a, b) => a[0].localeCompare(b[0]));
  const out: Series = [];
  let run = 0, best = 0, last = "";
  for (const [w, at] of met) {
    run = last && nextWeek(last) === w ? run + 1 : 1;
    last = w;
    if (run > best) { best = run; out.push([at, best]); }
  }
  return out;
}

/** Programs followed to the end: each program's routines done in its order since it started (as programState counts). */
async function programSeries(q: Sql): Promise<Series> {
  const ev: { at: string; v: number }[] = [];
  for (const p of (await q.query("SELECT id, weeks, start_date FROM programs")).rows) {
    const seq: string[] = (p.weeks ?? []).flatMap((w: any) => w.days ?? []);
    if (!seq.length) continue;
    const done = (await q.query(
      "SELECT routine_id, started_at FROM workouts WHERE status = 'completed' AND started_at >= $1::date AND (program_id = $2 OR routine_id = ANY($3::uuid[])) ORDER BY started_at",
      [p.start_date, p.id, [...new Set(seq)]])).rows;
    let i = 0;
    for (const w of done) if (i < seq.length && w.routine_id === seq[i] && ++i === seq.length) ev.push({ at: w.started_at, v: 1 });
  }
  return running(ev.sort((a, b) => a.at.localeCompare(b.at)));
}

export async function achievements(q: Sql, s: Settings, tzMin: number) {
  // assisted exercises log the help they gave, which isn't weight you lifted
  const workouts = (await q.query(
    `SELECT w.started_at,
       greatest(0, extract(epoch FROM coalesce(w.ended_at, w.started_at) - w.started_at)::int - w.paused_s) AS duration_s,
       coalesce((SELECT sum(${LIFTED_SQL}) FROM workout_sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN exercises e ON e.id = we.exercise_id
         WHERE we.workout_id = w.id AND s.done AND s.kind <> 'warmup'), 0) AS lifted_kg
     FROM workouts w WHERE w.status = 'completed' ORDER BY w.started_at`)).rows;
  const acts = (await q.query("SELECT type, started_at, distance_m FROM activities WHERE distance_m > 0 ORDER BY started_at")).rows;
  const distance = (...types: string[]) => running(acts.filter((a: any) => types.includes(a.type)).map((a: any) => ({ at: a.started_at, v: Number(a.distance_m) })));
  // a week counts once, from its first weigh-in
  const seen = new Set<string>();
  const weighins = running((await q.query("SELECT measured_at FROM body_metrics WHERE kind = 'weight' ORDER BY measured_at")).rows
    .map((r: any) => ({ at: r.measured_at, v: seen.has(weekIn(r.measured_at, tzMin, s.firstDay)) ? 0 : (seen.add(weekIn(r.measured_at, tzMin, s.firstDay)), 1) })));
  const series: Record<string, Series> = {
    workouts: running(workouts.map((w: any) => ({ at: w.started_at, v: 1 }))),
    lifted: running(workouts.map((w: any) => ({ at: w.started_at, v: Number(w.lifted_kg) }))),
    hours: running(workouts.map((w: any) => ({ at: w.started_at, v: Number(w.duration_s) }))),
    streak: await streakSeries(q, s, tzMin),
    records: await recordSeries(q),
    walk: distance("walk", "hike"), run: distance("run"), cycle: distance("cycle"),
    programs: await programSeries(q),
    weighins,
  };
  const u = s.units;
  return ACHIEVEMENTS.map((d) => {
    const ser = series[d.id] ?? [];
    const value = ser.at(-1)?.[1] ?? 0;
    const steps = (typeof d.steps === "function" ? d.steps(u) : d.steps).map((step) => {
      const target = achievementTarget(d, step, u);
      return { id: `${d.id}-${step}`, name: achievementName(d, step, u), target, reachedAt: ser.find((x) => x[1] >= target - 1e-6)?.[0] ?? null };
    });
    return { id: d.id, title: d.title, desc: d.desc, unit: d.unit, value, steps };
  }).filter((a, i) => !ACHIEVEMENTS[i]!.untilStarted || a.value > 0);
}
