<script setup lang="ts">
// Stats → Sleep, there only once a band has handed over sleep. Night: one night in full (NightView), stepped through
// with ‹ › a night at a time. Week, month, year: the averages, what stands out (only what the nights say), the longest
// and shortest night and the sleep debt, how you sleep after workout days against rest days, time asleep each night (by
// stage when the band told them apart), when nights began and ended, and the heart rate, blood oxygen and breathing
// while asleep; a night tapped opens it in the Night view.
// Nights come from /health/sleep; a day with only its hours of sleep (an older import, a typed number) still counts in
// the time-asleep chart and average, from the daily log. A record under MIN_NIGHT_H hours is a nap or partial record,
// not a night: it keeps its bar (in grey) and its row, but every average, count and usual time leaves it out.
import { computed, ref, watch } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import { ymd, weekStartOf, isNightMin, MIN_NIGHT_H } from "@motus/shared";
import { api } from "../../api/client";
import { useSettings, useWorkouts, useSleep, useHealthDay, type SleepNight } from "../../api/queries";
import { useFmt, localYmd } from "../../core/format";
import { STAGES, NO_STAGES_COLOR, NO_STAGES_SWATCH, SHORT_COLOR, hasStages, isFull, asleepMin, inBedMin, efficiency, awakeKnown, nightMin, nightIso, mins, typical, pctDown } from "../../core/sleep";
import Icon from "../Icon.vue";
import Ring from "../Ring.vue";
import { adviceWord, deviceWord, useDevice } from "../../native/health";
import BarChart from "../BarChart.vue";
import LineChart from "../LineChart.vue";
import Sparkline from "../Sparkline.vue";
import SleepSchedule from "./SleepSchedule.vue";
import NightView from "./NightView.vue";
import DayNav from "./DayNav.vue";
import { useToday, nightTitle, stretchOf, stepDay, stretchTitle } from "./daySessions";

export type SleepView = "night" | "week" | "month" | "year";
const view = defineModel<SleepView>("view", { required: true });
const props = defineProps<{ day?: string }>();
const emit = defineEmits<{ "update:day": [day: string] }>();
const fmt = useFmt();
const s = useSettings();
const dev = useDevice();

// days as "YYYY-MM-DD" in the app's calendar; a Date at noon, so a clock change never tips it into the next day. A night
// goes by the day it ended (its date), so the night of today is "Last night", as the chip that brings it back says
const today = useToday();
const at = (d: string) => new Date(d + "T12:00");
const plus = (d: string, n: number) => { const x = at(d); x.setDate(x.getDate() + n); return ymd(x); };
const anchor = ref(props.day && props.day <= today.value ? props.day : today.value);
// opened without a day, it moves to the newest night once the nights are in (until then nothing goes into the link)
const picked = ref(!!props.day);
// opened again from elsewhere (Home, the calendar) with a day while this tab is still around
watch(() => props.day, (d) => { if (d && d <= today.value && d !== anchor.value) { anchor.value = d; picked.value = true; view.value = "night"; } });
// the shown night into the link, as Steps' and Heart's day, so a refresh or Back opens it again
watch([anchor, view, picked], ([d, v, p]) => { if (v === "night" && p && d !== props.day) emit("update:day", d); });
const isNight = computed(() => view.value === "night");

// the nights to step through, around the chosen day: its month, the nights before it (the newest first, so the one just
// before is always there) and the 400 days after it (at most one night a day, so the one just after is always there).
// Each key moves only with the month, keeping the last answer while the next loads
const mStart = computed(() => { const a = at(anchor.value); return ymd(new Date(a.getFullYear(), a.getMonth(), 1)); });
const mEnd = computed(() => { const a = at(anchor.value); return ymd(new Date(a.getFullYear(), a.getMonth() + 1, 1)); });
const monthQ = useSleep(computed(() => ({ from: mStart.value, to: mEnd.value })), isNight, { keep: true });
const olderQ = useSleep(computed(() => ({ from: "1970-01-01", to: mStart.value })), isNight, { keep: true });
const newerQ = useSleep(computed(() => ({ from: mEnd.value, to: plus(mEnd.value, 400) })), isNight, { keep: true });
// newest first
const stepList = computed(() => [...new Set([...(newerQ.data.value?.nights ?? []), ...(monthQ.data.value?.nights ?? []), ...(olderQ.data.value?.nights ?? [])].map((n) => n.date))].sort().reverse());
// the chosen day's own night, never another one: a day without one says so (with its logged hours, when it has them).
// Looked up in all three lists, so a step (or the first jump to the newest night) into another month finds it in the
// list that already held it while the month's own list loads, instead of saying "No night" for a moment
const night = computed(() => [monthQ, olderQ, newerQ].flatMap((x) => x.data.value?.nights ?? []).find((n) => n.date === anchor.value) ?? null);
const prevNight = computed(() => stepList.value.find((d) => d < anchor.value) ?? null);
// the next night, else today ("Last night") so the newest night is always one step from the latest
const nextNight = computed(() => [...stepList.value].reverse().find((d) => d > anchor.value && d <= today.value) ?? (anchor.value < today.value ? today.value : null));
watch([() => stepList.value[0], () => monthQ.isPlaceholderData.value], ([d, ph]) => { if (!picked.value && d && !ph) { anchor.value = d <= today.value ? d : today.value; picked.value = true; } }, { immediate: true });
// a day with only its hours of sleep (an older import, a typed number): shown as those hours, said plainly
const dayQ = useHealthDay(computed(() => (isNight.value && !night.value ? anchor.value : null)), computed(() => isNight.value && !night.value), { keep: true });
const dayHours = computed(() => { const d = dayQ.data.value; return d && d.date === anchor.value && !night.value && d.sleepH ? d.sleepH : null; });

