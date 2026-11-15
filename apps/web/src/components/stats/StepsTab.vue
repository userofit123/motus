<script setup lang="ts">
// Stats → Steps (M-241), there once there are steps at all (typed, from a band or from recorded walks). Day: the day's
// steps against the steps goal, how they spread over its hours (walks and workouts marked), and the band's distance,
// active calories, active hours and how the day compares with your usual one. Week, month, year: a bar a day (a year:
// the average day of each week), the average, the best day, the days the goal was reached and the longest run of them.
// A day's total is the daily log's (stepsByDay: the value the day shows everywhere, recorded walks counted in); the
// hours come from the band's saved records (/health/records/hourly), only for days they were saved: a day with a total
// and no hours shows its total and tiles without the chart.
import { computed, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { ymd, weekStartDate } from "@motus/shared";
import { api } from "../../api/client";
import { useCalendar, useSettings, useTypeName } from "../../api/queries";
import { useFmt, unitOf } from "../../core/format";
import { useStepGoal } from "../../core/goals";
import { fromWhere, useDevice } from "../../native/health";
import Icon from "../Icon.vue";
import Ring from "../Ring.vue";
import BarChart from "../BarChart.vue";
import Sparkline from "../Sparkline.vue";

export type StepsView = "day" | "week" | "month" | "year";
const view = defineModel<StepsView>("view", { required: true });
const props = defineProps<{ day?: string }>();
const fmt = useFmt();
const s = useSettings();
const dev = useDevice();
const typeName = useTypeName();
const stepGoal = useStepGoal();
const goal = computed(() => stepGoal.value?.target ?? null);

// days as "YYYY-MM-DD" in the app's calendar; a Date at noon, so a clock change never tips it into the next day
const today = ymd(new Date());
const at = (d: string) => new Date(d + "T12:00");
const plus = (d: string, n: number) => { const x = at(d); x.setDate(x.getDate() + n); return ymd(x); };
const anchor = ref(props.day && props.day <= today ? props.day : today);
// opened again from elsewhere (Home, the calendar) with a day while this tab is still around
watch(() => props.day, (d) => { if (d && d <= today) { anchor.value = d; view.value = "day"; } });

// the shown stretch [from, to): the day, its week (from the first day of the week in Settings), month or year
const range = computed(() => {
  const a = at(anchor.value);
  if (view.value === "day") return { from: anchor.value, to: plus(anchor.value, 1) };
  if (view.value === "week") { const w = ymd(weekStartDate(a, s.value.firstDay)); return { from: w, to: plus(w, 7) }; }
  if (view.value === "month") return { from: ymd(new Date(a.getFullYear(), a.getMonth(), 1)), to: ymd(new Date(a.getFullYear(), a.getMonth() + 1, 1)) };
  return { from: ymd(new Date(a.getFullYear(), 0, 1)), to: ymd(new Date(a.getFullYear() + 1, 0, 1)) };
});
const hasToday = computed(() => range.value.from <= today && today < range.value.to);
const shift = (n: number) => {
  const a = at(anchor.value);
  if (view.value === "day") a.setDate(a.getDate() + n);
  else if (view.value === "week") a.setDate(a.getDate() + 7 * n);
  else if (view.value === "month") a.setMonth(a.getMonth() + n, 1);
  else a.setFullYear(a.getFullYear() + n, 0, 1);
  // never past today: a later week, month or year lands on today
  anchor.value = ymd(a) > today ? today : ymd(a);
};
const title = computed(() => {
  const r = range.value, thisYear = r.from.slice(0, 4) === today.slice(0, 4);
  // a day of another year without its weekday, so the title still fits between the arrows on a phone
  if (view.value === "day") return fmt.value.date(r.from, thisYear ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
  // a week of another year in short numeric dates, so its year still fits between the arrows on a phone
  if (view.value === "week") { const last = plus(r.to, -1); return thisYear ? `${fmt.value.date(r.from, { day: "numeric", month: "short" })}-${fmt.value.date(last, { day: "numeric", month: "short" })}`
    : `${fmt.value.date(r.from, { day: "numeric", month: "numeric" })}-${fmt.value.date(last, { day: "numeric", month: "numeric", year: "2-digit" })}`; }
  if (view.value === "month") return fmt.value.date(r.from, { month: "long", year: "numeric" });
  return r.from.slice(0, 4);
});

// the daily log from the first of the month 4 weeks before the stretch (your usual day looks back 4 weeks), under the
// key Home's daily log uses, so live updates reload it and moving a day at a time doesn't load it again
const from = computed(() => { const x = at(plus(range.value.from, -28)); return ymd(new Date(x.getFullYear(), x.getMonth(), 1)); });
type Daily = { date: string; kind: string; value: number | string; source?: string | null; worn?: boolean };
const dailyQ = useQuery({ queryKey: computed(() => ["activities", "daily", from.value]),
  queryFn: () => api.get<Daily[]>("/daily", { from: from.value, tz: new Date().getTimezoneOffset() }) });
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
const hourQ = useQuery({ queryKey: computed(() => ["readings", "hourly", "steps", anchor.value]), enabled: computed(() => isDay.value && dayN.value > 0), retry: false,
  queryFn: () => api.get<{ hours: { at: string; sum?: number }[] }>("/health/records/hourly", { type: "steps", from: midnight(anchor.value).toISOString(), to: midnight(plus(anchor.value, 1)).toISOString(), zone }) });
const calQ = useCalendar(computed(() => ({ from: anchor.value, to: anchor.value })), computed(() => isDay.value && dayN.value > 0));
// the day's sessions as [start, end) in ms: recorded activities (walks…) and workouts
const sessions = computed(() => {
  const c: any = calQ.data.value;
  if (!c) return [];
  const span = (x: any) => { const a = new Date(x.startedAt).getTime(); return { a, b: a + Math.max(60, Number(x.durationS) || 0) * 1000 }; };
  return [...(c.activities ?? []).map((x: any) => ({ ...span(x), kind: "activity" as const, type: x.type as string, name: (x.name as string) || typeName(x.type) })),
    ...(c.workouts ?? []).map((x: any) => ({ ...span(x), kind: "workout" as const, type: "", name: (x.name as string) || "Workout" }))];
});
const ACT_COLOR = "var(--c3)", WK_COLOR = "var(--c2)";
// 24 bars (23 or 25 on a clock change day), each the steps in that hour of the app's calendar; an hour a session took
// at least a quarter of is in its colour and named in its tip
const hours = computed(() => {
  const list = hourQ.data.value?.hours ?? [];
  if (!list.some((h) => (h.sum ?? 0) > 0)) return [];
  const sums = new Map<number, number>();
  for (const h of list) { const t = new Date(h.at).getTime(); sums.set(t, (sums.get(t) ?? 0) + (h.sum ?? 0)); }
  const out: { label: string; value: number; tip: string; color?: string; kind?: "activity" | "workout"; type?: string; a: number }[] = [];
  const end = midnight(plus(anchor.value, 1)).getTime();
  for (let a = midnight(anchor.value).getTime(); a < end; a += 3600_000) {
    const b = a + 3600_000;
    let best: (typeof sessions.value)[number] | null = null, most = 0;
    for (const x of sessions.value) { const m = Math.min(b, x.b) - Math.max(a, x.a); if (m > most) { most = m; best = x; } }
    const mark = best && most >= 15 * 60_000 ? best : null;
    const iso = new Date(a).toISOString();
    out.push({ a, label: fmt.value.time(iso).replace(/:00(?=\D|$)/, ""), value: Math.round(sums.get(a) ?? 0),
      tip: `${fmt.value.time(iso)}-${fmt.value.time(new Date(b).toISOString())}${mark ? ` · ${mark.name}` : ""}`,
      ...(mark ? { color: mark.kind === "workout" ? WK_COLOR : ACT_COLOR, kind: mark.kind, type: mark.type } : {}) });
  }
  return out;
});
// the legend names the bars' colours only once a session marks any; recorded walks as "Walk", other activities as "Activity"
const legend = computed(() => {
  const acts = hours.value.filter((h) => h.kind === "activity"), wks = hours.value.some((h) => h.kind === "workout");
  if (!acts.length && !wks) return [];
  return [{ name: "Steps", color: "var(--acc)" }, ...(acts.length ? [{ name: acts.every((h) => h.type === "walk") ? "Walk" : "Activity", color: ACT_COLOR }] : []), ...(wks ? [{ name: "Workout", color: WK_COLOR }] : [])];
});
const busiest = computed(() => hours.value.reduce<(typeof hours.value)[number] | null>((m, h) => (!m || h.value > m.value ? h : m), null));
// active hours: hours with at least 250 steps, as trackers count them
const ACTIVE = 250;
const activeH = computed(() => hours.value.filter((h) => h.value >= ACTIVE).length);
// your usual day: the middle of the 4 weeks before (days with steps), from 5 of them
const usual = computed(() => {
  const xs: number[] = [];
  for (let i = 1; i <= 28; i++) { const n = stepsOn(plus(anchor.value, -i)); if (n > 0) xs.push(n); }
  if (xs.length < 5) return null;
  xs.sort((a, b) => a - b);
  const m = xs.length >> 1;
  return xs.length % 2 ? xs[m]! : (xs[m - 1]! + xs[m]!) / 2;
});
type Tile = { key: string; icon: string; label: string; value: string; unit: string; sub: string; tone?: string };
const dayTiles = computed(() => {
  const out: Tile[] = [], d = anchor.value;
  const m = Number(dist.value.get(d)?.value ?? 0);
  if (m) { const u = unitOf(fmt.value.dist(m, 1)); out.push({ key: "dist", icon: "walk", label: "Distance", value: u.value, unit: u.unit, sub: "" }); }
  const k = Number(kcal.value.get(d)?.value ?? 0);
  if (k) out.push({ key: "kcal", icon: "flame", label: "Active calories", value: n0(k), unit: "kcal", sub: "" });
  if (hours.value.length) out.push({ key: "active", icon: "clock", label: "Active hours", value: String(activeH.value), unit: "h", sub: `${ACTIVE}+ steps an hour` });
  if (usual.value) {
    const pc = Math.round((dayN.value / usual.value - 1) * 100);
    out.push({ key: "usual", icon: "stats", label: "Vs your usual day", value: pc === 0 ? "0%" : `${pc > 0 ? "+" : "-"}${Math.abs(pc)}%`, unit: "", sub: `usual ${n0(usual.value)}`, tone: Math.abs(pc) < 5 ? undefined : pc > 0 ? "pos" : "neg" });
  }
  return out;
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
const reached = computed(() => (goal.value ? withSteps.value.filter((d) => stepsOn(d) >= goal.value!).length : 0));
// the longest run of days in a row that reached the goal, in this stretch
const streak = computed(() => {
  if (!goal.value) return 0;
  let run = 0, top = 0;
  for (const d of days.value) { run = stepsOn(d) >= goal.value ? run + 1 : 0; top = Math.max(top, run); }
  return top;
});
const month = (d: string) => fmt.value.date(d, { month: "short" });
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
const pick = (d: string) => { anchor.value = d; view.value = view.value === "year" ? "week" : "day"; };
const periodFrom = computed(() => { const r = withSteps.value.map((d) => steps.value.get(d)!); return r.length && r.every((x) => x.source && x.source !== "manual" && x.source !== "activities") ? fromWhere(r.every((x) => x.worn !== false), dev.value) : ""; });
const tiles = computed(() => 2 + (goal.value ? 1 : 0) + (goal.value && streak.value ? 1 : 0));
const openDay = (d: string | null) => { if (d) { anchor.value = d; view.value = "day"; } };
</script>

<template>
  <div class="calnav">
    <div class="calm">
      <button class="ib sm plain" :aria-label="`Previous ${view}`" @click="shift(-1)"><Icon name="left" :size="18" /></button>
      <b>{{ title }}</b>
      <button class="ib sm plain" :aria-label="`Next ${view}`" :disabled="hasToday" @click="shift(1)"><Icon name="right" :size="18" /></button>
    </div>
    <div class="calx"><button v-if="!hasToday" class="fchip acc" @click="anchor = today">Today</button></div>
  </div>

  <div v-if="dailyQ.isError.value" class="card empty"><Icon name="info" :size="34" /><b>Couldn't load your steps</b>{{ (dailyQ.error.value as Error | null)?.message }}<br /><button class="btn tonal" @click="dailyQ.refetch()">Try again</button></div>
  <div v-else-if="dailyQ.isLoading.value" class="empty">Loading…</div>

  <template v-else-if="isDay">
    <div v-if="!dayN" class="card empty"><Icon name="steps" :size="34" /><b>No steps on this day</b>Pick another day with the arrows.</div>
    <template v-else>
      <!-- the day's total against the goal, then the day's other numbers as a report's tiles under a faint line -->
      <div class="card wkc">
        <div class="ch"><span class="bi"><Icon name="steps" :size="15" /></span><span class="t grow">Steps</span><span v-if="dayFrom" class="tiny">{{ dayFrom }}</span></div>
        <div class="gs-top">
          <Ring v-if="goal" :pct="pct" :size="64" :stroke="7" :done="pct >= 1" />
          <div class="grow"><div class="gs-val">{{ n0(dayN) }}<small>steps</small></div><div v-if="goalLine" class="tiny">{{ goalLine }}</div></div>
        </div>
        <div v-if="dayTiles.length" class="wstats rows2 st-tiles" :class="{ n4: dayTiles.length === 4 }">
          <div v-for="x in dayTiles" :key="x.key" class="ws" role="group" :aria-label="[x.label, x.value, x.unit, x.sub].filter(Boolean).join(' ')">
            <div class="wlb"><Icon :name="x.icon" :size="14" />{{ x.label }}</div>
            <div class="wv" :class="x.tone">{{ x.value }} <small v-if="x.unit">{{ x.unit }}</small></div>
            <div class="wd">{{ x.sub }}</div>
          </div>
        </div>
      </div>

      <div v-if="hours.length" class="card spt">
        <div class="lbl hgap">Steps by hour</div>
        <BarChart :bars="hours" :height="170" :fmt="n0" />
        <div v-if="legend.length" class="bmlegend st-leg"><span v-for="k in legend" :key="k.name"><i :style="{ background: k.color }" />{{ k.name }}</span></div>
        <div v-if="busiest" class="tiny st-line">Busiest hour {{ busiest.tip.split(" · ")[0] }} · {{ n0(busiest.value) }} steps</div>
      </div>
    </template>
  </template>

  <template v-else>
    <div v-if="!withSteps.length" class="card empty"><Icon name="steps" :size="34" /><b>No steps in this {{ view }}</b>Pick another {{ view }} with the arrows.</div>
    <template v-else>
      <!-- the stretch's numbers, as Overview's and Sleep's tiles -->
      <div class="grid g4" :class="tiles < 4 ? `n${tiles}` : ''">
        <div class="card hero stat"><div class="lbl"><span class="bi"><Icon name="steps" :size="15" /></span>Average</div><div class="val">{{ n0(avg) }}</div><div class="sub">steps a day · {{ withSteps.length }} {{ withSteps.length === 1 ? "day" : "days" }}</div><Sparkline v-if="withSteps.length > 1" :values="withSteps.map(stepsOn)" color="var(--onc)" /></div>
        <div class="card stat click" role="button" tabindex="0" @click="openDay(best)" @keydown.enter="openDay(best)"><div class="lbl"><span class="bi"><Icon name="trophy" :size="15" /></span>Best day</div><div class="val">{{ n0(stepsOn(best!)) }}</div><div class="sub">{{ fmt.date(best!, { weekday: "short", day: "numeric", month: "short" }) }}</div></div>
        <div v-if="goal" class="card stat"><div class="lbl"><span class="bi"><Icon name="target" :size="15" /></span>Goal reached</div><div class="val">{{ reached }}<small>{{ reached === 1 ? "day" : "days" }}</small></div><div class="sub">of {{ withSteps.length }} · goal {{ n0(goal) }}</div></div>
        <div v-if="goal && streak" class="card stat"><div class="lbl"><span class="bi"><Icon name="flame" :size="15" /></span>Longest streak</div><div class="val">{{ streak }}<small>{{ streak === 1 ? "day" : "days" }}</small></div><div class="sub">goal reached in a row</div></div>
      </div>

      <div class="card spt">
        <div class="lbl hgap">{{ view === "year" ? "Average steps a day, by week" : "Steps per day" }}{{ periodFrom ? ` · ${periodFrom}` : "" }}{{ goal ? ` · goal ${n0(goal)}` : "" }}</div>
        <BarChart :bars="bars" :goal="goal ?? undefined" :height="170" :fmt="n0" @pick="pick" />
        <div v-if="bars.some((b) => b.color)" class="bmlegend st-leg"><span><i style="background: var(--acc)" />Steps</span><span><i style="background: var(--pos)" />Goal reached</span></div>
        <div class="tiny st-line">{{ view === "year" ? "Tap a week to open it." : "Tap a day to open it." }}</div>
      </div>
    </template>
  </template>
</template>

<style scoped>
/* the day's tiles a block-padding below the total, under a faint line, as last night's stages on Sleep */
.st-tiles { margin-top: var(--cpy); padding-top: var(--cpy); border-top: 1px solid var(--ol); }
.st-line { margin-top: 6px; }
.st-leg { margin-top: var(--hg); }
</style>
