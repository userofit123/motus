// Suggestions for Home, worked out from what you actually do and what your routines hold, best first:
// - the next workout of a program you're following
// - your usual order of routines (if Back usually follows Chest and you just did Chest, Back is next)
// - a muscle left out in the last 7 days while the rest were worked
// - gaps in your routines: a muscle group none of them works (no core exercise anywhere), or a muscle that is only ever a
//   helper (forearms in rows and curls) with no exercise of its own
// - a muscle that gets far fewer sets than the others lately, or hasn't been worked for a long while (or ever)
// - otherwise, the routine you haven't done for the longest
// At most two of a kind and five in all, so one long list of "not done for N days" can't crowd out the rest.
import { GROUPS, muscleName, agoDays } from "@motus/shared";
import type { Sql } from "../db";
import type { RoutineSummary, HomeSuggestion } from "@motus/shared";
import { programState } from "./programs";
import { dayIn } from "./achievements";

export type Suggestion = HomeSuggestion;

// the muscles worth a nudge; forearms count as one people ask about, the other small ones (neck, adductors…) only show up
// as part of a routine
const MAIN = ["chest", "lats", "middle back", "shoulders", "biceps", "triceps", "abdominals", "quadriceps", "hamstrings", "glutes", "calves"];
const WATCH = [...MAIN, "forearms"];
const DAY = 86400000;
const MAX = 5, PER_KIND = 2;
// gaps of both sorts count as one kind: two of them at most, so the workouts that are due still find room
const family = (k: Suggestion["kind"]) => (k === "target" ? "gap" : k);

/** hidden: suggestions you dismissed (key → when); each stays hidden until your next workout. tzMin: the app's offset,
 *  so days are counted by its calendar, as the Routines page counts "last done". */