// the shown stretch [from, to): the night's day, or its week, month or year as Steps' and Heart's
const range = computed(() => stretchOf(view.value === "night" ? "day" : view.value, anchor.value, s.value.firstDay));
const hasToday = computed(() => isNight.value ? !nextNight.value : range.value.from <= today.value && today.value < range.value.to);
const away = computed(() => isNight.value ? anchor.value !== today.value : !hasToday.value);
const shift = (n: number) => {
  if (isNight.value) {
    // a night at a time: older (‹) or newer (›) among the nights there are
    const to = n < 0 ? prevNight.value : nextNight.value;
    if (to) anchor.value = to;
    return;
  }
  anchor.value = stepDay(view.value === "night" ? "day" : view.value, anchor.value, n, today.value);
};
const title = computed(() => (view.value === "night" ? nightTitle(anchor.value, today.value, fmt.value) : stretchTitle(view.value, range.value, today.value, fmt.value)));
// a night picked anywhere in a period (a bar, a point, a row, a tile) opens in the Night view
// a bar's tip opens its night, or by week its week (the week view, as Steps' and Heart's weekly bars open theirs)
const openBar = (d: string) => { if (perWeek.value) { anchor.value = d; view.value = "week"; } else openNight(d); };
const openNight = (d: string | null | undefined) => { if (d) { anchor.value = d; picked.value = true; view.value = "night"; } };

// the stretch's nights, keeping the last stretch's while the next loads so stepping doesn't flash
// with the Health scores feature on, each night with its own sleep score for the list of nights
const scoresOn = computed(() => !!s.value.features.scores);
const q = useSleep(computed(() => (scoresOn.value ? { ...range.value, scores: 1 as const, tz: new Date().getTimezoneOffset() } : range.value)), computed(() => !isNight.value), { keep: true });
// the last 30 days' nights, for how last night compares
const recentQ = useSleep(computed(() => ({ from: plus(today.value, -31) })), computed(() => !isNight.value), { keep: true });
// the daily log from the first of the stretch's month, under the key Home's daily log uses, so live updates reload it
const dailyFrom = computed(() => { const x = at(range.value.from); return ymd(new Date(x.getFullYear(), x.getMonth(), 1)); });
type Daily = { date: string; kind: string; value: number | string };
const dailyQ = useQuery({ queryKey: computed(() => ["activities", "daily", dailyFrom.value]), enabled: computed(() => !isNight.value), placeholderData: keepPreviousData,
  queryFn: () => api.get<Daily[]>("/daily", { from: dailyFrom.value, tz: new Date().getTimezoneOffset() }) });
// the workouts from the day before the stretch on, so its first night knows whether the day before had one
const wkRange = computed(() => ({ from: new Date(plus(range.value.from, -1) + "T00:00").toISOString(), to: new Date(range.value.to + "T00:00").toISOString(), limit: 1000 }));
const wq = useWorkouts(wkRange);
const nightQs = [monthQ, olderQ, newerQ];
const periodQs = [q, recentQ, dailyQ];
// opened without a day, the night view waits for the newest night (it may be in the month before), so it never says
// "No night" for today first
const loading = computed(() => (isNight.value ? nightQs : periodQs).some((x) => x.isLoading.value) || (isNight.value && !picked.value && stepList.value.length > 0));
const failed = computed(() => (isNight.value ? nightQs : periodQs).some((x) => x.isError.value));
const failure = computed(() => (isNight.value ? nightQs : periodQs).map((x) => x.error.value).find(Boolean) as Error | undefined);
const retry = () => { for (const x of isNight.value ? nightQs : periodQs) x.refetch(); };

