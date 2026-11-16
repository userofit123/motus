// Home's suggestions, worked out from what you do and what your routines hold, best first:
// - program: the next workout of a program you follow
// - order: the routine that usually follows the one you did last (twice is a habit)
// - missed: a muscle not trained for a week while you trained the others, or for 10 days or more
// - gap: a whole muscle group (back, arms, legs) none of your routines trains
// - target: one specific muscle none of your routines trains, or only as a helper, even inside a group you do train
//   (back days with lats and middle back but nothing for the lower back)
// - low: a muscle with far fewer sets than the rest in the last four weeks
// - oldest: the routines you haven't done for longest
// The title says what to do (a routine's name, "Train your triceps", "Add an exercise for your lower back (along
// your lower spine)") and the reason says why in one short sentence. A muscle is named by itself, never only by its group, with
// where it is when the name doesn't say. One suggestion per routine and per muscle, so the same muscle never shows twice
// in different words. A plan or a workout in progress for that routine or muscle means it is taken care of, so it drops
// out; dismissing one keeps that routine and those muscles away for a week, so a near-duplicate doesn't take its place.
// Pure, so the rules are tested without a database: the engine gathers the numbers.
import { GROUPS, MUSCLES, groupOf, muscleName } from "./muscles";
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
  /** dismissed suggestions: subject ("r:<routine id>" / "m:<muscle>") → when */
  hidden: Record<string, string>;
}

// the big muscles: the ones a training week is judged by (whether you're active, what "most muscles" got), and the ones a
// "missed" tip names even with no routine for them; the smaller ones get that tip only when a routine trains them
const MAIN = ["chest", "lats", "middle back", "shoulders", "biceps", "triceps", "abdominals", "quadriceps", "hamstrings", "glutes", "calves"];
// every specific muscle the app knows, less the neck, which the app leaves out of its muscle views everywhere (Stats,
// Home's groups) as one that isn't trained on its own
const WATCH = MUSCLES.filter((m) => m !== "neck") as string[];
const DAY = 86400000;
/** how long a dismissed routine or muscle stays away */
export const DISMISS_DAYS = 7;
// gaps get more room (a person can miss several specific muscles); the order at the end still puts one of each kind first
const MAX = 10, PER_KIND = 2, PER_GAP = 4;
// both sorts of gap count as one kind
const family = (k: HomeSuggestion["kind"]) => (k === "target" ? "gap" : k);

const lower = (m: string) => muscleName(m).toLowerCase();
// where a muscle is, for the names that don't say it; a name that is already a place gets the muscle's own name instead
const WHERE: Record<string, string> = {
  lats: "sides of your back", traps: "between your neck and shoulders", "middle back": "between your shoulder blades", "lower back": "along your lower spine",
  quadriceps: "front of your thighs", hamstrings: "back of your thighs", adductors: "inner thighs", abductors: "outer hips",
};
/** "lower back (along your lower spine)", "chest" */
export const muscleLabel = (m: string) => (WHERE[m] ? `${lower(m)} (${WHERE[m]})` : lower(m));
const SINGLE = new Set(["chest", "middle back", "lower back", "back"]);
/** "it" / "them" for a muscle, the same way "was" / "were" follow it */
const pronoun = (m: string) => (SINGLE.has(m) ? "it" : "them");
/** "lats and middle back", "chest, shoulders and triceps" */
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

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

/** What a dismissal of this suggestion keeps away: its routine and each specific muscle it is about (not their whole
 *  group, so lower back can still be suggested after a lats tip is dismissed). */
export function suggestionSubjects(x: Pick<HomeSuggestion, "routineId" | "muscles">): string[] {
  return [...(x.routineId ? [`r:${x.routineId}`] : []), ...new Set((x.muscles ?? []).map((m) => `m:${m}`))];
}

