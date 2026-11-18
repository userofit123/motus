<script setup lang="ts">
// Stats → Steps (M-241), there once there are steps at all (typed, from a band or from recorded walks). Day: the day's
// steps against the steps goal and your usual day as one card's hero, the band's distance, active calories and active
// hours as its tiles, how the steps spread over its hours (walks and workouts marked) and the day's sessions. Week, month, year: a bar a day (a year:
// the average day of each week), the average, the best day, the days the goal was reached and the longest run of them,
// and what stands out (M-246): the Activity score's active minutes, the current run of goal days and your usual busiest
// hour. A day also says its longest stretch with little walking (from steps, so standing still counts as still).
// A day's total is the daily log's (stepsByDay: the value the day shows everywhere, recorded walks counted in); the
// hours come from the band's saved records (/health/records/hourly), only for days they were saved: a day with a total
// and no hours shows its total and tiles and says so. The day's workouts and activities are shaded on the hours over
// their exact times and listed under the chart, as on Stats → Heart's day. Moved with the Calendar's bar; a day's
// link (?day=) follows it, so a refresh or Back keeps the day.
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import { ymd, weekStartDate, ACTIVE_HOUR_STEPS, stillStretch, currentStreak, typicalHour } from "@motus/shared";
import { api } from "../../api/client";
import { useSettings, useHealthScores } from "../../api/queries";
import { useFmt, unitOf } from "../../core/format";
import { useStepGoal } from "../../core/goals";
import { mins } from "../../core/sleep";
import { minutesSplit, scoreRow } from "../../core/scores";
import { fromWhere, useDevice } from "../../native/health";
import Icon from "../Icon.vue";
import Ring from "../Ring.vue";
import BarChart from "../BarChart.vue";
import Sparkline from "../Sparkline.vue";
import DayNav from "./DayNav.vue";
import DaySessionList from "./DaySessionList.vue";
import { useDaySessions, useToday, legendOf, zoomHours, noRecords, stretchOf, stepDay, stretchTitle, DAY_DATA_COLOR, type StretchView } from "./daySessions";

export type StepsView = StretchView;
const view = defineModel<StepsView>("view", { required: true });
const props = defineProps<{ day?: string }>();
const emit = defineEmits<{ "update:day": [day: string] }>();
const router = useRouter();
const fmt = useFmt();
const s = useSettings();
const dev = useDevice();
const stepGoal = useStepGoal();
const goal = computed(() => stepGoal.value?.target ?? null);

// days as "YYYY-MM-DD" in the app's calendar; a Date at noon, so a clock change never tips it into the next day
const today = useToday();
const at = (d: string) => new Date(d + "T12:00");
const plus = (d: string, n: number) => { const x = at(d); x.setDate(x.getDate() + n); return ymd(x); };
const anchor = ref(props.day && props.day <= today.value ? props.day : today.value);
// opened again from elsewhere (Home, the calendar) with a day while this tab is still around
watch(() => props.day, (d) => { if (d && d <= today.value && d !== anchor.value) { anchor.value = d; view.value = "day"; } });
// the shown day into the link, so a refresh or Back opens it again
watch([anchor, view], ([d, v]) => { if (v === "day" && d !== props.day) emit("update:day", d); });

// the shown stretch [from, to): the day, its week (from the first day of the week in Settings), month or year
const range = computed(() => stretchOf(view.value, anchor.value, s.value.firstDay));
const hasToday = computed(() => range.value.from <= today.value && today.value < range.value.to);
const shift = (n: number) => { anchor.value = stepDay(view.value, anchor.value, n, today.value); };
const title = computed(() => stretchTitle(view.value, range.value, today.value, fmt.value));