const nights = computed<SleepNight[]>(() => q.data.value?.nights ?? []);
const recent = computed<SleepNight[]>(() => recentQ.data.value?.nights ?? []);
// the nights that count as nights (not naps or partial records), for every average and usual time
const full = computed(() => nights.value.filter(isFull));
const staged = computed(() => nights.value.some(hasStages));
// every day in the period with hours of sleep: a night when there is one, else the day's hours
const days = computed(() => {
  const byDay = new Map(nights.value.map((n) => [n.date, n] as const));
  const lo = range.value.from, hi = range.value.to;
  const out = new Map<string, { date: string; min: number; night: SleepNight | null; full?: boolean }>();
  for (const x of dailyQ.data.value ?? []) {
    const d = String(x.date).slice(0, 10);
    if (x.kind !== "sleep_h" || d < lo || d >= hi) continue;
    out.set(d, { date: d, min: Math.round(Number(x.value) * 60), night: byDay.get(d) ?? null });
  }
  for (const n of nights.value) out.set(n.date, { date: n.date, min: asleepMin(n), night: n });
  return [...out.values()].filter((x) => x.min > 0).map((x) => ({ ...x, full: isNightMin(x.min) })).sort((a, b) => a.date.localeCompare(b.date));
});
// the days that were nights, and how many short records the averages leave out
const nightDays = computed(() => days.value.filter((x) => x.full));
const shortCount = computed(() => days.value.length - nightDays.value.length);

// last night: the newest of the last 30 days, when the chosen period takes it in (an older period shows only its own);
// named "Last night" when it ended today
const last = computed(() => { const n = recent.value[0]; return n && n.date >= range.value.from && n.date < range.value.to ? n : null; });
const lastName = computed(() => !last.value ? "" : last.value.date === today.value ? "Last night" : fmt.value.date(last.value.date, { weekday: "long", day: "numeric", month: "short" }));
// in running text a percent sits right after its number, to a tenth only when the band gave one
const pc = (v: number) => `${fmt.value.num(v, Number.isInteger(v) ? 0 : 1)}%`;

// averages over the period
const avg = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null);
const avgAsleep = computed(() => avg(nightDays.value.map((x) => x.min)));
const bed = computed(() => typical(full.value.map((n) => nightMin(n.startAt))));
// waking after noon still counts as the same night's morning
const wake = computed(() => typical(full.value.map((n) => { const a = nightMin(n.startAt), b = nightMin(n.endAt); return b < a ? b + 1440 : b; })));
const deepPct = computed(() => { const ns = full.value.filter((n) => n.deepMin != null && n.asleepMin); return ns.length ? Math.round((ns.reduce((t, n) => t + n.deepMin!, 0) / ns.reduce((t, n) => t + n.asleepMin, 0)) * 100) : null; });
const avgBed = computed(() => avg(full.value.map(inBedMin)));
// only the nights the band told asleep from awake: the others read 100% whatever the night was
const avgEff = computed(() => avg(full.value.filter(awakeKnown).map(efficiency)));
const clock = (m: number) => fmt.value.time(nightIso(m));
// where bedtimes (or wake times) usually fall: the middle half from 5 nights on, else the earliest to the latest; one
// night says nothing about a habit, so it only says so
type Typical = NonNullable<ReturnType<typeof typical>>;
const span = (t: Typical) => (t.lo === t.hi ? `at ${clock(t.at)}` : clock(t.lo) + "-" + clock(t.hi));
// a tile's line as its words and its times, the times kept whole so a narrow tile breaks before them, not inside them;
// with 2-4 nights only the earliest to the latest, since any word beside it no longer fits a phone's tile on one line
const spread = (t: Typical) => (t.n === 1 ? ["from 1 night", ""] : [t.n >= 5 ? "usually" : "", span(t)]);
const schedule = computed(() => bed.value && wake.value && bed.value.n > 1 ? `${bed.value.n >= 5 ? "Usual times shaded: to bed" : "To bed"} ${span(bed.value)} · up ${span(wake.value)}` : "");
// the tiles there are data for: time asleep always, then bedtime, wake time, and deep sleep or else the time tracked
const tiles = computed(() => 1 + (bed.value ? 1 : 0) + (wake.value ? 1 : 0) + (deepPct.value != null || avgBed.value != null ? 1 : 0));

