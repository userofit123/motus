// Numbers, units and dates as the person likes them (Settings → Units & formats).
import { computed } from "vue";
import { fromKg, toKg, fromM, fromCm, toCm, num, clock, duration as dur, ymd, usesWeight, usesReps, usesDuration, sideRounds, type Settings, type Tracking } from "@motus/shared";
import { useSettings } from "../api/queries";

export function useFmt() {
  const s = useSettings();
  return computed(() => makeFmt(s.value));
}
export function makeFmt(s: Settings) {
  const wu = s.units.weight, du = s.units.distance, lu = s.units.length;
  const locale = s.dateFormat === "mdy" ? "en-US" : s.dateFormat === "ymd" ? "sv-SE" : "en-GB";
  const hour12 = s.clock === "12";
  const w = (kg: number | null | undefined, dp = 1) => (kg == null ? "" : num(fromKg(kg, wu), dp));
  const wu_ = (kg: number | null | undefined, dp = 1) => (kg == null ? "" : `${w(kg, dp)} ${wu}`);
  const dist = (m: number | null | undefined, dp = 2) => (m == null ? "" : `${num(fromM(m, du), dp)} ${du}`);
  return {
    s,
    wu, du, lu,
    /** a body measurement kept in cm, in cm or inches */
    len: (cm: number | null | undefined, dp = 1) => (cm == null ? "" : num(fromCm(cm, lu), dp)),
    toCm: (v: number) => toCm(v, lu),
    /** 80 kg → "80" (or "176.4" in lb) */
    w,
    wu_,
    toKg: (v: number) => toKg(v, wu),
    fromKg: (kg: number) => fromKg(kg, wu),
    vol: (kg: number) => { const v = fromKg(kg, wu); return v >= 10000 ? `${num(v / 1000, 1)}k ${wu}` : `${num(v, 0)} ${wu}`; },
    dist,
    distNum: (m: number) => fromM(m, du),
    pace: (s: number, m: number) => { if (!m || !s) return ""; const per = s / fromM(m, du); return `${clock(per)} /${du}`; },
    clock, dur,
    /** one set as done: "80 kg × 8", "12 reps", "1:30", "15 reps in 1:00", "2.5 km" (what the exercise tracks) */
    set: (x: SetFigures, t: Tracking | null | undefined) => {
      const kg = x.weightKg != null && !!t && usesWeight(t) ? wu_(x.weightKg) : "";
      // reps logged before the exercise stopped being counted in reps still show (a set with no time has nothing else to say)
      const r = x.reps != null && !!t && (usesReps(t) || (!!x.reps && !x.durationS)) ? (kg ? `× ${x.reps}` : `${x.reps} rep${x.reps === 1 ? "" : "s"}`) : "";
      const d = x.distanceM ? dist(x.distanceM) : "";
      // time against reps or distance reads "in": "15 reps in 1:00", "20 kg × 15 in 1:00", "2.5 km in 12:00"; alone it is the plain clock
      const time = x.durationS ? (r || d ? `in ${clock(x.durationS)}` : clock(x.durationS)) : "";
      return [kg, r, d, time].filter(Boolean).join(" ");
    },
    date: (iso: string | null | undefined, o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) => (iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString(locale, o) : ""),
    /** a planned day in words: "today", "tomorrow", else "Tue 10 Nov" (with the year when it isn't this year) */
    day: (d: string) => { const t = new Date(); if (d === ymd(t)) return "today"; t.setDate(t.getDate() + 1); if (d === ymd(t)) return "tomorrow"; const x = new Date(d + "T12:00:00"); return x.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", ...(x.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) }); },
    dateLong: (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : ""),
    time: (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", hour12 }) : ""),
    ago: (iso: string | null | undefined) => ago(iso),
    num,
  };
}
export type Fmt = ReturnType<typeof makeFmt>;
/** What fmt.set reads from a set (a logged set, a planned one or a record) */
export interface SetFigures { weightKg: number | null; reps: number | null; durationS: number | null; distanceM: number | null }

export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso), now = new Date();
  const days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 730) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}
/** A date as YYYY-MM-DD on this device's calendar (the shared ymd, under the name the screens use). */
export const localYmd = ymd;
// tomorrow by calendar (not now + 24h, which lands on the wrong day across a clock change)
export const tomorrowYmd = () => { const n = new Date(); return ymd(new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1)); };
// the icon for an activity type: its own for the common ones, else the general one (shared by Home and History)
const ACTIVITY_ICONS = ["walk", "run", "cycle", "hike", "swim", "yoga"];
export const activityIcon = (type?: string | null) => (type && ACTIVITY_ICONS.includes(type) ? type : "activity");

/** "62.5 / 80 kg" in your units: goals keep weights in kg and distances in km.
 *  Body goals read "now → target" ("87.5 → 85 cm"), which says where you are and where you're heading either way, without a value judgement. */
export function goalLabel(g: { target: number; scope?: string; progress?: { current: number; label: string; unit?: string } | null }, f: { w: (kg: number) => string; wu: string; distNum: (m: number) => number; du: string; len: (cm: number) => string; lu: string }) {
  const p = g.progress;
  if (!p) return "";
  if (g.scope === "body") {
    const show = (v: number) => (p.unit === "kg" ? f.w(v) : p.unit === "cm" ? f.len(v) : num(v, 1));
    const u = p.unit === "kg" ? f.wu : p.unit === "cm" ? f.lu : p.unit === "%" ? "%" : "";
    const tail = u === "%" ? "%" : ` ${u}`;
    return p.current ? `${show(p.current)} → ${show(g.target)}${tail}` : `Target ${show(g.target)}${tail}`;
  }
  if (p.unit === "kg") return `${f.w(p.current)} / ${f.w(g.target)} ${f.wu}`;
  if (p.unit === "cm") return `${f.len(p.current)} / ${f.len(g.target)} ${f.lu}`;
  if (p.unit === "km") return `${num(f.distNum(p.current * 1000), 1)} / ${num(f.distNum(g.target * 1000), 1)} ${f.du}`;
  return p.label;
}

