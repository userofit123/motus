// Numbers, units and dates as the person likes them (Settings → Units & formats).
import { computed } from "vue";
import { fromKg, toKg, fromM, fromCm, toCm, num, clock, duration as dur, ymd, usesWeight, usesReps, type Settings, type Tracking } from "@motus/shared";
import { useSettings } from "../api/queries";

export function useFmt() {
  const s = useSettings();
  return computed(() => makeFmt(s.value));
}
export function makeFmt(s: Settings) {
  const wu = s.units.weight, du = s.units.distance, lu = s.units.length;
  const locale = s.dateFormat === "mdy" ? "en-US" : s.dateFormat === "ymd" ? "sv-SE" : "en-GB";
  const hour12 = s.clock === "12";
  return {
    s,
    wu, du, lu,
    /** a body measurement kept in cm, in cm or inches */
    len: (cm: number | null | undefined, dp = 1) => (cm == null ? "" : num(fromCm(cm, lu), dp)),
    toCm: (v: number) => toCm(v, lu),
    /** 80 kg → "80" (or "176.4" in lb) */
    w: (kg: number | null | undefined, dp = 1) => (kg == null ? "" : num(fromKg(kg, wu), dp)),
    wu_: (kg: number | null | undefined, dp = 1) => (kg == null ? "" : `${num(fromKg(kg, wu), dp)} ${wu}`),
    toKg: (v: number) => toKg(v, wu),
    fromKg: (kg: number) => fromKg(kg, wu),
    vol: (kg: number) => { const v = fromKg(kg, wu); return v >= 10000 ? `${num(v / 1000, 1)}k ${wu}` : `${num(v, 0)} ${wu}`; },
    dist: (m: number | null | undefined, dp = 2) => (m == null ? "" : `${num(fromM(m, du), dp)} ${du}`),
    distNum: (m: number) => fromM(m, du),
    pace: (s: number, m: number) => { if (!m || !s) return ""; const per = s / fromM(m, du); return `${clock(per)} /${du}`; },
    clock, dur,
    /** one set as done: "80 kg × 8", "12 reps", "1:30", "2.5 km" (what the exercise tracks) */
    set: (x: { weightKg: number | null; reps: number | null; durationS: number | null; distanceM: number | null }, t: Tracking | null | undefined) => {
      const w = x.weightKg != null && !!t && usesWeight(t) ? `${num(fromKg(x.weightKg, wu), 1)} ${wu}` : "";
      const r = x.reps != null && !!t && usesReps(t) ? (w ? `× ${x.reps}` : `${x.reps} rep${x.reps === 1 ? "" : "s"}`) : "";
      return [w, r, x.durationS ? clock(x.durationS) : "", x.distanceM ? `${num(fromM(x.distanceM, du), 2)} ${du}` : ""].filter(Boolean).join(" ");
    },
    date: (iso: string | null | undefined, o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) => (iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString(locale, o) : ""),
    dateLong: (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : ""),
    time: (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", hour12 }) : ""),
    ago: (iso: string | null | undefined) => ago(iso),
    num,
  };
}
export type Fmt = ReturnType<typeof makeFmt>;

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
