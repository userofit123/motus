// Home's suggestions, worked out from what you do and what your routines hold, best first:
// - program: the next workout of a program you follow
// - order: the routine that usually follows the one you did last (twice is a habit)
// - missed: a muscle not trained for a week while you trained the others, or for 10 days or more
// - gap: a muscle group none of your routines trains; target: a muscle your routines only use as a helper
// - low: a muscle with far fewer sets than the rest in the last four weeks
// - oldest: the routines you haven't done for longest
// Each says what to do in its title (a routine's name, or "Train your lats" / "Add exercises for your core") and why in one
// plain sentence. One suggestion per routine and per muscle group, so Back never shows twice in different words. A plan or
// a workout in progress for that routine or muscle means it is taken care of, so it drops out; dismissing one keeps that
// routine and muscle group away for a week, so a near-duplicate doesn't take its place.
// Pure, so the rules are tested without a database: the engine gathers the numbers.
import { GROUPS, groupOf, muscleName } from "./muscles";
import { agoDays } from "./units";
import type { HomeSuggestion } from "./types";

export interface SuggestInput {
  now: number;
  /** routines you can do (not archived, with exercises); daysAgo: whole calendar days since last done (null: never) */
  routines: { id: string; name: string; color: string | null; daysAgo: number | null }[];
  /** the next workout of each program you follow; only the ones Home shows as suggestions (none while the programs
   *  have their own card), so a hidden one doesn't keep its routine or muscles from another suggestion */
  programs: { program: string; routineId: string; name: string; color: string | null; week: number; day: number; deload: boolean }[];
  /** the routines of your last finished workouts, oldest first (null: a free workout) */
  recent: (string | null)[];
  /** whole calendar days since each muscle was last trained as a main muscle */
  muscleDays: Record<string, number>;
  /** working sets per main muscle in the last four weeks */
  sets28: Record<string, number>;
  /** what each routine trains: main muscles and helpers, with how many exercises */
  routineMuscles: { routineId: string; muscle: string; n: number; main: boolean }[];
  /** routines planned from today on, or the one in progress, and the main muscles those plans and that workout train */
  planned: { routineIds: string[]; muscles: string[] };
  /** dismissed suggestions: subject ("r:<routine id>" / "m:<group id>") → when */
  hidden: Record<string, string>;
}

// the muscles worth a nudge; forearms count as one people ask about, the other small ones (neck, adductors…) only show up
// as part of a routine
const MAIN = ["chest", "lats", "middle back", "shoulders", "biceps", "triceps", "abdominals", "quadriceps", "hamstrings", "glutes", "calves"];
const WATCH = [...MAIN, "forearms"];
const DAY = 86400000;
/** how long a dismissed routine or muscle group stays away */
export const DISMISS_DAYS = 7;
const MAX = 8, PER_KIND = 2;
// both sorts of gap count as one kind: two of them at most, so the workouts that are due still find room
const family = (k: HomeSuggestion["kind"]) => (k === "target" ? "gap" : k);

const lower = (m: string) => muscleName(m).toLowerCase();
const SINGLE = new Set(["chest", "middle back", "lower back", "core", "back"]);
/** "Your lats were" / "Your chest was" */
const yours = (name: string) => `Your ${name} ${SINGLE.has(name) ? "was" : "were"}`;

/** The dismissals worth keeping as `subjects` are dismissed at `at`: those still within DISMISS_DAYS, in the current
 *  form ("r:" / "m:"). The others come back as null, which the settings drop on saving (withDefaults), so the list
 *  doesn't grow with every dismissal or keep keys from the older suggestions ("missed:…", "oldest:…"). */
export function dismissalPatch(hidden: Record<string, string>, subjects: string[], at: Date): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(hidden)) {
    const t = Date.parse(v);
    if (!/^[rm]:/.test(k) || !Number.isFinite(t) || at.getTime() - t >= DISMISS_DAYS * DAY) out[k] = null;
  }
  for (const k of subjects) out[k] = at.toISOString();
  return out;
}

/** What a dismissal of this suggestion keeps away: its routine and the muscle groups it is about. */
export function suggestionSubjects(x: Pick<HomeSuggestion, "routineId" | "muscles">): string[] {
  return [...(x.routineId ? [`r:${x.routineId}`] : []), ...new Set((x.muscles ?? []).map((m) => `m:${groupOf(m)}`))];
}

