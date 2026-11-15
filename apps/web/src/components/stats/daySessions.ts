// The day charts' shared pieces (Stats → Steps and Stats → Heart): the day's workouts and activities with their exact
// time spans, each in the colour the Calendar gives it (a workout its routine's, else the accent; an activity teal), the
// legend naming each kind on the chart, the hours the axis labels sit at, and the title of a day in the day picker.
import { computed, type Ref } from "vue";
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
/** The colours the Calendar marks sessions in */
export const WORKOUT_COLOR = "var(--acc)", ACTIVITY_COLOR = "var(--c3)";
/** The day charts' own data (steps, heart rate) in the palette's slate, so any session colour reads apart from it */
export const DAY_DATA_COLOR = "var(--c6)";

const num = (v: number | string | null | undefined) => (v == null || v === "" || !(Number(v) > 0) ? null : Number(v));
const midnight = (d: string) => new Date(d + "T00:00").getTime();
const nextMidnight = (d: string) => { const x = new Date(d + "T00:00"); x.setDate(x.getDate() + 1); return x.getTime(); };

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

/** The day picker's title: "Today", "Yesterday", "Mon, 9 Nov" (with its year when not this one) */
export function dayTitle(day: string, today: string, fmt: ReturnType<typeof useFmt>["value"]) {
  const y = new Date(today + "T12:00"); y.setDate(y.getDate() - 1);
  const yest = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
  if (day === today) return "Today";
  if (day === yest) return "Yesterday";
  return fmt.date(day, day.slice(0, 4) === today.slice(0, 4) ? { weekday: "short", day: "numeric", month: "short" } : { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