export function pickSuggestions(d: SuggestInput): HomeSuggestion[] {
  const byId = new Map(d.routines.map((r) => [r.id, r]));
  const out: HomeSuggestion[] = [];
  const isHidden = (s: string) => { const at = d.hidden[s]; return !!at && d.now - Date.parse(at) < DISMISS_DAYS * DAY; };
  const plannedR = new Set(d.planned.routineIds), plannedM = new Set(d.planned.muscles);
  /** true when the tip made it into the output */
  const add = (x: Omit<HomeSuggestion, "key" | "hide">): boolean => {
    const hide = suggestionSubjects(x);
    if (out.length >= MAX || out.filter((y) => family(y.kind) === family(x.kind)).length >= (family(x.kind) === "gap" ? PER_GAP : PER_KIND)) return false;
    if (hide.some(isHidden) || out.some((y) => y.hide.some((s) => hide.includes(s)))) return false;
    // taken care of: that routine is planned or going, or a planned routine trains this muscle as a main muscle
    if ((x.routineId && plannedR.has(x.routineId)) || (x.muscles ?? []).some((m) => plannedM.has(m))) return false;
    out.push({ key: `${x.kind}:${x.routineId ?? x.muscle}`, hide, ...x });
    return true;
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
  const known = (ms: string[]) => ms.filter((m) => days(m) != null); // only muscles you have trained before
  type Name = (m: string) => string;
  /** "Your lats were" / "Your lower back (along your lower spine) was" / "Your lats (sides of your back) and middle back
   *  (between your shoulder blades) were": each muscle named the same way, with its place when `name` gives it */
  const yours = (ms: string[], name: Name, verb: [string, string]) =>
    `Your ${list(ms.map(name))} ${ms.length === 1 && SINGLE.has(ms[0]!) ? verb[0] : verb[1]}`;
  // a muscle's tip opens the routine that trains it most; with none, it says to train the muscle and opens its exercises.
  // The muscle's place is said once: in the title when the title names it, else in the reason. `also`: more muscles due
  // for the same rule; the ones the same routine trains and `same` is true for join this tip (one routine, one tip, and
  // a dismissal keeps them away), so the reason names every muscle the tip holds. The others get their own tips; with
  // the routine already used by a tip they open the muscle's exercises instead
  const muscleTip = (m: string, kind: "missed" | "low", reason: (ms: string[], name: Name) => string, also: string[] = [], same: (x: string) => boolean = () => false) => {
    const rid = routineFor(m), r = rid && !out.some((y) => y.hide.includes(`r:${rid}`)) ? byId.get(rid)! : null;
    if (!r) return add({ kind, title: `Train your ${muscleLabel(m)}`, reason: reason([m], lower), routineId: null, color: null, muscle: m, muscles: [m] });
    // left out: muscles dismissed, planned or already in another tip, which would otherwise keep this whole tip away
    const free = (x: string) => !isHidden(`m:${x}`) && !plannedM.has(x) && !out.some((y) => y.hide.includes(`m:${x}`));
    const ms = [m, ...also.filter((x) => x !== m && routineFor(x) === rid && free(x) && same(x))];
    add({ kind, title: r.name, reason: reason(ms, muscleLabel), routineId: r.id, color: r.color, muscle: m, muscles: ms });
  };

  // a muscle left out: a week while you trained most of the others, or 10 days or more. The big ones always count; a
  // smaller one (lower back, traps, adductors…) only when a routine trains it, so a muscle you once hit by chance doesn't nag
  const big = known(MAIN);
  const active = big.length >= 4 && big.filter((m) => days(m)! < 7).length >= big.length * 0.6;
  const due = known(WATCH).filter((m) => (MAIN.includes(m) || routineFor(m)) && days(m)! >= (active ? 7 : 10)).sort((a, b) => days(b)! - days(a)!);
  for (const m of due)
    muscleTip(m, "missed", (ms, name) => `${yours(ms, name, ["was", "were"])} last trained ${agoDays(days(m)!)}`, due, (x) => agoDays(days(x)!) === agoDays(days(m)!));

  // gaps, only once you have routines (so a new account isn't told everything is missing), leaving out what you trained
  // outside your routines in the last four weeks: that isn't missing from your training. A group with several muscles
  // and none of them trained is one tip; otherwise each specific muscle is its own, so a missing lower back shows even
  // though your back days train the lats
  const trained = (m: string) => !!routineFor(m) || sets(m) > 0;
  if (d.routines.length) {
    // a group tip says one thing about all its muscles, so it needs them all alike (every one a helper, or none); a mixed
    // group gets a tip per muscle. `grouped`: the muscles a group tip that made it into the output covers
    const grouped = new Set<string>();
    for (const g of GROUPS.filter((x) => x.id !== "neck" && x.muscles.length > 1 && !x.muscles.some(trained) && (x.muscles.every(helped) || !x.muscles.some(helped)))) {
      const name = g.name.toLowerCase();
      const ok = add({ kind: "gap", title: `Add exercises for your ${name}`, reason: g.muscles.every(helped) ? `Your routines only use your ${name} as a helper` : `None of your routines train your ${name}`, routineId: null, color: null, muscle: g.id, muscles: g.muscles });
      if (ok) for (const m of g.muscles) grouped.add(m);
    }
    for (const m of WATCH.filter((x) => !trained(x))) {
      const g = GROUPS.find((x) => x.muscles.includes(m))!;
      if (grouped.has(m)) continue; // the group's tip covers it
      // name what the group's routines do train, so it's clear which part is missing
      const others = g.muscles.filter((x) => x !== m && routineFor(x)), group = g.name.toLowerCase();
      const it = pronoun(m);
      const reason = helped(m) ? `Your routines only use ${it} as a helper`
        : others.length === g.muscles.length - 1 && others.length > 0 ? `Your routines train the rest of your ${group}, but not this part of your ${group}`
        : others.length ? `Your routines train your ${list(others.map(muscleLabel))}, but not this part of your ${group}`
        : `None of your routines train ${it}`;
      add({ kind: "target", title: `Add an exercise for your ${muscleLabel(m)}`, reason, routineId: null, color: null, muscle: m, muscles: [m] });
    }
  }

  // far fewer sets lately: under a quarter of what a typical big muscle got in four weeks
  const counts = big.map(sets).filter((n) => n > 0).sort((a, b) => a - b);
  const typical = counts.length >= 4 ? counts[Math.floor(counts.length / 2)]! : 0;
  if (typical >= 8) {
    const few = known(WATCH).filter((x) => routineFor(x) && sets(x) > 0 && sets(x) < typical / 4).sort((a, b) => sets(a) - sets(b));
    for (const m of few)
      muscleTip(m, "low", (_, name) => `Only ${sets(m)} ${sets(m) === 1 ? "set" : "sets"} for your ${name(m)} in 4 weeks, against ${typical} for most muscles`);
  }

  // the routines done longest ago (3 days or more); worded as the Routines page words them
  for (const r of d.routines.filter((x) => (x.daysAgo ?? 99) >= 3).sort((a, b) => (b.daysAgo ?? 9999) - (a.daysAgo ?? 9999)))
    add({ kind: "oldest", title: r.name, reason: r.daysAgo != null ? `Last done ${agoDays(r.daysAgo)}` : "Not done yet", routineId: r.id, color: r.color });

  // best first, but one of each kind before the second of any, so the three on Home aren't all gaps or all routines
  const nth = new Map<HomeSuggestion, number>(), seen: Record<string, number> = {};
  for (const x of out) { const f = family(x.kind); nth.set(x, (seen[f] = (seen[f] ?? -1) + 1)); }
  return out.map((x, i) => [x, i] as const).sort((a, b) => nth.get(a[0])! - nth.get(b[0])! || a[1] - b[1]).map(([x]) => x);
}