export function pickSuggestions(d: SuggestInput): HomeSuggestion[] {
  const byId = new Map(d.routines.map((r) => [r.id, r]));
  const out: HomeSuggestion[] = [];
  const isHidden = (s: string) => { const at = d.hidden[s]; return !!at && d.now - Date.parse(at) < DISMISS_DAYS * DAY; };
  const plannedR = new Set(d.planned.routineIds), plannedM = new Set(d.planned.muscles);
  const add = (x: Omit<HomeSuggestion, "key" | "hide">) => {
    const hide = suggestionSubjects(x);
    if (out.length >= MAX || out.filter((y) => family(y.kind) === family(x.kind)).length >= PER_KIND) return;
    if (hide.some(isHidden) || out.some((y) => y.hide.some((s) => hide.includes(s)))) return;
    // taken care of: that routine is planned or going, or a planned routine trains this muscle
    if ((x.routineId && plannedR.has(x.routineId)) || (x.muscles ?? []).some((m) => plannedM.has(m))) return;
    out.push({ key: `${x.kind}:${x.routineId ?? x.muscle}`, hide, ...x });
  };

  // a program you follow says what's next
  for (const p of d.programs) if (byId.has(p.routineId))
    add({ kind: "program", title: p.name, reason: `Next in ${p.program}: week ${p.week}, workout ${p.day}${p.deload ? " (deload)" : ""}`, routineId: p.routineId, color: p.color });

  // your usual order: the routine that most often came right after the one you did last
  const last = d.recent.at(-1), lastR = last ? byId.get(last) : undefined;
  if (lastR) {
    const after = new Map<string, number>();
    for (let i = 0; i < d.recent.length - 1; i++) { const nx = d.recent[i + 1]; if (d.recent[i] === last && nx) after.set(nx, (after.get(nx) ?? 0) + 1); }
    const [top] = [...after].filter(([id]) => id !== last && byId.has(id)).sort((a, b) => b[1] - a[1]);
    // twice is a habit; once is enough only when it's the only thing that ever followed
    if (top && (top[1] >= 2 || after.size === 1)) {
      const r = byId.get(top[0])!;
      add({ kind: "order", title: r.name, reason: `Usually follows ${lastR.name}, your last workout`, routineId: r.id, color: r.color });
    }
  }

  // what your routines do for each muscle
  const routineFor = (m: string) => d.routineMuscles.filter((h) => h.main && h.muscle === m && byId.has(h.routineId)).sort((a, b) => b.n - a.n)[0]?.routineId ?? null;
  const helped = (m: string) => d.routineMuscles.some((h) => !h.main && h.muscle === m && byId.has(h.routineId));
  const days = (m: string) => d.muscleDays[m];
  const sets = (m: string) => d.sets28[m] ?? 0;
  const known = MAIN.filter((m) => days(m) != null); // only muscles you have trained before
  // gaps (only once you have routines, so a new account isn't told everything is missing), leaving out what you trained
  // outside your routines in the last four weeks: that isn't missing from your training
  const gaps = d.routines.length ? GROUPS.filter((g) => g.id !== "neck" && !g.muscles.some((m) => routineFor(m) || sets(m) > 0)) : [];
  const targets = d.routines.length ? WATCH.filter((m) => !routineFor(m) && sets(m) === 0 && !gaps.some((g) => g.muscles.includes(m))) : [];
  const why = (name: string, help: boolean) => (help ? `Your routines only use your ${name} as a helper` : `None of your routines train your ${name}`);
  const gapTips: Omit<HomeSuggestion, "key" | "hide">[] = [
    ...gaps.map((g) => { const name = g.name.toLowerCase(); return { kind: "gap" as const, title: `Add exercises for your ${name}`, reason: why(name, g.muscles.some(helped)), routineId: null, color: null, muscle: g.id, muscles: g.muscles.filter((m) => WATCH.includes(m)) }; }),
    ...targets.map((m) => ({ kind: "target" as const, title: `Add exercises for your ${lower(m)}`, reason: why(lower(m), helped(m)), routineId: null, color: null, muscle: m, muscles: [m] })),
  ];
  // a muscle's tip opens the routine that trains it most; with none, it opens the exercises for it
  const muscleTip = (m: string, kind: "missed" | "low", reason: string) => {
    const rid = routineFor(m), r = rid ? byId.get(rid)! : null;
    add({ kind, title: r ? r.name : `Train your ${lower(m)}`, reason, routineId: r?.id ?? null, color: r?.color ?? null, muscle: m, muscles: [m] });
  };

  // a muscle left out: a week while you trained most of the others, or 10 days or more
  const active = known.length >= 4 && known.filter((m) => days(m)! < 7).length >= known.length * 0.6;
  for (const m of known.filter((x) => days(x)! >= (active ? 7 : 10)).sort((a, b) => days(b)! - days(a)!))
    muscleTip(m, "missed", `${yours(lower(m))} last trained ${agoDays(days(m)!)}`);

  for (const x of gapTips) add(x);

  // far fewer sets lately: under a quarter of what a typical muscle got in four weeks
  const counts = known.map(sets).filter((n) => n > 0).sort((a, b) => a - b);
  const typical = counts.length >= 4 ? counts[Math.floor(counts.length / 2)]! : 0;
  if (typical >= 8)
    for (const m of known.filter((x) => routineFor(x) && sets(x) > 0 && sets(x) < typical / 4).sort((a, b) => sets(a) - sets(b)))
      muscleTip(m, "low", `Only ${sets(m)} ${sets(m) === 1 ? "set" : "sets"} for your ${lower(m)} in 4 weeks, against ${typical} for most muscles`);

  // the routines done longest ago (3 days or more)
  for (const r of d.routines.filter((x) => (x.daysAgo ?? 99) >= 3).sort((a, b) => (b.daysAgo ?? 9999) - (a.daysAgo ?? 9999)))
    add({ kind: "oldest", title: r.name, reason: r.daysAgo != null ? `Last done ${agoDays(r.daysAgo)}` : "Not done yet", routineId: r.id, color: r.color });
  return out;
}
