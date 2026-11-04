// Suggestions for Home, worked out from what you actually do:
// - the next workout of a program you're following
// - your usual order of routines (if Back usually follows Chest and you just did Chest, Back is next)
// - a muscle left out this week while the rest were worked, or one that hasn't been worked for a long while
// - otherwise, the routine you haven't done for the longest
import { muscleName } from "@motus/shared";
import type { Sql } from "../db";
import type { RoutineSummary } from "@motus/shared";
import { programState } from "./programs";

export type Suggestion = { key: string; kind: "program" | "order" | "missed" | "rested" | "oldest"; title: string; reason: string; routineId: string | null; color: string | null; muscle?: string };

// the muscles worth a nudge; small ones (forearms, neck, adductors…) only show up as part of a routine
const MAIN = ["chest", "lats", "middle back", "shoulders", "biceps", "triceps", "abdominals", "quadriceps", "hamstrings", "glutes", "calves"];
const DAY = 86400000;

/** hidden: suggestions you dismissed (key → when); each stays hidden until your next workout */
export async function suggestions(q: Sql, routines: RoutineSummary[], now: Date, hidden: Record<string, string> = {}): Promise<Suggestion[]> {
  const usable = routines.filter((r) => !r.archived && r.exerciseCount > 0);
  const byId = new Map(usable.map((r) => [r.id, r]));
  const out: Suggestion[] = [];
  const lastWorkout = (await q.query<{ at: string }>("SELECT max(started_at) AS at FROM workouts WHERE status = 'completed'")).rows[0]?.at;
  const isHidden = (key: string) => !!hidden[key] && (!lastWorkout || new Date(hidden[key]!) > new Date(lastWorkout));
  const add = (x: Omit<Suggestion, "key">) => {
    const key = `${x.kind}:${x.routineId ?? x.muscle}`;
    if (out.length < 5 && !isHidden(key) && !out.some((y) => (x.routineId && y.routineId === x.routineId) || (x.muscle && y.muscle === x.muscle))) out.push({ key, ...x });
  };

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

  // 2. muscles: when each was last worked, and which routine works it most
  const lastAt = new Map((await q.query<{ m: string; at: string }>(
    `SELECT unnest(e.primary_muscles) AS m, max(w.started_at) AS at FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id JOIN exercises e ON e.id = we.exercise_id
     WHERE w.status = 'completed' AND we.status <> 'skipped' GROUP BY 1`)).rows.map((x) => [x.m, new Date(x.at).getTime()]));
  const days = (m: string) => lastAt.has(m) ? Math.floor((now.getTime() - lastAt.get(m)!) / DAY) : null;
  const known = MAIN.filter((m) => lastAt.has(m)); // only muscles you have trained before
  const thisWeek = known.filter((m) => days(m)! < 7);
  const hits = (await q.query<{ routine_id: string; m: string; n: string }>(
    `SELECT re.routine_id, unnest(e.primary_muscles) AS m, count(*) AS n FROM routine_exercises re JOIN exercises e ON e.id = re.exercise_id GROUP BY 1, 2`)).rows;
  const routineFor = (m: string) => hits.filter((h) => h.m === m && byId.has(h.routine_id)).sort((a, b) => Number(b.n) - Number(a.n))[0]?.routine_id ?? null;
  const muscleTip = (m: string, kind: "missed" | "rested", reason: string) => {
    const rid = routineFor(m), r = rid ? byId.get(rid)! : null;
    add({ kind, title: r ? r.name : `Work your ${muscleName(m).toLowerCase()}`, reason: r ? `${reason} · works your ${muscleName(m).toLowerCase()}` : reason, routineId: r?.id ?? null, color: r?.color ?? null, muscle: m });
  };
  // left out this week, while most of the others were worked
  if (known.length >= 4 && thisWeek.length >= known.length * 0.6) {
    const left = known.filter((x) => days(x)! >= 7).sort((a, b) => days(b)! - days(a)!);
    for (const m of left.slice(0, 2))
      muscleTip(m, "missed", left.length === 1 ? `${muscleName(m)}: the only one not worked this week` : `${muscleName(m)}: not worked this week, unlike most others`);
  }
  // not worked for a long while
  for (const m of known.filter((x) => days(x)! >= 10).sort((a, b) => days(b)! - days(a)!).slice(0, 2))
    muscleTip(m, "rested", `${muscleName(m)} not worked for ${days(m)} days`);

  // 3. and the routines done longest ago
  const ago = (at: string | null) => (at ? Math.floor((now.getTime() - new Date(at).getTime()) / DAY) : null);
  for (const r of [...usable].filter((x) => (ago(x.lastDoneAt) ?? 99) >= 3).sort((a, b) => (a.lastDoneAt ?? "").localeCompare(b.lastDoneAt ?? "")).slice(0, 2))
    add({ kind: "oldest", title: r.name, reason: r.lastDoneAt ? `Not done for ${ago(r.lastDoneAt)} days` : "You haven't done this one yet", routineId: r.id, color: r.color ?? null });
  return out;
}