export async function suggestions(q: Sql, routines: RoutineSummary[], now: Date, hidden: Record<string, string> = {}, tzMin = 0): Promise<Suggestion[]> {
  const usable = routines.filter((r) => !r.archived && r.exerciseCount > 0);
  const byId = new Map(usable.map((r) => [r.id, r]));
  const out: Suggestion[] = [];
  const done = (await q.query<{ at: string | null; n: string }>("SELECT max(started_at) AS at, count(*) AS n FROM workouts WHERE status = 'completed'")).rows[0];
  const lastWorkout = done?.at, workouts = Number(done?.n ?? 0);
  const isHidden = (key: string) => !!hidden[key] && (!lastWorkout || new Date(hidden[key]!) > new Date(lastWorkout));
  const add = (x: Omit<Suggestion, "key">) => {
    const key = `${x.kind}:${x.routineId ?? x.muscle}`;
    const same = out.some((y) => (x.routineId && y.routineId === x.routineId) || (x.muscle && y.muscle === x.muscle)
      || (x.muscles && y.muscles?.some((m) => x.muscles!.includes(m))));
    if (out.length < MAX && out.filter((y) => family(y.kind) === family(x.kind)).length < PER_KIND && !isHidden(key) && !same) out.push({ key, ...x });
  };
  const lower = (m: string) => muscleName(m).toLowerCase();

  // 0. a program you're following says what's next
  for (const p of (await q.query("SELECT * FROM programs WHERE active ORDER BY created_at DESC")).rows) {
    const next = (await programState(q, p)).next;
    if (next && byId.has(next.routineId)) add({ kind: "program", title: next.name, reason: `${p.name}: week ${next.week}, workout ${next.day}${next.deload ? " (deload)" : ""}`, routineId: next.routineId, color: next.color });
  }

  // 1. your usual order: which routine most often came right after the one you did last
  const seq = (await q.query<{ routine_id: string | null }>(
    "SELECT routine_id FROM workouts WHERE status = 'completed' ORDER BY started_at DESC LIMIT 80")).rows.map((x) => x.routine_id).reverse();
  const last = seq.at(-1);
  if (last) {
    const after = new Map<string, number>();
    let times = 0;
    for (let i = 0; i < seq.length - 1; i++) if (seq[i] === last && seq[i + 1]) { times++; after.set(seq[i + 1]!, (after.get(seq[i + 1]!) ?? 0) + 1); }
    // twice is a habit; once is enough only when it's the only thing that ever followed
    const followers = [...after].filter(([id]) => id !== last && byId.has(id)).sort((a, b) => b[1] - a[1]);
    for (const [next, n] of followers.slice(0, 2)) {
      if (!(n >= 2 || after.size === 1) || !byId.get(last)) continue;
      const r = byId.get(next)!;
      add({ kind: "order", title: r.name, reason: `${n === followers[0]![1] ? "You usually do it" : "Sometimes done"} after ${byId.get(last)!.name}${n > 1 ? ` (${n} of ${times} times)` : ""}`, routineId: r.id, color: r.color ?? null });
    }
  }

  // muscles: when each was last worked, its sets in the last four weeks, and what your routines do for it
  const lastAt = new Map((await q.query<{ m: string; at: string }>(
    `SELECT unnest(e.primary_muscles) AS m, max(w.started_at) AS at FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id JOIN exercises e ON e.id = we.exercise_id
     WHERE w.status = 'completed' AND we.status <> 'skipped' GROUP BY 1`)).rows.map((x) => [x.m, new Date(x.at).getTime()]));
  const sets28 = new Map((await q.query<{ m: string; n: string }>(
    `SELECT unnest(e.primary_muscles) AS m, count(s.id) AS n FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id JOIN exercises e ON e.id = we.exercise_id
     JOIN workout_sets s ON s.workout_exercise_id = we.id AND s.done AND s.kind <> 'warmup'
     WHERE w.status = 'completed' AND w.started_at >= $1 GROUP BY 1`, [new Date(now.getTime() - 28 * DAY).toISOString()])).rows.map((x) => [x.m, Number(x.n)]));
  // whole calendar days since, on the app's calendar: yesterday evening is 1 day ago at any hour today
  const today = Date.parse(dayIn(now, tzMin));
  const calDays = (at: string | number | Date) => Math.round((today - Date.parse(dayIn(new Date(at), tzMin))) / DAY);
  const days = (m: string) => lastAt.has(m) ? calDays(lastAt.get(m)!) : null;
  const known = MAIN.filter((m) => lastAt.has(m)); // only muscles you have trained before
  const last7 = known.filter((m) => days(m)! < 7);
  const hits = (await q.query<{ routine_id: string; m: string; n: string; main: boolean }>(
    `SELECT re.routine_id, unnest(e.primary_muscles) AS m, count(*) AS n, true AS main FROM routine_exercises re JOIN exercises e ON e.id = re.exercise_id GROUP BY 1, 2
     UNION ALL SELECT re.routine_id, unnest(e.secondary_muscles) AS m, count(*) AS n, false AS main FROM routine_exercises re JOIN exercises e ON e.id = re.exercise_id GROUP BY 1, 2`))
    .rows.filter((h) => byId.has(h.routine_id));
  const routineFor = (m: string) => hits.filter((h) => h.main && h.m === m).sort((a, b) => Number(b.n) - Number(a.n))[0]?.routine_id ?? null;
  const helped = (m: string) => hits.some((h) => !h.main && h.m === m);
  // gaps in your routines (only once you have some, so a new account isn't told everything is missing), leaving out what you
  // trained outside your routines in the last four weeks: that isn't missing from your training
  const trained = (m: string) => (sets28.get(m) ?? 0) > 0;
  // a whole group none of your routines works as a main muscle
  const gaps = usable.length ? GROUPS.filter((g) => g.id !== "neck" && !g.muscles.some((m) => routineFor(m) || trained(m))) : [];
  // a muscle whose group is covered but that has no exercise of its own anywhere
  const targets = usable.length ? WATCH.filter((m) => !routineFor(m) && !trained(m) && !gaps.some((g) => g.muscles.includes(m))) : [];
  // the gap tips, worked out here so a muscle's own tip can step aside for one that will be shown: like every muscle tip the
  // title says what to do and the reason why; it opens the exercises for it, or its + makes a routine. Only a helper
  // somewhere is said so, since the routine's figure shows it worked.
  const why = (name: string, help: boolean) => help ? `Your routines only train your ${name} as a helper` : `None of your routines train your ${name}`;
  const gapTips: Omit<Suggestion, "key">[] = [
    ...gaps.map((g) => { const name = g.name.toLowerCase(); return { kind: "gap" as const, title: `Work your ${name}`, reason: why(name, g.muscles.some(helped)), routineId: null, color: null, muscle: g.id, muscles: g.muscles.filter((m) => WATCH.includes(m)) }; }),
    ...targets.map((m) => ({ kind: "target" as const, title: `Work your ${lower(m)}`, reason: why(lower(m), helped(m)), routineId: null, color: null, muscle: m, muscles: [m] })),
  ];
  // only the gaps that make the cut (two at most, not dismissed): a muscle whose gap tip was cut keeps its own tip
  const shownGaps = gapTips.filter((x) => !isHidden(`${x.kind}:${x.muscle}`)).slice(0, PER_KIND);
  const isGap = (m: string) => shownGaps.some((x) => x.muscles!.includes(m));
  // a muscle's tip opens the routine that works it most; with no routine for it, it opens the exercises and its + starts a
  // new routine, like a gap tip
  const muscleTip = (m: string, kind: "missed" | "rested" | "low", reason: string) => {
    if (isGap(m)) return;
    const rid = routineFor(m), r = rid ? byId.get(rid)! : null;
    add({ kind, title: r ? r.name : `Work your ${lower(m)}`, reason: r ? `${reason} · works your ${lower(m)}` : reason, routineId: r?.id ?? null, color: r?.color ?? null, muscle: m, muscles: [m] });
  };

  // 2. left out in the last 7 days, while most of the others were worked
  if (known.length >= 4 && last7.length >= known.length * 0.6) {
    const left = known.filter((x) => days(x)! >= 7).sort((a, b) => days(b)! - days(a)!);
    for (const m of left.slice(0, 2))
      muscleTip(m, "missed", left.length === 1 ? `${muscleName(m)}: the only one not worked in the last 7 days` : `${muscleName(m)}: not worked in the last 7 days, unlike most others`);
  }

  // 3. the gaps in your routines
  for (const x of gapTips) add(x);

  // 4. far fewer sets than the rest lately: under a quarter of what a typical muscle got in four weeks
  const counts = known.map((m) => sets28.get(m) ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
  const typical = counts.length >= 4 ? counts[Math.floor(counts.length / 2)]! : 0;
  if (typical >= 8)
    for (const m of known.filter((x) => routineFor(x) && (sets28.get(x) ?? 0) > 0 && (sets28.get(x) ?? 0) < typical / 4).sort((a, b) => (sets28.get(a) ?? 0) - (sets28.get(b) ?? 0)))
      muscleTip(m, "low", `${muscleName(m)}: ${sets28.get(m)} ${sets28.get(m) === 1 ? "set" : "sets"} in 4 weeks, ${typical} for most others`);

  // 5. not worked for a long while, or never though a routine has it (once there's enough history to tell)
  for (const m of known.filter((x) => days(x)! >= 10).sort((a, b) => days(b)! - days(a)!))
    muscleTip(m, "rested", `${muscleName(m)} not worked for ${days(m)} days`);
  if (workouts >= 5) for (const m of MAIN.filter((x) => !lastAt.has(x) && routineFor(x))) muscleTip(m, "rested", `${muscleName(m)}: not worked yet`);

  // 6. and the routines done longest ago
  const ago = (at: string | null) => (at ? calDays(at) : null);
  for (const r of [...usable].filter((x) => (ago(x.lastDoneAt) ?? 99) >= 3).sort((a, b) => (a.lastDoneAt ?? "").localeCompare(b.lastDoneAt ?? "")))
    add({ kind: "oldest", title: r.name, reason: r.lastDoneAt ? `Last done ${agoDays(ago(r.lastDoneAt)!)}` : "You haven't done this one yet", routineId: r.id, color: r.color ?? null });
  return out;
}