// nightly time asleep: a bar a night, stacked deep / light / REM when the band told them apart (a night it didn't, or a
// day with only its hours, in its own colour beside them, named in the legend); over two months of nights the bars would be hairlines, so it
// becomes the average night of each week (of its nights: a week of only short records has no bar). A short record keeps
// its bar, in grey and named in the legend, so it is seen but not read as a night
const BAND: [number, number] = [7, 9];
const perWeek = computed(() => days.value.length > 62);
const mixed = computed(() => staged.value && nightDays.value.some((x) => !x.night || !hasStages(x.night)));
const bars = computed(() => {
  const part = (n: SleepNight | null, min: number) => {
    if (!staged.value) return undefined;
    if (!n || !hasStages(n)) return [{ value: min / 60, color: NO_STAGES_COLOR, hatch: true }];
    // the stages scaled to the time asleep shown (the day's own number, when it was typed in)
    const sum = Math.max(1, (n.deepMin ?? 0) + (n.lightMin ?? 0) + (n.remMin ?? 0));
    return STAGES.filter((st) => st.key !== "awakeMin").map((st) => ({ value: ((n[st.key] ?? 0) / sum) * (min / 60), color: st.color }));
  };
  // the month under its first day, so "30 1 3" says where October ends; a night's tip gives its bedtime to getting up
  const month = (d: string) => fmt.value.date(d, { month: "short" });
  if (!perWeek.value) return days.value.map((x) => {
    const full = fmt.value.date(x.date, { day: "numeric", month: "short" }), n = x.night;
    const tip = fmt.value.date(x.date, { weekday: "short", day: "numeric", month: "short" }) + (n ? ` · ${fmt.value.time(n.startAt)}-${fmt.value.time(n.endAt)}` : "") + (x.full ? "" : " · short record");
    return { label: full.split(" ")[0]!, full, group: month(x.date), tip, value: x.min / 60, ...(x.full ? { parts: part(n, x.min) } : { color: SHORT_COLOR }), id: n ? x.date : undefined };
  });
  const wk = new Map<string, number[]>();
  for (const x of nightDays.value) { const k = weekStartOf(new Date(x.date + "T12:00"), s.value.firstDay); wk.set(k, [...(wk.get(k) ?? []), x.min]); }
  return [...wk].map(([k, ms]) => { const full = fmt.value.date(k, { day: "numeric", month: "short" }); return { label: full.split(" ")[0]!, full, group: month(k), tip: `week of ${full}`, value: avg(ms)! / 60, id: k }; });
});
// without stages the nights' plain bars are named too, once a short record's grey sits beside them
const legend = computed(() => [...(staged.value ? STAGES.slice(0, 3).map((st) => ({ name: st.name, color: st.color as string })) : shortCount.value ? [{ name: "Night", color: "var(--acc)" }] : []),
  ...(mixed.value ? [{ name: "No stages", color: NO_STAGES_SWATCH }] : []), ...(shortCount.value ? [{ name: "Short record", color: SHORT_COLOR }] : [])]);

const hours = (v: number) => mins(v * 60);

// heart rate, blood oxygen and breathing while asleep, a night at a time, each only when the band read it
const TRENDS = [
  { id: "hr", name: "Heart rate while asleep", unit: "bpm", v: (n: SleepNight) => n.avgHr, lo: (n: SleepNight) => n.minHr },
  { id: "spo2", name: "Blood oxygen while asleep", unit: "%", v: (n: SleepNight) => n.avgSpo2, lo: (n: SleepNight) => n.minSpo2 },
  { id: "resp", name: "Breathing rate while asleep", unit: "breaths/min", v: (n: SleepNight) => n.respRate, lo: () => null },
] as const;
const trends = computed(() => TRENDS.map((t) => {
  const ns = full.value.filter((n) => t.v(n) != null);
  // a point's tip names its night as the other charts' tips do ("Sat 7 Nov")
  const pts = ns.map((n) => ({ x: new Date(n.date + "T12:00").getTime(), y: Number(t.v(n)), id: n.date, label: fmt.value.date(n.date, { weekday: "short", day: "numeric", month: "short" }) }));
  const u = (n: number) => t.unit === "%" ? pc(Math.round(n * 10) / 10) : `${fmt.value.num(n, 0)} ${t.unit}`;
  const lows = ns.map((n) => t.lo(n)).filter((x): x is number => x != null);
  const mean = avg(pts.map((p) => p.y));
  return { ...t, pts, f: (v: number) => fmt.value.num(v, 0), line: pts.length ? [`Latest ${u(pts.at(-1)!.y)}`, `average ${u(mean!)}`, lows.length ? `lowest ${u(Math.min(...lows))}` : ""].filter(Boolean).join(" · ") : "" };
}).filter((t) => t.pts.length > 1));