// the daily log from the first of the month 4 weeks before the stretch (your usual day looks back 4 weeks), under the
// key Home's daily log uses, so live updates reload it and moving a day at a time doesn't load it again; crossing into
// another month keeps the last answer on screen while the next one loads, so the tab never flashes "Loading…"
const from = computed(() => { const x = at(plus(range.value.from, -28)); return ymd(new Date(x.getFullYear(), x.getMonth(), 1)); });
type Daily = { date: string; kind: string; value: number | string; source?: string | null; worn?: boolean };
const dailyQ = useQuery({ queryKey: computed(() => ["activities", "daily", from.value]),
  queryFn: () => api.get<Daily[]>("/daily", { from: from.value, tz: new Date().getTimezoneOffset() }), placeholderData: keepPreviousData });
const byKind = (kind: string) => { const m = new Map<string, Daily>(); for (const x of dailyQ.data.value ?? []) if (x.kind === kind && Number(x.value) > 0) m.set(String(x.date).slice(0, 10), x); return m; };
const steps = computed(() => byKind("steps"));
const dist = computed(() => byKind("distance_m"));
const kcal = computed(() => byKind("active_kcal"));
const stepsOn = (d: string) => Number(steps.value.get(d)?.value ?? 0);
const n0 = (v: number) => fmt.value.num(v, 0);

// ---- a day
const dayN = computed(() => stepsOn(anchor.value));
const isDay = computed(() => view.value === "day");
// the day's source when the band (or Health Connect) counted it, not typed or only the recorded walks
const dayFrom = computed(() => { const x = steps.value.get(anchor.value); return x && x.source && x.source !== "manual" && x.source !== "activities" ? fromWhere(x.worn !== false, dev.value) : ""; });
const midnight = (d: string) => { const x = at(d); x.setHours(0, 0, 0, 0); return x; };
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const hourQ = useQuery({ queryKey: computed(() => ["readings", "hourly", "steps", anchor.value]), enabled: computed(() => isDay.value && dayN.value > 0), retry: false, placeholderData: keepPreviousData,
  queryFn: () => api.get<{ hours: { at: string; sum?: number }[] }>("/health/records/hourly", { type: "steps", from: midnight(anchor.value).toISOString(), to: midnight(plus(anchor.value, 1)).toISOString(), zone }) });
