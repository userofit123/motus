// A program's length and end, worked out the same way by the server (engine/modules/programs.ts) and the program form.

/** "1 week", "8 weeks" */
export const weeksText = (n: number) => `${n} ${n === 1 ? "week" : "weeks"}`;

/**
 * The last day of a program's last week (YYYY-MM-DD), counted from the day it starts: a 1-week program starting on
 * Monday ends on Sunday. Null with no start yet, or with no weeks (there is no last week to end on).
 */
export function programEnd(startsOn: string | null, weeks: number): string | null {
  if (!startsOn || weeks < 1) return null;
  return new Date(Date.parse(startsOn.slice(0, 10) + "T00:00:00Z") + (weeks * 7 - 1) * 86400000).toISOString().slice(0, 10);
}