// what stands out, as a report's highlights (what on the left, its number on the right), each only when the nights are
// there to say it
type Insight = { icon: string; t: string; s?: string; rv?: string; tone?: "pos" | "neg" };
const signed = (m: number) => `${m < 0 ? "-" : "+"}${mins(Math.abs(m))}`;
const insights = computed(() => {
  const out: Insight[] = [];
  const l = last.value, r = recent.value;
  // said of last night only: an older night is seen in full in the Night view; a short record isn't a night to compare
  // (the Night view says so), and the 30-day usual is of nights only
  const rf = r.filter(isFull);
  if (l && lastName.value === "Last night" && isFull(l)) {
    const before = rf.filter((n) => n.date !== l.date);
    if (before.length >= 5) {
      const usual = avg(before.map(asleepMin))!, diff = asleepMin(l) - usual;
      out.push(Math.abs(diff) < 10 ? { icon: "moon", t: "As long as your 30-day average", s: `${mins(usual)} a night`, rv: mins(asleepMin(l)) }
        : { icon: "moon", t: `${diff < 0 ? "Shorter" : "Longer"} than your 30-day average`, s: `${mins(usual)} a night`, rv: signed(diff), tone: diff < 0 ? "neg" : "pos" });
      const hrs = before.map((n) => n.avgHr).filter((x): x is number => x != null);
      if (l.avgHr != null && hrs.length >= 5) {
        const d = Math.round(l.avgHr - avg(hrs)!);
        if (Math.abs(d) >= 3) out.push({ icon: "heart", t: `Heart rate while asleep ${d > 0 ? "above" : "below"} your average`, s: d > 0 ? "can follow a hard day, a late meal or a cold coming on" : undefined, rv: `${d > 0 ? "+" : "-"}${Math.abs(d)} bpm`, tone: d > 0 ? "neg" : "pos" });
      }
    }
    if (l.deepMin != null && l.asleepMin) out.push({ icon: "layers", t: "Deep sleep last night", s: deepPct.value != null && full.value.length > 3 ? `${deepPct.value}% on average` : undefined, rv: `${Math.round((l.deepMin / l.asleepMin) * 100)}%` });
    if ((l.awakeMin ?? 0) >= 30) out.push({ icon: "eye", t: "Awake during the night", rv: mins(l.awakeMin!) });
    if (l.minSpo2 != null && l.minSpo2 < 90) out.push({ icon: "water", t: "Blood oxygen dipped during the night", s: "its lowest reading", rv: pc(l.minSpo2) });
  }
  // the last 7 nights' bedtimes, earliest to latest
  const week = rf.filter((n) => n.date > ymd(new Date(Date.now() - 7 * 86400000)));
  if (week.length >= 4) {
    const bs = week.map((n) => nightMin(n.startAt)), spread = Math.max(...bs) - Math.min(...bs);
    out.push(spread <= 30 ? { icon: "clock", t: "Bedtime steady", s: "earliest to latest, last 7 days", rv: mins(Math.max(1, spread)), tone: "pos" }
      : { icon: "clock", t: "Bedtime varied", s: "earliest to latest, last 7 days", rv: mins(spread), tone: spread >= 90 ? "neg" : undefined });
  }
  // over the period: nights under 7 hours, and weekend nights (going to bed on a Friday or Saturday) against the rest
  const nd = nightDays.value;
  if (nd.length >= 5) {
    const under = nd.filter((x) => x.min < 420).length;
    if (under) out.push({ icon: "target", t: "Nights under 7 hours", s: "most adults need 7-9", rv: `${under} of ${nd.length}`, tone: under > nd.length / 2 ? "neg" : undefined });
  }
  const wkend = full.value.filter((n) => [5, 6].includes(new Date(n.startAt).getDay())), wkday = full.value.filter((n) => ![5, 6].includes(new Date(n.startAt).getDay()));
  if (wkend.length >= 2 && wkday.length >= 4) {
    const d = avg(wkend.map(asleepMin))! - avg(wkday.map(asleepMin))!;
    if (Math.abs(d) >= 30) out.push({ icon: "calendar", t: `${d > 0 ? "Longer" : "Shorter"} on weekends`, s: "than on weeknights", rv: signed(d) });
  }
  return out;
});

// the longest and shortest night of the stretch (nights only), and the sleep debt: the time each night fell short of 7
// hours (the least most adults need), added up
const longest = computed(() => nightDays.value.reduce<(typeof nightDays.value)[number] | null>((m, x) => (!m || x.min > m.min ? x : m), null));
const shortest = computed(() => nightDays.value.reduce<(typeof nightDays.value)[number] | null>((m, x) => (!m || x.min < m.min ? x : m), null));
const debtNights = computed(() => nightDays.value.filter((x) => x.min < BAND[0] * 60));
const debt = computed(() => debtNights.value.reduce((t, x) => t + BAND[0] * 60 - x.min, 0));
const day = (d: string) => fmt.value.date(d, { weekday: "short", day: "numeric", month: "short" });

