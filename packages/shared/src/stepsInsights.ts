// What a band's steps say beyond the day's total (M-246), for Stats → Steps: the longest stretch of the day with little
// walking, the run of days up to today that reached the steps goal, and the hour your days are usually busiest. Pure, so
// the rules are tested once and the page only shows them. Active minutes are not here: they are the Activity score's
// (scores.ts), shown as it counts them, so the two never disagree.

/** Steps in an hour from which trackers count it as an active hour; under it the hour has little walking */
export const ACTIVE_HOUR_STEPS = 250;
/** Hours in a row with little walking before a stretch is worth saying */
export const STILL_MIN_H = 2;
/** Days with hourly steps before "your usual busiest hour" means anything */
export const TYPICAL_MIN_DAYS = 3;

const HOUR = 3600_000;

/** An hour of steps: its start (ms) and the steps in it */
export interface StepHour { a: number; value: number }

/**
 * The longest run of hours in a row with fewer than ACTIVE_HOUR_STEPS steps, between the day's first and last active
 * hour (the waking part of the day as far as steps tell, so the night before and after is left out). An hour a workout
 * or activity overlaps (busy) breaks the run, since a ride or a gym session moves you without many steps; only hours
 * already over (ending by `now`) count. From steps, not posture: standing still reads the same as sitting.
 * null when no run reaches STILL_MIN_H hours. Hours in order, one per hour.
 */
export function stillStretch(hours: readonly StepHour[], busy: (a: number, b: number) => boolean, now = Infinity): { from: number; to: number; hours: number; steps: number } | null {
  const done = hours.filter((h) => h.a + HOUR <= now);
  const first = done.findIndex((h) => h.value >= ACTIVE_HOUR_STEPS);
  let last = -1;
  for (let i = done.length - 1; i >= 0; i--) if (done[i]!.value >= ACTIVE_HOUR_STEPS) { last = i; break; }
  if (first < 0 || last <= first) return null;
  let best: { from: number; to: number; hours: number; steps: number } | null = null;
  let start = -1, steps = 0;
  for (let i = first + 1; i <= last; i++) {
    const h = done[i]!;
    const still = h.value < ACTIVE_HOUR_STEPS && !busy(h.a, h.a + HOUR);
    if (still) { if (start < 0) { start = i; steps = 0; } steps += h.value; continue; }
    if (start >= 0) {
      const n = i - start;
      if (n >= STILL_MIN_H && (!best || n > best.hours)) best = { from: done[start]!.a, to: done[i - 1]!.a + HOUR, hours: n, steps };
      start = -1;
    }
  }
  return best;
}

/**
 * The run of days up to today that reached the goal (days in order, the last one today). Today counts once it has
 * reached the goal; until then a run that ends yesterday still stands (today isn't over). more: the run reaches the
 * first day given, so it may be longer than these days show.
 */
export function currentStreak(days: readonly string[], reached: (d: string) => boolean): { days: number; since: string | null; todayDone: boolean; more: boolean } {
  let i = days.length - 1;
  const todayDone = i >= 0 && reached(days[i]!);
  if (!todayDone) i--;
  let n = 0;
  while (i >= 0 && reached(days[i]!)) { n++; i--; }
  return { days: n, since: n ? days[i + 1]! : null, todayDone, more: n > 0 && i < 0 };
}

/**
 * The hour of the day with the most steps on average, over the days that have hourly steps at all: hour 0-23, its
 * average steps and the days counted. null under TYPICAL_MIN_DAYS days or without any steps.
 */
export function typicalHour(hours: readonly { day: string; hour: number; value: number }[]): { hour: number; avg: number; days: number } | null {
  const sums = new Map<number, number>(), days = new Set<string>();
  for (const h of hours) {
    if (h.value <= 0) continue;
    days.add(h.day);
    sums.set(h.hour, (sums.get(h.hour) ?? 0) + h.value);
  }
  if (days.size < TYPICAL_MIN_DAYS) return null;
  let top: [number, number] | null = null;
  for (const [hour, sum] of sums) if (!top || sum > top[1] || (sum === top[1] && hour < top[0])) top = [hour, sum];
  return top ? { hour: top[0], avg: top[1] / days.size, days: days.size } : null;
}
