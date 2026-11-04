// Units: data is stored in kg and metres; these convert for display and input.
export type WeightUnit = "kg" | "lb";
export type DistanceUnit = "km" | "mi";
export type LengthUnit = "cm" | "in";

export const KG_PER_LB = 0.45359237;
export const M_PER_MI = 1609.344;
export const CM_PER_IN = 2.54;

export const toKg = (v: number, u: WeightUnit) => (u === "lb" ? v * KG_PER_LB : v);
export const fromKg = (kg: number, u: WeightUnit) => (u === "lb" ? kg / KG_PER_LB : kg);
export const toM = (v: number, u: DistanceUnit) => (u === "mi" ? v * M_PER_MI : v * 1000);
export const fromM = (m: number, u: DistanceUnit) => (u === "mi" ? m / M_PER_MI : m / 1000);
export const toCm = (v: number, u: LengthUnit) => (u === "in" ? v * CM_PER_IN : v);
export const fromCm = (cm: number, u: LengthUnit) => (u === "in" ? cm / CM_PER_IN : cm);

/** A number for display: at most `dp` decimals, no trailing zeros. */
export function num(v: number | null | undefined, dp = 1): string {
  if (v == null || !Number.isFinite(v)) return "";
  const f = 10 ** dp;
  const r = Math.round(v * f) / f;
  return r.toLocaleString("en-US", { maximumFractionDigits: dp, useGrouping: Math.abs(r) >= 1000 });
}

/** Rounds a weight in the person's unit to the nearest step (2.5 kg / 5 lb plates by default), so 80 kg shown in lb is 176.4 not 176.369... */
export function roundWeight(kg: number, u: WeightUnit, step = u === "kg" ? 0.25 : 0.5): number {
  const v = fromKg(kg, u);
  return Math.round(v / step) * step;
}

/** 0:45, 1:30, 1:02:03 */
export function clock(totalS: number): string {
  const s = Math.max(0, Math.round(totalS));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

/** 45s, 1m 30s, 1h 5m - one compact form for every length of time in the app (timers, estimates, workouts);
 *  `short` leaves the seconds off once there are minutes ("~45m"). */
export function duration(totalS: number, short = false): string {
  const s = Math.max(0, Math.round(totalS));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  if (m) return short || !r ? `${m}m` : `${m}m ${r}s`;
  return short && !r ? "0m" : `${r}s`;
}