// how you sleep after a workout day against after a rest day: a night follows a workout day when a workout started on the
// day you went to bed (bedtime less 12 hours, so going to bed after midnight still counts as the evening before). Only
// once each side has 3 nights, so one night doesn't speak for a habit
const workoutDays = computed(() => new Set(((wq.data.value ?? []) as { startedAt: string; status?: string }[]).filter((w) => w.status !== "in_progress" && w.status !== "discarded").map((w) => localYmd(new Date(w.startedAt)))));
const bedDay = (n: SleepNight) => localYmd(new Date(Date.parse(n.startAt) - 12 * 3600_000));
const afterTraining = computed(() => {
  if (!workoutDays.value.size) return null;
  const sides = [true, false].map((trained) => {
    const ns = full.value.filter((n) => workoutDays.value.has(bedDay(n)) === trained);
    const deep = ns.filter((n) => n.deepMin != null && n.asleepMin), hr = ns.map((n) => n.avgHr).filter((x): x is number => x != null);
    return { trained, n: ns.length, asleep: avg(ns.map(asleepMin)) ?? 0,
      deep: deep.length ? Math.round((deep.reduce((t, n) => t + n.deepMin!, 0) / deep.reduce((t, n) => t + n.asleepMin, 0)) * 100) : null,
      hr: hr.length ? Math.round(avg(hr)!) : null };
  });
  if (sides.some((x) => x.n < 3)) return null;
  const d = sides[0]!.asleep - sides[1]!.asleep;
  return { sides, line: Math.abs(d) < 10 ? "About as long after workout days as after rest days." : `${mins(Math.abs(d))} ${d > 0 ? "longer" : "shorter"} after workout days than after rest days.` };
});

// the nights in the stretch, newest first: a week of them, then all on request
const showAll = ref(false);
const list = computed(() => showAll.value ? nights.value : nights.value.slice(0, 7));
// a night with its own sleep score: then every row keeps a slot for one, so the times asleep line up
const anyScore = computed(() => list.value.some((n) => !!n.score));
</script>