// the day's recorded activities (walks…) and workouts, shaded over the hours they took and listed under the chart
const { sessions } = useDaySessions(anchor, computed(() => isDay.value && dayN.value > 0));
// 24 bars (23 or 25 on a clock change day), each the steps in that hour of the app's calendar, in the day charts' own
// colour so the sessions' colours read apart from them
const dayStart = computed(() => midnight(anchor.value).getTime());
type Hour = { label: string; value: number; tip: string; color: string; a: number };
// the day before's bars while this one's load (as the query keeps them), so stepping a day doesn't empty the card
let lastHours: Hour[] = [];
const hours = computed(() => {
  const list = hourQ.data.value?.hours ?? [];
  if (hourQ.isPlaceholderData.value) return lastHours;
  if (!list.some((h) => (h.sum ?? 0) > 0)) return (lastHours = []);
  const sums = new Map<number, number>();
  for (const h of list) { const t = new Date(h.at).getTime(); sums.set(t, (sums.get(t) ?? 0) + (h.sum ?? 0)); }
  const out: Hour[] = [];
  const end = midnight(plus(anchor.value, 1)).getTime();
  for (let a = dayStart.value; a < end; a += 3600_000) {
    const iso = new Date(a).toISOString();
    out.push({ a, label: fmt.value.time(iso), value: Math.round(sums.get(a) ?? 0), tip: `${fmt.value.time(iso)}-${fmt.value.time(new Date(a + 3600_000).toISOString())}`, color: DAY_DATA_COLOR });
  }
  return (lastHours = out);
});
// in bars: hours since midnight (a clock change day's bars are its real hours, so this holds then too)
const inBars = (t: number) => (t - dayStart.value) / 3600_000;
const shade = computed(() => sessions.value.filter((x) => x.b > x.a).map((x) => ({ a: inBars(x.a), b: inBars(x.b), color: x.color, id: x.key, name: x.name })));
// every 6 hours, closer as the chart is zoomed in (a bar is an hour, so its width is an hour's)
const xt = (slot: number) => zoomHours(anchor.value, fmt.value, slot).map((h) => ({ at: inBars(h.at), text: h.text }));
const legend = computed(() => legendOf(sessions.value));
// the steps of recorded activities a band didn't count by the hour are in the total but not in the bars: said under them
const offHours = computed(() => { const inH = hours.value.reduce((t, h) => t + h.value, 0); return hours.value.length && sessions.value.some((x) => x.steps) ? Math.max(0, dayN.value - inH) : 0; });
const busiest = computed(() => hours.value.reduce<(typeof hours.value)[number] | null>((m, h) => (!m || h.value > m.value ? h : m), null));
// active hours: hours with at least 250 steps, as trackers count them
const ACTIVE = ACTIVE_HOUR_STEPS;
const activeH = computed(() => hours.value.filter((h) => h.value >= ACTIVE).length);
// the day's longest stretch with little walking (stillStretch: between its first and last active hour, a workout or
// activity breaks it, only hours already over), said under the chart as its busiest hour is
const still = computed(() => {
  if (!hours.value.length) return null;
  const x = stillStretch(hours.value, (a, b) => sessions.value.some((y) => y.a < b && y.b > a), Date.now());
  return x && { span: `${fmt.value.time(new Date(x.from).toISOString())}-${fmt.value.time(new Date(x.to).toISOString())}`, hours: x.hours };
});
// your usual day: the middle of the 4 weeks before (days with steps), from 5 of them
const usual = computed(() => {
  const xs: number[] = [];
  for (let i = 1; i <= 28; i++) { const n = stepsOn(plus(anchor.value, -i)); if (n > 0) xs.push(n); }
  if (xs.length < 5) return null;
  xs.sort((a, b) => a - b);
  const m = xs.length >> 1;
  return xs.length % 2 ? xs[m]! : (xs[m - 1]! + xs[m]!) / 2;
});
type Tile = { key: string; icon: string; label: string; value: string; unit: string; sub: string };
const dayTiles = computed(() => {
  const out: Tile[] = [], d = anchor.value;
  const m = Number(dist.value.get(d)?.value ?? 0);
  if (m) { const u = unitOf(fmt.value.dist(m, 1)); out.push({ key: "dist", icon: "walk", label: "Distance", value: u.value, unit: u.unit, sub: "" }); }
  const k = Number(kcal.value.get(d)?.value ?? 0);
  if (k) out.push({ key: "kcal", icon: "flame", label: "Active calories", value: n0(k), unit: "kcal", sub: "" });
  if (hours.value.length) out.push({ key: "active", icon: "clock", label: "Active hours", value: String(activeH.value), unit: "h", sub: `${ACTIVE}+ steps an hour` });
  return out;
});
// the day against your usual day, the hero's second line (under the goal's) as Heart's day says its resting heart rate
// against your usual under its resting line: the difference in the good colour when more and the warning one when fewer
// (5% either way), then "vs usual" and the usual
const vsUsual = computed(() => {
  if (!usual.value) return null;
  const pc = Math.round((dayN.value / usual.value - 1) * 100);
  return { text: pc === 0 ? "0%" : `${pc > 0 ? "+" : "-"}${Math.abs(pc)}%`, tone: Math.abs(pc) < 5 ? undefined : pc > 0 ? "pos" : "neg", usual: n0(usual.value) };
});
const pct = computed(() => (goal.value ? dayN.value / goal.value : 0));
const goalLine = computed(() => {
  if (!goal.value) return "";
  const left = goal.value - dayN.value;
  return left <= 0 ? `of ${n0(goal.value)} · goal reached` : `of ${n0(goal.value)} · ${Math.round(pct.value * 100)}% · ${n0(left)} to go`;
});

