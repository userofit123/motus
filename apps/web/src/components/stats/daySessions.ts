// The day pages' shared pieces (Stats → Steps, Heart and Sleep, and their helpers): the day's workouts and activities with
// their exact time spans, each in the colour the Calendar gives it (a workout its routine's, else the palette's purple; an
// activity green), the legend naming each kind on the chart, the hours the axis labels sit at, the line said when a day or
// night has no saved records, the title of a day or night in the day picker, and the week, month and year stretches the
// arrows step through.
import { computed, onScopeDispose, ref, type Ref } from "vue";
import { ymd, weekStartDate } from "@motus/shared";
import { useCalendar, useTypeName } from "../../api/queries";
import { activityIcon, type useFmt } from "../../core/format";

export interface DaySession {
  key: string; kind: "workout" | "activity"; icon: string; name: string; color: string;
  /** what the legend calls it: "Workout", or the activity's type ("Walk") */
  kindName: string;
  /** its start and end, in ms */
  a: number; b: number; durationS: number;
  avgHr: number | null; maxHr: number | null; steps: number | null;
}
/** The colours the Calendar marks sessions in (it imports these, so the Calendar and Stats always match): a workout
 *  without a routine colour in the palette's purple, not the accent, which the day charts' own data already uses (two
 *  alike swatches in one legend); an activity in the palette's green, a colour no sleep stage uses (REM is teal, deep the
 *  accent, awake the warning colour), so on a chart with the night a session's swatch never seems to name a stage */
export const WORKOUT_COLOR = "var(--c5)", ACTIVITY_COLOR = "var(--c4)";
/** The day charts' own data (steps, heart rate) in the accent as every other chart's; the sessions read apart from it by
 *  their tinted span, the strip along its foot, the legend and the list under the chart */
export const DAY_DATA_COLOR = "var(--acc)";

/** Today as "YYYY-MM-DD", moving on past midnight while a tab stays open (checked each minute and when the app comes
 *  back to the front), so "Today", "Last night" and the never-past-today arrows stay right */
export function useToday() {
  const today = ref(ymd(new Date()));
  const tick = () => { const d = ymd(new Date()); if (d !== today.value) today.value = d; };
  const id = setInterval(tick, 60_000);
  document.addEventListener("visibilitychange", tick);
  onScopeDispose(() => { clearInterval(id); document.removeEventListener("visibilitychange", tick); });
  return today;
}

const num = (v: number | string | null | undefined) => (v == null || v === "" || !(Number(v) > 0) ? null : Number(v));
/** A day's ("YYYY-MM-DD") local midnight and the next one, in ms */
export const midnight = (d: string) => new Date(d + "T00:00").getTime();
export const nextMidnight = (d: string) => { const x = new Date(d + "T00:00"); x.setDate(x.getDate() + 1); return x.getTime(); };

/** The day's sessions, oldest first, from the Calendar's data (kept on screen while the next day loads) */
export function useDaySessions(day: Ref<string>, enabled: Ref<boolean>) {
  const typeName = useTypeName();
  const q = useCalendar(computed(() => ({ from: day.value, to: day.value })), enabled, { keep: true });
  // the day before's while the next one loads (as its query keeps it), not an empty list for a moment
  let last: DaySession[] = [];
  const sessions = computed<DaySession[]>(() => {
    const c = q.data.value;
    if (!c) return [];
    if (q.isPlaceholderData.value) return last;
    const lo = midnight(day.value), hi = nextMidnight(day.value);
    const span = (startedAt: string, durationS: number | string | null) => { const a = new Date(startedAt).getTime(), s = Number(durationS) || 0; return { a, b: a + s * 1000, durationS: s }; };
    const out = [
      ...c.workouts.map((w) => ({ key: `/workouts/${w.id}`, kind: "workout" as const, icon: "dumbbell", name: w.name || "Workout", color: w.color ?? WORKOUT_COLOR, kindName: "Workout",
        ...span(w.startedAt, w.durationS), avgHr: num(w.avgHr), maxHr: num(w.maxHr), steps: null })),
      ...c.activities.map((x) => ({ key: `/activities/${x.id}`, kind: "activity" as const, icon: activityIcon(x.type), name: x.name || typeName(x.type), color: ACTIVITY_COLOR, kindName: typeName(x.type),
        ...span(x.startedAt, x.durationS), avgHr: num(x.avgHr), maxHr: num(x.maxHr), steps: num(x.steps) })),
    ].filter((x) => x.a >= lo && x.a < hi).sort((x, y) => x.a - y.a);
    return (last = out);
  });
  return { q, sessions };
}