<template>
  <DayNav :title="title" :unit="isNight ? 'night' : view" :at-end="hasToday" :away="away" :home="isNight ? 'Last night' : 'Today'" @step="shift" @today="anchor = today" />

  <div v-if="failed" class="card empty"><Icon name="info" :size="34" /><b>Couldn't load your sleep</b>{{ failure?.message }}<br /><button class="btn tonal" @click="retry">Try again</button></div>
  <div v-else-if="loading" class="empty">Loading…</div>

  <template v-else-if="isNight">
    <!-- the night in full: its time asleep, tiles, stages and curves, each part under a faint line -->
    <div v-if="night" class="card wkc">
      <div class="ch"><span class="bi"><Icon name="moon" :size="15" /></span><span class="t grow">Sleep</span><span class="tiny">{{ fmt.time(night.startAt) }}-{{ fmt.time(night.endAt) }}</span></div>
      <NightView :date="night.date" no-times />
    </div>
    <!-- a day with only its hours of sleep: those hours, and why there is no more -->
    <div v-else-if="dayHours" class="card wkc">
      <div class="ch"><span class="bi"><Icon name="moon" :size="15" /></span><span class="t grow">Sleep</span><span class="tiny">Daily log</span></div>
      <div class="gs-top"><span class="gs-ico"><Icon name="moon" :size="28" /></span><div class="grow"><div class="gs-val">{{ mins(dayHours * 60) }}<small>asleep</small></div>
        <div class="tiny">Only the hours of sleep were logged for this day, no night from your {{ deviceWord(dev) }}: its stages and times show for nights it hands over.</div></div></div>
    </div>
    <!-- only while this day's hours aren't in yet: a refetch in the background keeps what is shown -->
    <div v-else-if="dayQ.isFetching.value && dayQ.data.value?.date !== anchor" class="empty">Loading…</div>
    <div v-else-if="!stepList.length" class="card empty"><Icon name="moon" :size="34" /><b>No nights from your {{ adviceWord(dev) }} yet</b>Wear it to bed to see each night's stages and times. Pick Week, Month or Year for the hours of sleep you logged.</div>
    <div v-else class="card empty"><Icon name="moon" :size="34" /><b>{{ anchor === today ? "Last night isn't here yet" : "No night on this day" }}</b>{{ anchor === today ? `It shows once your ${deviceWord(dev)} has synced. ` : "" }}Pick another night with the arrows.</div>
  </template>

  <template v-else>
    <div v-if="!days.length" class="card empty"><Icon name="moon" :size="34" /><b>No sleep in this {{ view }}</b>Pick another {{ view }} with the arrows.</div>
    <template v-else>
      <!-- the stretch's averages, as Overview's and Steps' tiles -->
      <div class="grid g4" :class="tiles < 4 ? `n${tiles}` : ''">
        <div class="card hero stat"><div class="lbl"><span class="bi"><Icon name="moon" :size="15" /></span>Time asleep</div><div class="val">{{ avgAsleep != null ? mins(avgAsleep) : "-" }}</div><div class="sub">{{ nightDays.length ? `average of ${nightDays.length} ${nightDays.length === 1 ? "night" : "nights"}` : "only short records" }}</div><Sparkline v-if="nightDays.length > 1" :values="nightDays.map((x) => x.min)" color="var(--onc)" /></div>
        <div v-if="bed" class="card stat"><div class="lbl"><span class="bi"><Icon name="clock" :size="15" /></span>Bedtime</div><div class="val">{{ clock(bed.at) }}</div><div class="sub">{{ spread(bed)[0] }} <span class="nw">{{ spread(bed)[1] }}</span></div></div>
        <div v-if="wake" class="card stat"><div class="lbl"><span class="bi"><Icon name="bell" :size="15" /></span>Wake time</div><div class="val">{{ clock(wake.at) }}</div><div class="sub">{{ spread(wake)[0] }} <span class="nw">{{ spread(wake)[1] }}</span></div></div>
        <div v-if="deepPct != null" class="card stat"><div class="lbl"><span class="bi"><Icon name="layers" :size="15" /></span>Deep sleep</div><div class="val">{{ deepPct }}<small>%</small></div><div class="sub">of time asleep</div></div>
        <div v-else-if="avgBed != null" class="card stat"><div class="lbl"><span class="bi"><Icon name="device" :size="15" /></span>Time tracked</div><div class="val">{{ mins(avgBed) }}</div><div class="sub"><template v-if="avgEff != null">{{ pctDown(avgEff) }}% of it asleep</template><template v-else>time awake <span class="nw">not recorded</span></template></div></div>
      </div>
      <!-- the best and worst night and the sleep debt, once there are nights to compare -->
      <div v-if="nightDays.length > 1" class="card wkc spt">
        <div class="ch"><span class="bi"><Icon name="stats" :size="15" /></span><span class="t grow">Best and worst nights</span></div>
        <div class="wstats rows2">
          <div class="ws" :class="{ click: longest!.night }" :role="longest!.night ? 'button' : 'group'" :tabindex="longest!.night ? 0 : undefined" @keydown.enter="openNight(longest!.night?.date)" :aria-label="`Longest night ${mins(longest!.min)} ${day(longest!.date)}`" @click="openNight(longest!.night?.date)"><div class="wlb"><Icon name="trophy" :size="14" />Longest night<Icon v-if="longest!.night" name="right" :size="14" class="wgo" /></div><div class="wv">{{ mins(longest!.min) }}</div><div class="wd">{{ day(longest!.date) }}</div></div>
          <div class="ws" :class="{ click: shortest!.night }" :role="shortest!.night ? 'button' : 'group'" :tabindex="shortest!.night ? 0 : undefined" @keydown.enter="openNight(shortest!.night?.date)" :aria-label="`Shortest night ${mins(shortest!.min)} ${day(shortest!.date)}`" @click="openNight(shortest!.night?.date)"><div class="wlb"><Icon name="moon" :size="14" />Shortest night<Icon v-if="shortest!.night" name="right" :size="14" class="wgo" /></div><div class="wv">{{ mins(shortest!.min) }}</div><div class="wd">{{ day(shortest!.date) }}</div></div>
          <div class="ws" role="group" :aria-label="`Sleep debt ${debt ? mins(debt) : 'none'}`"><div class="wlb"><Icon name="arrowDown" :size="14" />Sleep debt</div><div class="wv" :class="{ pos: !debt }">{{ debt ? mins(debt) : "None" }}</div><div class="wd">{{ debt ? `short of ${BAND[0]}h on ${debtNights.length} of ${nightDays.length}` : `${BAND[0]}h or more each night` }}</div></div>
        </div>
      </div>

      <div v-if="insights.length" class="card wkc spt">
        <div class="ch"><span class="bi"><Icon name="sparkle" :size="15" /></span><span class="t grow">What stands out</span></div>
        <div class="list sl-ins">
          <div v-for="(x, i) in insights" :key="i" class="li">
            <Icon :name="x.icon" :size="18" :class="x.tone ?? 'muted'" />
            <div class="grow"><div class="t">{{ x.t }}</div><div v-if="x.s" class="s">{{ x.s }}</div></div>
            <b v-if="x.rv" class="r rv" :class="x.tone">{{ x.rv }}</b>
          </div>
        </div>
      </div>

      <div v-if="afterTraining" class="card wkc spt">
        <div class="ch"><span class="bi"><Icon name="dumbbell" :size="15" /></span><span class="t grow">Sleep after workouts</span></div>
        <div class="list sl-ins">
          <div v-for="x in afterTraining.sides" :key="String(x.trained)" class="li">
            <Icon :name="x.trained ? 'dumbbell' : 'moon'" :size="18" class="muted" />
            <div class="grow"><div class="t">{{ x.trained ? "After a workout day" : "After a rest day" }}</div><div class="s">{{ [`${x.n} nights`, x.deep != null ? `deep ${x.deep}%` : "", x.hr != null ? `heart rate ${x.hr} bpm` : ""].filter(Boolean).join(" · ") }}</div></div>
            <b class="r rv">{{ mins(x.asleep) }}</b>
          </div>
        </div>
        <div class="tiny sl-line">{{ afterTraining.line }} A workout day: a workout on the day you went to bed.</div>
      </div>

      <div class="card spt">
        <div class="lbl hgap">{{ perWeek ? "Average time asleep a night, by week" : "Time asleep per night" }} (h) · target {{ BAND[0] }}-{{ BAND[1] }}</div>
        <BarChart :bars="bars" :band="BAND" :height="170" :fmt="hours" @pick="openBar" />
        <div v-if="legend.length && !perWeek" class="bmlegend sl-leg"><span v-for="k in legend" :key="k.name"><i :style="{ background: k.color }" />{{ k.name }}</span></div>
        <div v-if="nights.length || shortCount" class="tiny sl-line">{{ [nights.length ? "Time asleep leaves out the time you were awake in the night." : "", shortCount ? `${shortCount} short ${shortCount === 1 ? "record" : "records"} (under ${MIN_NIGHT_H} hours) left out of the averages.` : "", nights.length ? (perWeek ? "Tap a week to see its average time asleep a night." : "Tap a night to see its time asleep.") : ""].filter(Boolean).join(" ") }}</div>
      </div>

      <div v-if="full.length > 1" class="card spt">
        <div class="lbl hgap">Bedtime and wake time</div>
        <SleepSchedule :nights="full" :bed="bed" :wake="wake" @pick="openNight" />
        <div v-if="schedule" class="tiny sl-line">{{ schedule }}</div>
      </div>

      <div v-if="trends.length" class="grid g2 spt"><div v-for="t in trends" :key="t.id" class="card"><div class="lbl hgap">{{ t.name }} ({{ t.unit }})</div>
        <LineChart :points="t.pts" :height="140" :fmt="t.f" @pick="openNight" /><div class="tiny sl-line">{{ t.line }}</div></div></div>

      <template v-if="nights.length">
        <div class="sh"><h2>Nights</h2><span class="tiny">{{ nights.length }}</span></div>
        <div class="card"><div class="list">
          <div v-for="n in list" :key="n.date" class="li click" role="button" tabindex="0" @click="openNight(n.date)" @keydown.enter="openNight(n.date)">
            <span class="bi sg"><Icon name="moon" :size="16" /></span>
            <div class="grow sl-nt"><div class="t">{{ day(n.date) }}</div><div class="s">{{ isFull(n) ? "" : "short record · " }}{{ fmt.time(n.startAt) }}-{{ fmt.time(n.endAt) }}</div></div>
            <b class="num" :class="{ muted: !isFull(n) }">{{ mins(asleepMin(n)) }}</b>
            <!-- the night's own sleep score as a small ring with its number, after the time asleep it mostly comes from -->
            <span v-if="n.score" class="sl-sc" role="img" :aria-label="`Sleep score ${n.score.score}, ${n.score.label}`"><Ring :pct="n.score.score / 100" :size="34" :stroke="4" :color="n.score.label === 'Low' ? 'var(--warn)' : undefined" /><span>{{ n.score.score }}</span></span>
            <span v-else-if="anyScore" class="sl-sc0" aria-hidden="true" />
          </div>
        </div></div>
        <div v-if="nights.length > 7 && !showAll" class="center spt"><button class="qb" @click="showAll = true">Show all {{ nights.length }} nights</button></div>
      </template>
    </template>
  </template>
</template>

<style scoped>
/* the highlights as a report's: the last row without its line, the number in the row's tone */
.sl-ins .li:last-child { border-bottom: 0; padding-bottom: 0; }
.sl-ins .li:first-child { padding-top: 0; }
.sl-ins .grow { min-width: 0; }
.rv { font-variant-numeric: tabular-nums; white-space: nowrap; }
.sl-line { margin-top: var(--tdy); }
.nw { white-space: nowrap; }
.sl-leg { margin-top: var(--hg); }
/* a night's line stays one line at 360px beside the score's ring: its times alone (the time tracked is their span, and
   in full on the night's page), a short record's reason first so a cut never loses it */
.sl-nt { min-width: 0; }
.sl-nt .s { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* the score's number inside its ring, as Workout so far's ring holds its percent */
.sl-sc { position: relative; display: inline-grid; place-items: center; flex: none; }
/* a nap or part of a night has no score: its slot kept empty, so every row's time asleep lines up */
.sl-sc0 { width: 34px; flex: none; }
.sl-sc > span { position: absolute; font-size: var(--fs-sm); font-weight: 650; font-variant-numeric: tabular-nums; }
</style>