// ---- a week, month or year
const days = computed(() => { const out: string[] = []; for (let d = range.value.from; d < range.value.to; d = plus(d, 1)) out.push(d); return out; });
const withSteps = computed(() => days.value.filter((d) => stepsOn(d) > 0));
const avg = computed(() => (withSteps.value.length ? withSteps.value.reduce((t, d) => t + stepsOn(d), 0) / withSteps.value.length : 0));
const best = computed(() => withSteps.value.reduce<string | null>((m, d) => (!m || stepsOn(d) > stepsOn(m) ? d : m), null));
const worst = computed(() => withSteps.value.reduce<string | null>((m, d) => (!m || stepsOn(d) < stepsOn(m) ? d : m), null));
const sum = computed(() => withSteps.value.reduce((t, d) => t + stepsOn(d), 0));
const day = (d: string) => fmt.value.date(d, { weekday: "short", day: "numeric", month: "short" });
const reached = computed(() => (goal.value ? withSteps.value.filter((d) => stepsOn(d) >= goal.value!).length : 0));
// the longest run of days in a row that reached the goal, in this stretch
const streak = computed(() => {
  if (!goal.value) return 0;
  let run = 0, top = 0;
  for (const d of days.value) { run = stepsOn(d) >= goal.value ? run + 1 : 0; top = Math.max(top, run); }
  return top;
});
const month = (d: string) => fmt.value.date(d, { month: "short" });

// what stands out over a week or month, as Stats → Heart's and Sleep's rows, each only when there is something to say:
// the active minutes of the last 7 days (the Activity score's own, so the number is the one Stats → Scores shows; only
// with that feature on, and on the stretch that holds today), the run of goal days up to today (Longest streak above is
// the stretch's best), and the hour your days usually have the most steps (from the band's hours)
const scoresOn = computed(() => !!s.value.features.scores);
const scoresQ = useHealthScores(scoresOn);
const minutesPart = computed(() => (scoresOn.value && view.value === "week" && hasToday.value ? scoresQ.data.value?.activity?.parts.find((p) => p.key === "minutes") ?? null : null));
// the current run is counted over a fixed look-back (not the shown stretch), so every view says the same number; "N+"
// only when the run goes past it
const STREAK_BACK = 400;
const streakFrom = computed(() => plus(today.value, -STREAK_BACK));
const streakQ = useQuery({ queryKey: computed(() => ["activities", "daily", "streak", streakFrom.value]), placeholderData: keepPreviousData,
  enabled: computed(() => !!goal.value && hasToday.value),
  queryFn: () => api.get<Daily[]>("/daily", { from: streakFrom.value, tz: new Date().getTimezoneOffset() }) });
const nowStreak = computed(() => {
  if (!goal.value || !hasToday.value || !streakQ.data.value) return null;
  const n = new Map<string, number>();
  for (const x of streakQ.data.value) if (x.kind === "steps") n.set(String(x.date).slice(0, 10), Number(x.value));
  const list: string[] = [];
  for (let d = streakFrom.value; d <= today.value; d = plus(d, 1)) list.push(d);
  const x = currentStreak(list, (d) => (n.get(d) ?? 0) >= goal.value!);
  // the same number as the Longest streak tile when the run lies inside the shown stretch: said once
  return x.days && (x.more || x.days !== streak.value) ? x : null;
});
const spanQ = useQuery({ queryKey: computed(() => ["readings", "hourly", "steps", range.value.from, range.value.to]), retry: false, placeholderData: keepPreviousData,
  enabled: computed(() => (view.value === "week" || view.value === "month") && withSteps.value.length >= 3),
  queryFn: () => api.get<{ hours: { at: string; sum?: number }[] }>("/health/records/hourly", { type: "steps", from: midnight(range.value.from).toISOString(), to: midnight(range.value.to).toISOString(), zone }) });