/** The kinds a set can be switched to from its ⋮ menu, each with its own icon (a drop set is added, not switched to). */
export const SET_KINDS = [["normal", "Normal", "dumbbell"], ["warmup", "Warm-up", "flame"], ["failure", "To failure", "target"]] as const;

type SetLike = { kind: string; side?: string | null };
/** A working set's number in a list of sets (warm-ups and drops have none of their own). With sides shown (the
 * feature is on), a left and right round (a left set and a right one next to each other, either order, of the same
 * kind: sideRounds) shares a number, "1L" "1R", as general sets beside them count on: 1, 2, 3L, 3R. */
export function setNo(sets: SetLike[], j: number, sides = false) {
  const second = sides ? sideRounds(sets) : [];
  let n = 0;
  for (let i = 0; i <= j && i < sets.length; i++) {
    const x = sets[i]!;
    if (x.kind === "warmup" || x.kind === "drop" || second[i - 1]) continue;
    n++;
  }
  return n;
}
/** The working sets counted by rounds (a left and right round is one set, as setNo numbers them), and how many of
 * those rounds are for one side, said the same on the routine page and in the editor: "3 sets · left and right", or
 * "4 sets · 1 left and right" in a mix. `sides`: the feature is on. */
export function setRounds(sets: SetLike[], sides: boolean): { n: number; sides: string } {
  const second = sides ? sideRounds(sets) : [];
  let n = 0, sided = 0;
  sets.forEach((x, i) => {
    if (x.kind === "warmup" || x.kind === "drop" || second[i - 1]) return;
    n++;
    if (sides && x.side) sided++;
  });
  return { n, sides: !sided ? "" : sided === n ? "left and right" : `${sided} left and right` };
}
/** "3 × 8-12 · 60 kg": an exercise's working sets in one line, counted by rounds (setRounds); the routine editor's
 *  folded cards and overview and the routine page's exercise cards, so both say the same */
export function setSummary(sets: any[], t: Tracking, f: { clock: (s: number) => string; w: (kg: number) => string; wu: string }, sides: boolean) {
  const work = sets.filter((x: any) => x.kind !== "warmup" && x.kind !== "drop"), warm = sets.filter((x: any) => x.kind === "warmup").length;
  const drops = sets.length - work.length - warm;
  const same = (k: string) => work.length && work.every((x: any) => x[k] === work[0][k]);
  const reps = (x: any) => `${x.reps ?? "-"}`;
  // one entry per round: the second set of a left and right round joins its first ("10/8" when the sides differ)
  const second: boolean[] = sides ? sideRounds(sets) : [];
  const rounds: any[][] = [];
  sets.forEach((x: any, i: number) => {
    if (x.kind === "warmup" || x.kind === "drop") return;
    if (second[i - 1]) rounds[rounds.length - 1]!.push(x); else rounds.push([x]);
  });
  const r = setRounds(sets, sides), n = `${r.n} set${r.n === 1 ? "" : "s"}`;
  let what = "";
  if (usesReps(t)) what = same("reps") ? `${r.n} × ${reps(work[0])}` : rounds.map((g: any[]) => [...new Set(g.map(reps))].join("/")).join(", ");
  else if (usesDuration(t)) what = same("durationS") && work[0]?.durationS ? `${r.n} × ${f.clock(work[0].durationS)}` : n;
  else what = n;
  const w = usesWeight(t) && same("weightKg") && work[0]?.weightKg != null ? ` · ${f.w(work[0].weightKg)} ${f.wu}` : "";
  const sd = r.sides ? ` · ${r.sides}` : "";
  return `${what}${w}${sd}${warm ? ` · ${warm} warm-up` : ""}${drops ? ` · ${drops} drop${drops === 1 ? "" : "s"}` : ""}`;
}
/** The bar joining a left and right round's badges (sideJoins), as classes on set j's badge cell: `sj-a` on the first side
 * (bar down from its badge), `sj-b` on the second (bar up to its badge), `sj-m` for a row between them (an own-rest row);
 * green (`sj-done`) once the first side is done, as in the workout. Styles in app.css. */
export function sideJoinCls(sets: readonly object[], joins: boolean[], j: number, mid = false) {
  // routine sets have no done state, so it is read only where a set carries one
  const done = (i: number) => { const x = sets[i]; return !!x && "done" in x && !!(x as { done?: boolean }).done; };
  const a = !!joins[j], b = !mid && !!joins[j - 1];
  return { "sj-a": a && !mid, "sj-m": a && mid, "sj-b": b, "sj-done": (a && done(j)) || (b && done(j - 1)) };
}
/** A set's short label in a list of sets: its number, W for a warm-up, F to failure, drops numbered within their set (D1,
 * D2…); with sides shown, L or R after it ("1L"). */
export function setLabel(sets: SetLike[], j: number, sides = false) {
  const k = sets[j]?.kind, side = sides ? sets[j]?.side ?? "" : "";
  // warm-ups keep a plain "W": the side letter is for the sets that count
  if (k === "warmup") return "W";
  if (k === "failure") return "F" + side;
  if (k !== "drop") return String(setNo(sets, j, sides)) + side;
  let n = 1; while (sets[j - n]?.kind === "drop") n++;
  return `D${n}`;
}
