// Body numbers worked out and shown the same way on the Body page and Stats → Body, so the two never disagree.
import { num } from "@motus/shared";

export interface Pt { x: number; y: number }

/** Body weight smoothed over the whole history (oldest first): each weigh-in moves the trend 15% of the way, so one
 *  day's water weight doesn't swing it. Smoothed on the exact values and rounded only at the end. */
export function weightTrend(pts: Pt[]): Pt[] {
  let e: number | null = null;
  return pts.map((p) => { e = e == null ? p.y : e + 0.15 * (p.y - e); return { x: p.x, y: Math.round(e * 10) / 10 }; });
}

const inside = (x: number, from?: Date | number | null, to?: Date | number | null) => (from == null || x >= +from) && (to == null || x < +to);

/** A trend is only claimed from enough data: at least this many entries, spanning at least this many days. One rule for
 *  every "it moved by ..." line, so two weigh-ins a day apart never read as a trend. */
export const TREND_MIN_ENTRIES = 3;
export const TREND_MIN_DAYS = 7;

/** How much a series (oldest first) changed over a period: from the last value before it to the last value in it, or
 *  from the first value in it when there is nothing before. Null when the period has nothing to compare, or too little
 *  data to call it a trend (TREND_MIN_ENTRIES entries over TREND_MIN_DAYS days). */
export function changeOver(pts: Pt[], from?: Date | number | null, to?: Date | number | null): number | null {
  let before: Pt | undefined, first: Pt | undefined, last: Pt | undefined;
  for (const p of pts) {
    if (inside(p.x, from, to)) { first ??= p; last = p; }
    else if (from != null && p.x < +from) before = p;
  }
  const start = before ?? first;
  if (!last || start === last) return null;
  const n = pts.filter((p) => p.x >= start!.x && p.x <= last!.x).length;
  if (n < TREND_MIN_ENTRIES || last.x - start!.x < TREND_MIN_DAYS * 86400000) return null;
  return Math.round((last.y - start!.y) * 10) / 10;
}

/** A change with its sign, plain dashes only (no true minus in the UI): "+1.2 kg", "-0.4 cm", "±0 %". Rounded before the
 *  sign is picked, so a tiny change never reads "+0". */
export function signed(v: number, u = "", dp = 1): string {
  const r = Math.round(v * 10 ** dp) / 10 ** dp;
  return `${r > 0 ? "+" : r < 0 ? "-" : "±"}${num(Math.abs(r), dp)}${u ? " " + u : ""}`;
}