const usualHour = computed(() => {
  if (spanQ.isPlaceholderData.value) return null;
  return typicalHour((spanQ.data.value?.hours ?? []).map((h) => { const d = new Date(h.at); return { day: ymd(d), hour: d.getHours(), value: h.sum ?? 0 }; }), today.value);
});
const hourSpan = (h: number) => { const a = new Date(2000, 0, 1, h); return `${fmt.value.time(a.toISOString())}-${fmt.value.time(new Date(a.getTime() + 3600_000).toISOString())}`; };
type Insight = { key: string; icon: string; t: string; s: string; rv: string; tone?: "pos" | "neg" | "muted" };
const insights = computed(() => {
  const out: Insight[] = [];
  const m = minutesPart.value;
  // the tone and the split are the score row's own, and the aim is in the line as there ("90 min", not "180 of 150" once past it)
  if (m) out.push({ key: "min", icon: "bolt", t: "Active minutes", s: `last 7 days · ${minutesSplit(m, n0)} · aim for ${m.target} minutes or more`, rv: `${n0(m.value)} min`, tone: scoreRow(m, n0).tone });
  const k = nowStreak.value;
  if (k) out.push({ key: "streak", icon: "link", t: "Current streak", s: `goal reached every day since ${k.more ? "at least " : ""}${day(k.since!)}${k.todayDone ? "" : " · today still to go"}`,
    rv: `${k.days}${k.more ? "+" : ""} ${k.days === 1 ? "day" : "days"}`, tone: "pos" });
  const h = usualHour.value;
  if (h) out.push({ key: "hour", icon: "clock", t: "Usual busiest hour", s: `${hourSpan(h.hour)} · average of ${h.days} days`, rv: `${n0(h.avg)} steps` });
  return out;
});
// a bar a day (in green once it reached the goal, as Home's and the calendar's), tapped to open the day; a year as the
// average day of each week (of its days with steps), tapped to open the week, since 365 bars would be hairlines
const bars = computed(() => {
  if (view.value !== "year") return days.value.map((d) => {
    const n = stepsOn(d), full = fmt.value.date(d, { day: "numeric", month: "short" });
    return { label: view.value === "week" ? fmt.value.date(d, { weekday: "short" }) : full.split(" ")[0]!, full, ...(view.value === "month" ? { group: month(d) } : {}),
      tip: fmt.value.date(d, { weekday: "short", day: "numeric", month: "short" }), value: n, ...(goal.value && n >= goal.value ? { color: "var(--pos)" } : {}), id: n ? d : undefined };
  });
  const wk = new Map<string, number[]>();
  for (const d of days.value) { const k = ymd(weekStartDate(at(d), s.value.firstDay)); const n = stepsOn(d); wk.set(k, n ? [...(wk.get(k) ?? []), n] : (wk.get(k) ?? [])); }
  return [...wk].map(([k, ns]) => {
    const full = fmt.value.date(k, { day: "numeric", month: "short" }), v = ns.length ? ns.reduce((t, n) => t + n, 0) / ns.length : 0;
    return { label: full.split(" ")[0]!, full, group: month(k), tip: `week of ${full}`, value: Math.round(v), ...(goal.value && v >= goal.value ? { color: "var(--pos)" } : {}), id: ns.length ? k : undefined };
  });
});
const periodFrom = computed(() => { const r = withSteps.value.map((d) => steps.value.get(d)!); return r.length && r.every((x) => x.source && x.source !== "manual" && x.source !== "activities") ? fromWhere(r.every((x) => x.worn !== false), dev.value) : ""; });
const tiles = computed(() => 1 + (goal.value ? 1 : 0) + (goal.value && streak.value ? 1 : 0));
// a bar's tip opens its day, a week's bar (the year view) its week
const pick = (d: string) => { anchor.value = d; view.value = view.value === "year" ? "week" : "day"; };
const openDay = (d: string | null) => { if (d) { anchor.value = d; view.value = "day"; } };
</script>

