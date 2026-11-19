// Body numbers worked out in one place for the Body page: the smoothed weight trend and when it is shown, the change over a period, signs.
import { num } from "@motus/shared";

export interface Pt { x: number; y: number }

/** How fast the weight trend forgets: a weigh-in counts e^-1 (about a third) as much a week later. Set in days, not
 *  weigh-ins, so someone who weighs in once a week gets a trend as current as someone who does it daily. */
const TREND_DAYS = 7;

/** Body weight smoothed over the whole history (oldest first), so one day's water weight doesn't swing it: at each
 *  weigh-in, the average of every weigh-in so far, each counting less the older it is (TREND_DAYS). An average, not a
 *  value seeded at the first weigh-in and nudged 15% at a time, which crawled far below a few rising weigh-ins (M-278).
 *  Smoothed on the exact values and rounded only at the end. */
export function weightTrend(pts: Pt[]): Pt[] {
  let sum = 0, weight = 0, prev: number | null = null;
  return pts.map((p) => {
    const fade = prev == null ? 0 : Math.exp(-(p.x - prev) / (TREND_DAYS * 86400000));
    sum = sum * fade + p.y; weight = weight * fade + 1; prev = p.x;
    return { x: p.x, y: Math.round((sum / weight) * 10) / 10 };
  });
}

/** The trend is drawn and named only from this many weigh-ins over this many days: fewer, and it is just the
 *  weigh-ins' average, which says less than the weigh-ins themselves. */
export const TREND_LINE_MIN_ENTRIES = 7;
export const TREND_LINE_MIN_DAYS = 14;
/** Whether a weight history (oldest first) is long enough for its trend to mean something (TREND_LINE_MIN_*). */
export const hasTrend = (pts: Pt[]) => pts.length >= TREND_LINE_MIN_ENTRIES && days(pts[0]!.x, pts.at(-1)!.x) >= TREND_LINE_MIN_DAYS;

/** Calendar days from one time to another: 11 Nov in the evening to 18 Nov in the morning is 7 days, as the person
 *  counts it, though it is less than 7 x 24 hours. */
function days(a: number, b: number): number {
  const d = (t: number) => { const x = new Date(t); return Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()); };
  return Math.round((d(b) - d(a)) / 86400000);
}

const inside = (x: number, from?: Date | number | null, to?: Date | number | null) => (from == null || x >= +from) && (to == null || x < +to);

/** A trend is only claimed from enough data: at least this many entries, spanning at least this many days. One rule for
 *  every "it moved by ..." line, so two weigh-ins a day apart never read as a trend. */
export const TREND_MIN_ENTRIES = 3;
export const TREND_MIN_DAYS = 7;

/** How much a series (oldest first) changed over a period: from the last value before it to the last value in it, or
 *  from the first value in it when there is nothing before. Null when the period has nothing to compare, or too little
 *  data to call it a trend (TREND_MIN_ENTRIES entries over TREND_MIN_DAYS calendar days, not 24-hour spans: 3 weigh-ins
 *  from 11 Nov evening to 18 Nov morning do count, M-278). */
export function changeOver(pts: Pt[], from?: Date | number | null, to?: Date | number | null): number | null {
  let before: Pt | undefined, first: Pt | undefined, last: Pt | undefined;
  for (const p of pts) {
    if (inside(p.x, from, to)) { first ??= p; last = p; }
    else if (from != null && p.x < +from) before = p;
  }
  const start = before ?? first;
  if (!last || start === last) return null;
  const n = pts.filter((p) => p.x >= start!.x && p.x <= last!.x).length;
  if (n < TREND_MIN_ENTRIES || days(start!.x, last.x) < TREND_MIN_DAYS) return null;
  return Math.round((last.y - start!.y) * 10) / 10;
}

/** A change with its sign, plain dashes only (no true minus in the UI): "+1.2 kg", "-0.4 cm", "±0 %". Rounded before the
 *  sign is picked, so a tiny change never reads "+0". */
export function signed(v: number, u = "", dp = 1): string {
  const r = Math.round(v * 10 ** dp) / 10 ** dp;
  return `${r > 0 ? "+" : r < 0 ? "-" : "±"}${num(Math.abs(r), dp)}${u ? " " + u : ""}`;
}