/** One entry per colour on the chart: its kind's name, or "Workouts" / "Activities" when it marks several kinds */
export function legendOf(sessions: DaySession[]) {
  const by = new Map<string, DaySession[]>();
  for (const x of sessions) if (x.b > x.a) by.set(x.color, [...(by.get(x.color) ?? []), x]);
  return [...by].map(([color, xs]) => {
    const names = [...new Set(xs.map((x) => (x.kind === "workout" && by.size > 1 && xs.every((y) => y.kind === "workout") ? x.name : x.kindName)))];
    return { color, name: names.length === 1 ? names[0]! : xs.every((x) => x.kind === "workout") ? "Workouts" : xs.every((x) => x.kind === "activity") ? "Activities" : "Workouts and activities" };
  });
}

/** The hour labels both day charts use: midnight, 6, 12 and 18 o'clock of the day, as [ms, text] */
export function dayHours(day: string, fmt: ReturnType<typeof useFmt>["value"]) {
  return [0, 6, 12, 18].map((h) => { const d = new Date(day + "T00:00"); d.setHours(h, 0, 0, 0); return { at: d.getTime(), text: fmt.time(d.toISOString()) }; });
}

/** What a day or night says when only its totals were saved (it synced before Motus kept every band record): the same
 *  sentence on Steps, Heart and Sleep */
export const noRecords = (what: "day" | "night") => `No hour-by-hour records were saved for this ${what}, only its totals.`;

/** A night's title in the night picker, by the day it ended (the night's date): "Last night" for the one that ended
 *  today (as the Today chip, which says "Last night" on Sleep), else that day as the day picker names it */
export function nightTitle(day: string, today: string, fmt: ReturnType<typeof useFmt>["value"]) {
  return day === today ? "Last night" : day.slice(0, 4) === today.slice(0, 4) ? fmt.date(day, { weekday: "short", day: "numeric", month: "short" }) : fmt.date(day, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/** The day picker's title: "Today", "Yesterday", "Mon, 9 Nov" (with its year when not this one) */
export function dayTitle(day: string, today: string, fmt: ReturnType<typeof useFmt>["value"]) {
  const y = new Date(today + "T12:00"); y.setDate(y.getDate() - 1);
  const yest = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
  if (day === today) return "Today";
  if (day === yest) return "Yesterday";
  return fmt.date(day, day.slice(0, 4) === today.slice(0, 4) ? { weekday: "short", day: "numeric", month: "short" } : { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/** What Stats → Steps and Heart show at once: a day, or the week, month or year around it */
export type StretchView = "day" | "week" | "month" | "year";
const atNoon = (d: string) => new Date(d + "T12:00");
const plusDays = (d: string, n: number) => { const x = atNoon(d); x.setDate(x.getDate() + n); return ymd(x); };
/** The stretch [from, to) a view shows around a day: the day, its week (from the first day of the week in Settings),
 *  month or year */
export function stretchOf(view: StretchView, day: string, firstDay: number) {
  const a = atNoon(day);
  if (view === "day") return { from: day, to: plusDays(day, 1) };
  if (view === "week") { const w = ymd(weekStartDate(a, firstDay)); return { from: w, to: plusDays(w, 7) }; }
  if (view === "month") return { from: ymd(new Date(a.getFullYear(), a.getMonth(), 1)), to: ymd(new Date(a.getFullYear(), a.getMonth() + 1, 1)) };
  return { from: ymd(new Date(a.getFullYear(), 0, 1)), to: ymd(new Date(a.getFullYear() + 1, 0, 1)) };
}
/** The day a step of the arrows lands on, never past today (a later week, month or year lands on today) */
export function stepDay(view: StretchView, day: string, n: number, today: string) {
  const a = atNoon(day);
  if (view === "day") a.setDate(a.getDate() + n);
  else if (view === "week") a.setDate(a.getDate() + 7 * n);
  else if (view === "month") a.setMonth(a.getMonth() + n, 1);
  else a.setFullYear(a.getFullYear() + n, 0, 1);
  return ymd(a) > today ? today : ymd(a);
}
/** The bar's title for a stretch: the day's, a week as "9 Nov-15 Nov" (another year's in short numeric dates, so its
 *  year still fits between the arrows on a phone), "November 2026", "2026" */
export function stretchTitle(view: StretchView, r: { from: string; to: string }, today: string, fmt: ReturnType<typeof useFmt>["value"]) {
  const thisYear = r.from.slice(0, 4) === today.slice(0, 4);
  if (view === "day") return dayTitle(r.from, today, fmt);
  if (view === "week") { const last = plusDays(r.to, -1); return thisYear ? `${fmt.date(r.from, { day: "numeric", month: "short" })}-${fmt.date(last, { day: "numeric", month: "short" })}`
    : `${fmt.date(r.from, { day: "numeric", month: "numeric" })}-${fmt.date(last, { day: "numeric", month: "numeric", year: "2-digit" })}`; }
  if (view === "month") return fmt.date(r.from, { month: "long", year: "numeric" });
  return r.from.slice(0, 4);
}