<template>
  <DayNav :title="title" :unit="view" :at-end="hasToday" :away="!hasToday" @step="shift" @today="anchor = today" />

  <div v-if="dailyQ.isError.value" class="card empty"><Icon name="info" :size="34" /><b>Couldn't load your steps</b>{{ (dailyQ.error.value as Error | null)?.message }}<br /><button class="btn tonal" @click="dailyQ.refetch()">Try again</button></div>
  <div v-else-if="dailyQ.isLoading.value" class="empty">Loading…</div>

  <template v-else-if="isDay">
    <div v-if="!dayN" class="card empty"><Icon name="steps" :size="34" /><b>No steps on this day</b>Pick another day with the arrows.</div>
    <template v-else>
      <!-- one card, as Heart's day and Sleep's night: the day's total against the goal and your usual day, its other
           numbers as a report's tiles, the hours with the day's sessions shaded on them, then the sessions, each part
           under a faint line -->
      <div class="card wkc">
        <div class="ch"><span class="bi"><Icon name="steps" :size="15" /></span><span class="t grow">Steps</span><span v-if="dayFrom" class="tiny">{{ dayFrom }}</span></div>
        <div class="gs-top">
          <Ring v-if="goal" :pct="pct" :size="64" :stroke="7" :done="pct >= 1" />
          <span v-else class="gs-ico"><Icon name="steps" :size="28" /></span>
          <div class="grow"><div class="gs-val">{{ n0(dayN) }}<small>steps</small></div><div v-if="goalLine" class="tiny">{{ goalLine }}</div>
            <div v-if="vsUsual" class="tiny"><span :class="vsUsual.tone">{{ vsUsual.text }}</span> vs usual {{ vsUsual.usual }}</div></div>
        </div>
        <div v-if="dayTiles.length" class="wstats rows2 csec">
          <div v-for="x in dayTiles" :key="x.key" class="ws" role="group" :aria-label="[x.label, x.value, x.unit, x.sub].filter(Boolean).join(' ')">
            <div class="wlb"><Icon :name="x.icon" :size="14" />{{ x.label }}</div>
            <div class="wv">{{ x.value }} <small v-if="x.unit">{{ x.unit }}</small></div>
            <div class="wd">{{ x.sub }}</div>
          </div>
        </div>
        <div class="csec"><div class="lbl hgap">Steps by hour</div>
          <template v-if="hours.length">
            <!-- keyed by the day: its hour labels are the same every day, so without it a zoom would carry over to the next -->
            <BarChart :key="anchor" :bars="hours" :height="170" :fmt="n0" :shade="shade" :xt="xt" @pick="(id) => router.push(id)" />
            <div v-if="legend.length" class="bmlegend st-leg"><span><i :style="{ background: DAY_DATA_COLOR }" />Steps</span><span v-for="k in legend" :key="k.color"><i :style="{ background: k.color }" />{{ k.name }}</span></div>
            <div v-if="busiest" class="tiny st-line">Busiest hour {{ busiest.tip }} · {{ n0(busiest.value) }} steps</div>
            <div v-if="still" class="tiny st-line">Quietest stretch {{ still.span }} · {{ mins(still.hours * 60) }} under {{ ACTIVE }} steps an hour</div>
            <div v-if="offHours >= 50" class="tiny st-line">{{ n0(offHours) }} steps of the total come from recorded activities and aren't in the hours.</div>
          </template>
          <div v-else-if="!hourQ.isFetching.value" class="tiny">{{ noRecords("day") }}</div>
          <div v-else class="tiny">Loading…</div>
        </div>
        <div v-if="sessions.length" class="csec"><div class="lbl hgap">Workouts and activities</div>
          <DaySessionList :sessions="sessions" :value="(x) => (x.steps != null ? `${n0(x.steps)} steps` : x.durationS ? fmt.dur(x.durationS, true) : '-')" /></div>
      </div>
    </template>
  </template>

  <template v-else>
    <div v-if="!withSteps.length" class="card empty"><Icon name="steps" :size="34" /><b>No steps in this {{ view }}</b>Pick another {{ view }} with the arrows.</div>
    <template v-else>
      <!-- the stretch's numbers, as Overview's and Sleep's tiles -->
      <div class="grid g4" :class="tiles < 4 ? `n${tiles}` : ''">
        <div class="card hero stat"><div class="lbl"><span class="bi"><Icon name="steps" :size="15" /></span>Steps</div><div class="val">{{ n0(avg) }}</div><div class="sub">average of {{ withSteps.length }} {{ withSteps.length === 1 ? "day" : "days" }}</div><Sparkline v-if="withSteps.length > 1" :values="withSteps.map(stepsOn)" color="var(--onc)" /></div>
        <div v-if="goal" class="card stat"><div class="lbl"><span class="bi"><Icon name="target" :size="15" /></span>Goal reached</div><div class="val">{{ reached }}<small>{{ reached === 1 ? "day" : "days" }}</small></div><div class="sub">of {{ withSteps.length }} · goal {{ n0(goal) }}</div></div>
        <div v-if="goal && streak" class="card stat"><div class="lbl"><span class="bi"><Icon name="link" :size="15" /></span>Longest streak</div><div class="val">{{ streak }}<small>{{ streak === 1 ? "day" : "days" }}</small></div><div class="sub">goal reached in a row</div></div>
      </div>
      <!-- as Stats → Heart's and Sleep's -->
      <div v-if="insights.length" class="card wkc spt">
        <div class="ch"><span class="bi"><Icon name="sparkle" :size="15" /></span><span class="t grow">What stands out</span></div>
        <div class="list st-ins">
          <div v-for="x in insights" :key="x.key" class="li">
            <Icon :name="x.icon" :size="18" :class="x.tone ?? 'muted'" />
            <div class="grow"><div class="t">{{ x.t }}</div><div class="s">{{ x.s }}</div></div>
            <b class="r rv" :class="x.tone">{{ x.rv }}</b>
          </div>
        </div>
      </div>
      <!-- the best and worst day and the stretch's total, once there are days to compare, as Sleep's best and worst nights -->
      <div v-if="withSteps.length > 1" class="card wkc spt">
        <div class="ch"><span class="bi"><Icon name="stats" :size="15" /></span><span class="t grow">Best and worst days</span></div>
        <div class="wstats rows2">
          <div class="ws click" role="button" tabindex="0" :aria-label="`Best day ${n0(stepsOn(best!))} steps ${day(best!)}`" @click="openDay(best)" @keydown.enter="openDay(best)"><div class="wlb"><Icon name="trophy" :size="14" />Best day<Icon name="right" :size="14" class="wgo" /></div><div class="wv">{{ n0(stepsOn(best!)) }} <small>steps</small></div><div class="wd">{{ day(best!) }}</div></div>
          <div class="ws click" role="button" tabindex="0" :aria-label="`Worst day ${n0(stepsOn(worst!))} steps ${day(worst!)}`" @click="openDay(worst)" @keydown.enter="openDay(worst)"><div class="wlb"><Icon name="steps" :size="14" />Worst day<Icon name="right" :size="14" class="wgo" /></div><div class="wv">{{ n0(stepsOn(worst!)) }} <small>steps</small></div><div class="wd">{{ day(worst!) }}</div></div>
          <div class="ws" role="group" :aria-label="`Total ${n0(sum)} steps`"><div class="wlb"><Icon name="plus" :size="14" />Total</div><div class="wv">{{ n0(sum) }} <small>steps</small></div><div class="wd">in {{ withSteps.length }} days</div></div>
        </div>
      </div>

      <div class="card spt">
        <div class="lbl hgap">{{ view === "year" ? "Average steps a day, by week" : "Steps per day" }}{{ periodFrom ? ` · ${periodFrom}` : "" }}{{ goal ? ` · goal ${n0(goal)}` : "" }}</div>
        <BarChart :bars="bars" :goal="goal ?? undefined" :height="170" :fmt="n0" @pick="pick" />
        <div v-if="bars.some((b) => b.color)" class="bmlegend st-leg"><span><i style="background: var(--acc)" />Steps</span><span><i style="background: var(--pos)" />Goal reached</span></div>
        <div class="tiny st-line">{{ view === "year" ? "Tap a week to see its average steps a day." : "Tap a day to see its steps." }}</div>
      </div>
    </template>
  </template>
</template>

<style scoped>
.st-line { margin-top: var(--tdy); }
.st-leg { margin-top: var(--hg); }
/* the highlights as Stats → Heart's and Sleep's: the last row without its line, the number in the row's tone */
.st-ins .li:last-child { border-bottom: 0; padding-bottom: 0; }
.st-ins .li:first-child { padding-top: 0; }
.st-ins .grow { min-width: 0; }
.rv { font-variant-numeric: tabular-nums; white-space: nowrap; }
</style>
