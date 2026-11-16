// Readiness's parts as rows, in one place so Home's Readiness block and Stats → Scores read the same: what and its value
// against your usual, then how far off it is in the tone of what it does to the score (raises it: positive, lowers it:
// negative); a part still learning its usual says when its usual comes, with a muted "Learning" where a result goes.
import type { Readiness, ReadinessPart } from "../api/queries";
import { mins } from "./sleep";

type Num = (v: number) => string;
export type ReadyKey = ReadinessPart["key"];
export interface ReadyRow { key: ReadyKey; icon: string; t: string; s: string; r: string; tone?: "pos" | "neg" | "muted" }

/** Each part's icon and name */
export const READY_PART: Record<ReadyKey, { icon: string; t: string }> = {
  sleep: { icon: "moon", t: "Sleep" }, restingHr: { icon: "heartPulse", t: "Resting heart rate" }, hrv: { icon: "wave", t: "HRV" }, load: { icon: "load", t: "Training load" },
};
/** A part's value as its row writes it: sleep in hours (as the day's log keeps it) as time asleep; Training load (a
 *  feature) as the last 7 days' load, since a load has no unit and each number says what span it covers */
export function readyValue(k: ReadyKey, v: number, num: Num): string {
  switch (k) {
    case "sleep": return mins(v * 60);
    case "restingHr": return `${Math.round(v)} bpm`;
    case "hrv": return `${Math.round(v)} ms`;
    case "load": return `${num(v)} in 7 days`;
  }
}
/** The parts in the score's order: sleep, resting heart rate, HRV, then the training load */
export const READY_ORDER: ReadyKey[] = ["sleep", "restingHr", "hrv", "load"];

/** Every part of a readiness as a row (with `extra` rows a screen adds, e.g. Home's short night), in READY_ORDER */
export function readinessRows(r: Readiness, num: Num, extra: ReadyRow[] = []): ReadyRow[] {
  const f = (k: ReadyKey, v: number) => readyValue(k, v, num);
  const ready = r.parts.filter((x) => x.value != null).map((x): ReadyRow => {
    const p = READY_PART[x.key], d = x.baseline != null ? x.value! - x.baseline : 0;
    return { key: x.key, icon: p.icon, t: p.t, s: x.baseline != null ? `${f(x.key, x.value!)} · usual ${x.key === "load" ? `${num(x.baseline)} a week` : f(x.key, x.baseline)}` : f(x.key, x.value!),
      // the load's points mean nothing alone: how far off is a share of the usual, as Stats → Heart's card says it
      r: x.effect === "flat" || x.baseline == null ? "As usual" : x.key === "load" ? `${x.change! < 0 ? "-" : "+"}${Math.abs(Math.round(x.change!))}%` : `${d < 0 ? "-" : "+"}${f(x.key, Math.abs(d))}`,
      tone: x.effect === "up" ? "pos" : x.effect === "down" ? "neg" : undefined };
  });
  const building = (r.building ?? []).map((x): ReadyRow => {
    const left = (r.need ?? 7) - x.days;
    return { key: x.key, icon: READY_PART[x.key].icon, t: READY_PART[x.key].t, s: `${f(x.key, x.value)} · usual in ${left} ${left === 1 ? "day" : "days"}`, r: "Learning", tone: "muted" };
  });
  return [...ready, ...building, ...extra].sort((a, b) => READY_ORDER.indexOf(a.key) - READY_ORDER.indexOf(b.key));
}
