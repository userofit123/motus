<script setup lang="ts">
// Stats (requirement 16): progress over time overall, per routine, per exercise, per muscle group and for activities.
// Body weight and measurements are charted on the Body page (one thing, like one exercise's charts on its page);
// /stats?tab=body, the old Body tab, is sent there (router.ts).
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { GROUPS, muscleName, weekStartOf, weekStartDate, daysIntoWeek, weekdayOrder, statsPeriod, STATS_PERIODS, ymd, type StatsPeriod, WEEKLY_SET_RANGE, num, percentChange } from "@motus/shared";
import { useStats, useHealthScores, useReadiness, useSettings, useAchievements, useGoals, useHealthAvailable, useTypeName, useActivityFigures, loaded } from "../api/queries";
import { useFmt, unitOf, localYmd, activityIcon } from "../core/format";
import { startOpen } from "../core/ui";
import { fromWhere, useDevice } from "../native/health";
import Icon from "../components/Icon.vue";
import DotLine from "../components/DotLine.vue";
import SearchField from "../components/SearchField.vue";
import AppSelect from "../components/AppSelect.vue";
import LineChart from "../components/LineChart.vue";
import { useTip, TIP_ROOM } from "../components/useTip";
import { useWidth } from "../components/useWidth";
import BarChart from "../components/BarChart.vue";
import BodyMap from "../components/BodyMap.vue";
import Sparkline from "../components/Sparkline.vue";
import Reports from "../components/Reports.vue";
import FilterPanel from "../components/FilterPanel.vue";
import FilterRow from "../components/FilterRow.vue";
import LearnButton from "../components/learn/LearnButton.vue";
import SleepTab, { type SleepView } from "../components/stats/SleepTab.vue";
import HeartTab, { type HeartView } from "../components/stats/HeartTab.vue";
import StepsTab, { type StepsView } from "../components/stats/StepsTab.vue";
import ScoresTab from "../components/stats/ScoresTab.vue";

const route = useRoute(), router = useRouter();
const s = useSettings();
const dev = useDevice();
const fmt = useFmt();
const tab = ref(String(route.query.tab ?? "overview"));
watch(tab, (t) => router.replace({ query: t === "overview" ? {} : { tab: t, ...((t === "steps" || t === "sleep" || t === "heart") && stepsDay.value ? { day: stepsDay.value } : {}) } }));
// opened again from elsewhere (Home's muscles card) while this page is still around
watch(() => route.query.tab, (t) => { if (route.name === "stats") tab.value = String(t ?? "overview"); });
// calendar periods (today, this week, last month…) and rolling ones (the last 3 months…); weeks start on the day chosen in Settings
const PERIODS = [...STATS_PERIODS];
// Steps has its own stretch (a day, week, month or year, moved with its arrows) in the period's place; a link with a day
// (Home's Activity today, the calendar) opens that day
const STEP_VIEWS = [{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "year", label: "Year" }];
const stepsView = ref<StepsView>("day");
// Sleep the same, a night at a time in its Day's place
const SLEEP_VIEWS = [{ value: "night", label: "Night" }, ...STEP_VIEWS.slice(1)];
const sleepView = ref<SleepView>("night");
// Heart the same as Steps: a day, or the week, month or year around it
const heartView = ref<HeartView>("day");
const stepsDay = computed(() => (typeof route.query.day === "string" && /^\d{4}-\d\d-\d\d$/.test(route.query.day) ? route.query.day : undefined));
// Steps', Sleep's and Heart's day pickers write the shown day into the link, so a refresh or Back keeps it
const setDay = (day: string) => { if (day !== stepsDay.value) router.replace({ query: { ...route.query, day } }); };
const rk = ref<StatsPeriod>("3m");
const per = computed(() => statsPeriod(rk.value, new Date(), s.value.firstDay));
const range = computed(() => { const p = per.value; return p.from ? { from: p.from.toISOString(), ...(p.to ? { to: p.to.toISOString() } : {}) } : {}; });
const prevRange = computed(() => { const p = per.value; return p.prevFrom ? { from: p.prevFrom.toISOString(), to: p.prevTo!.toISOString() } : { from: "2999-01-01" }; });
const st = useStats(range);
const prev = useStats(prevRange);
// the goal line: your weekly gym-workout goal, the first one on Home (else the first there is), when you have one
const goals = useGoals();
const wkGoal = computed(() => { const gs = (goals.data.value ?? []).filter((g) => g.status === "active" && g.period === "week" && (g.metric === "workouts" || (g.metric === "sessions" && g.scopeId === "workout")));
  const ids = s.value.home.goals.map((x) => x.id); return (gs.find((g) => ids.includes(g.id)) ?? gs[0])?.target ?? null; });
const ach = useAchievements(computed(() => !!s.value.features.achievements));
const typeName = useTypeName();
const achAmount = (unit: string, v: number) => fmt.value.ach(unit, v);
const d = computed<any>(() => st.data.value);
const p = computed<any>(() => prev.data.value);
// Steps, Sleep and Heart only once a band (or a script) has handed over that kind of data: never an empty tab for something
// this person doesn't track
const avail = useHealthAvailable();
// Scores once one of the health scores (a feature) has its data, or once Readiness has a score: Readiness is no feature
// (it comes with a band's sleep and heart data) and this tab is the one place it is shown in full, so Home's Readiness
// opens it there with the Health scores feature off too (the tab then holds Readiness alone)
const scoresQ = useHealthScores(computed(() => !!s.value.features.scores));
// readiness needs a band's sleep or heart data, so it is only asked for once there is some (and only then counted:
// a disabled query still hands back what it had cached)
const readyOn = computed(() => !!(avail.data.value?.sleep || avail.data.value?.heart));
const readyQ = useReadiness(readyOn);
const hasScores = computed(() => (!!s.value.features.scores && !!scoresQ.data.value && !!(scoresQ.data.value.sleep || scoresQ.data.value.activity || scoresQ.data.value.strength || scoresQ.data.value.minor))
  || (readyOn.value && readyQ.data.value?.score != null));
const TABS = computed(() => [["overview", "Overview"], ["routines", "Routines"], ["exercises", "Exercises"], ["muscles", "Muscles"], ["activities", "Activities"],
  ...(avail.data.value?.steps ? [["steps", "Steps"]] : []), ...(avail.data.value?.sleep ? [["sleep", "Sleep"]] : []), ...(avail.data.value?.heart ? [["heart", "Heart"]] : []), ...(hasScores.value ? [["scores", "Scores"]] : []), ...(s.value.features.reports ? [["reports", "Reports"]] : []), ...(s.value.features.achievements ? [["achievements", "Achievements"]] : [])]);

// an activity's distance only where its type tracks it, as its page shows it
const figures = useActivityFigures(), distOf = (a: any) => figures.dist(a) ?? 0;
const totals = (x: any) => x ? {
  workouts: x.workouts.length, timeS: x.workouts.reduce((a: number, w: any) => a + w.durationS, 0) + x.activities.reduce((a: number, w: any) => a + w.durationS, 0),
  volumeKg: x.workouts.reduce((a: number, w: any) => a + w.volumeKg, 0), sets: x.workouts.reduce((a: number, w: any) => a + w.sets, 0),
  activities: x.activities.length, distM: x.activities.reduce((a: number, w: any) => a + distOf(w), 0),
  days: new Set([...x.workouts, ...x.activities].map((w: any) => localYmd(new Date(w.startedAt)))).size,
} : null;
const T = computed(() => totals(d.value)), P = computed(() => totals(p.value));
// the volume as the value with its unit small beside it ("12.4k" kg), as the other tiles' units
const volParts = computed(() => unitOf(fmt.value.vol(T.value?.volumeKg ?? 0)));
const change = (k: string) => { const pc = percentChange((T.value as any)?.[k], (P.value as any)?.[k]); return pc && `${pc} vs previous`; };
// weeks in range
const weeks = computed(() => {
  if (!d.value) return [];
  const m = new Map<string, any>();
  // every week the period touches (the last 104 at most); a rolling period leaves out the week it starts in the middle of,
  // so "Last 4 weeks" is four bars; All time shows at least 8 weeks
  const fd = s.value.firstDay, p = per.value, last = weekStartDate(p.to ? new Date(p.to.getTime() - 1) : new Date(), fd);
  let w = weekStartDate(p.from ?? new Date(d.value.workouts[0]?.startedAt ?? Date.now()), fd);
  if (p.from && ["4w", "3m", "6m", "1y"].includes(rk.value) && w < p.from) w.setDate(w.getDate() + 7);
  if (!p.from) w = new Date(Math.min(w.getTime(), new Date(last.getFullYear(), last.getMonth(), last.getDate() - 7 * 7).getTime()));
  const keys: string[] = [];
  for (; w <= last; w = new Date(w.getFullYear(), w.getMonth(), w.getDate() + 7)) keys.push(ymd(w));
  for (const k of keys.slice(-104)) m.set(k, { workouts: 0, sets: 0, volumeKg: 0, muscles: {} as Record<string, number>, timeS: 0 });
  for (const w of d.value.workouts) { const k = weekStartOf(new Date(w.startedAt), s.value.firstDay); const x = m.get(k); if (!x) continue; x.workouts++; x.sets += w.sets; x.volumeKg += w.volumeKg; x.timeS += w.durationS; for (const [mm, v] of Object.entries(w.muscles as Record<string, number>)) x.muscles[mm] = (x.muscles[mm] ?? 0) + v; }
  for (const a of d.value.activities) { const x = m.get(weekStartOf(new Date(a.startedAt), s.value.firstDay)); if (x) x.timeS += a.durationS; }
  return [...m].map(([k, v]) => ({ week: k, ...v }));
});
const wlabel = (k: string) => fmt.value.date(k, { day: "numeric", month: "short" });
// the month under the first week of each month, so "16 30 13 27" says where one month ends (as in the Sleep charts)
const monthOf = (k: string) => fmt.value.date(k, { month: "short" });
// consistency: one square per day for the last 26 weeks
const heat = computed(() => {
  const on = new Map<string, number>();
  for (const w of [...(d.value?.workouts ?? []), ...(d.value?.activities ?? [])]) { const k = localYmd(new Date(w.startedAt)); on.set(k, (on.get(k) ?? 0) + 1); }
  const start = new Date(); start.setDate(start.getDate() - 7 * 25 - daysIntoWeek(start.getDay(), s.value.firstDay));
  return Array.from({ length: 26 * 7 }, (_, i) => { const x = new Date(start); x.setDate(start.getDate() + i); const k = localYmd(x); return { k, n: on.get(k) ?? 0, future: x > new Date() }; });
});
// a day's tip, as every chart's: over its square on hover, gone when the pointer leaves; a click or a tap pins it until a
// click or tap outside or any scroll, and a pinned tip of a day you trained opens the Calendar on that day (its chevron).
// Pinned, it is clicked, so it sits above the whole grid, never over a square, in TIP_ROOM kept free over the grid so it
// doesn't cover the card's title either. Clicking the same day again, the room above the grid or between its squares
// puts it away
const heatBox = ref<HTMLElement | null>(null), heatTip = ref<{ i: number; x: number; y: number; pin?: boolean } | null>(null);
const { el: heatTipEl, style: heatTipStyle } = useTip(useWidth(heatBox));
function heatAt(e: Event, i: number, pin = false) {
  if (!pin && heatTip.value?.pin) return;
  if (pin && heatTip.value?.pin && heatTip.value.i === i) { heatTip.value = null; return; }
  const box = heatBox.value; if (!box || heat.value[i]?.future) { heatTip.value = null; return; }
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect(), b = box.getBoundingClientRect();
  heatTip.value = { i, x: r.left - b.left + r.width / 2, y: pin ? TIP_ROOM : r.top - b.top, pin };
}
const heatOut = (e: PointerEvent) => { if (heatTip.value && !heatBox.value?.contains(e.target as Node)) heatTip.value = null; };
const heatAway = () => { heatTip.value = null; };
const heatUnlisten = () => { document.removeEventListener("pointerdown", heatOut, true); document.removeEventListener("scroll", heatAway, true); };
watch(() => heatTip.value?.pin, (p) => {
  if (!p) return heatUnlisten();
  document.addEventListener("pointerdown", heatOut, true);
  document.addEventListener("scroll", heatAway, { capture: true, passive: true });
});
onBeforeUnmount(heatUnlisten);
const heatGo = computed(() => (heatTip.value?.pin && heat.value[heatTip.value.i]?.n ? heat.value[heatTip.value.i]!.k : null));
const openHeat = () => { const d = heatGo.value; if (!d) return; heatTip.value = null; router.push(`/history?date=${d}`); };
const heatText = (n: number) => (!n ? "No training" : n === 1 ? "Trained once" : n === 2 ? "Trained twice" : `Trained ${n} times`);
const dow = computed(() => { const c = [0, 0, 0, 0, 0, 0, 0]; for (const w of d.value?.workouts ?? []) c[new Date(w.startedAt).getDay()]!++; return weekdayOrder(s.value.firstDay).map((j) => ({ label: "SMTWTFS"[j]!, value: c[j]! })); });
const hours = computed(() => { const b = [0, 0, 0, 0, 0, 0]; for (const w of d.value?.workouts ?? []) b[Math.floor(new Date(w.startedAt).getHours() / 4)]!++; return ["0-4", "4-8", "8-12", "12-16", "16-20", "20-24"].map((l, i) => ({ label: l, value: b[i]! })); });
// exercises
const exq = ref(""), exSort = ref<"times" | "change" | "stalled">("times");
const exList = computed(() => (d.value?.exercises ?? []).filter((e: any) => e.times && e.name.toLowerCase().includes(exq.value.toLowerCase()))
  .sort((a: any, b: any) => exSort.value === "change" ? b.change - a.change : exSort.value === "stalled" ? Number(b.stalled) - Number(a.stalled) || b.times - a.times : b.times - a.times));
const EX_ORDER = [{ value: "times", label: "Most done" }, { value: "change", label: "Most improved" }, { value: "stalled", label: "Stalled" }];
const skipped = computed(() => (d.value?.exercises ?? []).filter((e: any) => e.skipped).sort((a: any, b: any) => b.skipped - a.skipped).slice(0, 5));
// muscles
// sets per muscle over the last 7 days (rolling), from the workouts the period holds
const groupWeek = computed(() => { const w: Record<string, number> = {}, since = Date.now() - 7 * 86400000;
  for (const x of d.value?.workouts ?? []) if (new Date(x.startedAt).getTime() >= since) for (const [m, v] of Object.entries(x.muscles as Record<string, number>)) w[m] = (w[m] ?? 0) + v; return GROUPS.filter((g) => g.id !== "neck").map((g) => ({ label: g.name, value: Math.round(g.muscles.reduce((a, m) => a + (w[m] ?? 0), 0) * 10) / 10 })); });
const groupAvg = computed(() => { const ws = weeks.value.filter((w) => w.workouts); return GROUPS.filter((g) => g.id !== "neck").map((g) => ({ label: g.name, value: ws.length ? Math.round((ws.reduce((a, w) => a + g.muscles.reduce((b, m) => b + (w.muscles[m] ?? 0), 0), 0) / ws.length) * 10) / 10 : 0 })); });
const balance = computed(() => {
  const m = d.value?.muscles ?? {}; const sum = (ks: string[]) => ks.reduce((a, k) => a + (m[k] ?? 0), 0);
  return { push: sum(["chest", "shoulders", "triceps"]), pull: sum(["lats", "middle back", "biceps", "traps"]), upper: sum(["chest", "shoulders", "triceps", "lats", "middle back", "biceps", "traps", "forearms"]), lower: sum(["quadriceps", "hamstrings", "glutes", "calves", "adductors", "abductors"]) };
});
// training weeks in the period: with one, its average is just this week again, so the average waits for a second
const trainWeeks = computed(() => weeks.value.filter((w) => w.workouts).length);
// the muscles pointed out on the figure: one muscle (its own tap or label), or a whole band from the legend; again clears
const mSel = ref<{ tier?: number; muscles: string[] } | null>(null);
watch(rk, () => (mSel.value = null));
const pickMuscle = (m: string) => { mSel.value = !mSel.value?.tier && mSel.value?.muscles[0] === m ? null : { muscles: [m] }; };
const pickTier = (t: number, ms: string[]) => { mSel.value = mSel.value?.tier === t ? null : { tier: t, muscles: ms }; };
const neglected = computed(() => GROUPS.filter((g) => g.id !== "neck" && g.muscles.every((m) => !(d.value?.muscles?.[m]))).map((g) => g.name));
// activities
const actTypes = computed(() => { const m = new Map<string, any>(); for (const a of d.value?.activities ?? []) { const x = m.get(a.type) ?? { type: a.type, n: 0, s: 0, m: 0, ps: 0 }; x.n++; x.s += a.durationS; x.m += distOf(a);
    // pace as the activity page shows it: moving time where known, else total, over the sessions that have a distance
    if (distOf(a)) x.ps += a.movingS || a.durationS; m.set(a.type, x); } return [...m.values()].sort((a, b) => b.n - a.n); });
const actWeeks = computed(() => weeks.value.map((w) => ({ week: w.week, label: wlabel(w.week), value: (d.value?.activities ?? []).filter((a: any) => weekStartOf(new Date(a.startedAt), s.value.firstDay) === w.week).reduce((t: number, a: any) => t + distOf(a), 0) / (fmt.value.du === "km" ? 1000 : 1609.344) })));
// a band's whole-day distance and active calories (Health Connect), each only when it has data in the period: the day's
// total, so recorded activities are already in it and aren't added on top
const inPeriod = (x: any) => { const k = String(x.date).slice(0, 10), p = per.value; return (!p.from || k >= ymd(p.from)) && (!p.to || k < ymd(p.to)); };
const dayPts = (kind: string, f: (v: number) => number) => (d.value?.daily ?? []).filter((x: any) => x.kind === kind && inPeriod(x)).map((x: any) => ({ x: new Date(String(x.date).slice(0, 10) + "T12:00").getTime(), y: f(Number(x.value)) })).sort((a: any, b: any) => a.x - b.x) as { x: number; y: number }[];
const bandDist = computed(() => dayPts("distance_m", (m) => Math.round(fmt.value.distNum(m) * 100) / 100));
const bandKcal = computed(() => dayPts("active_kcal", (v) => Math.round(v)));
// the same for the day totals' charts (only ever from Health Connect)
const totalsFrom = (kind: string) => fromWhere((d.value?.daily ?? []).filter((x: any) => x.kind === kind && inPeriod(x)).every((x: any) => x.worn !== false), dev.value);
const avgOf = (pts: { y: number }[]) => pts.reduce((t, p) => t + p.y, 0) / Math.max(1, pts.length);
// show the page once its data is in, all at once
await loaded(st, prev, ach, avail);
// a tab that isn't there (Sleep in a link, after its data was deleted) falls back to Overview
// (Scores waits for its scores and Readiness, which load after the page)
watch([() => avail.data.value, () => scoresQ.data.value, () => readyQ.data.value, () => scoresQ.isFetching.value, () => readyQ.isFetching.value], () => { if (!TABS.value.some(([k]) => k === tab.value) && !(tab.value === "scores" && (scoresQ.isFetching.value || readyQ.isFetching.value))) tab.value = "overview"; }, { immediate: true });
</script>

<template>
  <div class="page">
    <div class="ph"><div><h1>Stats</h1></div>
      <div v-if="tab === 'steps'" class="acts"><AppSelect v-model="stepsView" :options="STEP_VIEWS" title="View" style="width:auto" /></div>
      <div v-else-if="tab === 'sleep'" class="acts"><AppSelect v-model="sleepView" :options="SLEEP_VIEWS" title="View" style="width:auto" /></div>
      <div v-else-if="tab === 'heart'" class="acts"><AppSelect v-model="heartView" :options="STEP_VIEWS" title="View" style="width:auto" /></div>
      <div v-else-if="tab !== 'reports' && tab !== 'scores' && tab !== 'achievements'" class="acts"><AppSelect v-model="rk" :options="PERIODS" title="Period" style="width:auto" /></div></div>
    <div class="tabs"><button v-for="[k, l] in TABS" :key="k" :class="{ on: tab === k }" @click="tab = k!">{{ l }}</button></div>
<Transition name="sw" mode="out-in"><div :key="tab">
    <div v-if="!d && st.isError.value" class="card empty"><Icon name="info" :size="34" /><b>Couldn't load your stats</b>{{ (st.error.value as Error | null)?.message }}<br /><button class="btn tonal" @click="st.refetch()">Try again</button></div>
    <div v-else-if="!d" class="empty">Loading…</div>

    <!-- nothing in this period: one message instead of a page of zeros and empty charts -->
    <div v-else-if="tab === 'overview' && !T!.workouts && !T!.activities" class="card empty"><Icon name="stats" :size="34" /><b>Nothing to show yet</b>{{ rk !== "all" ? "No workouts or activities in this period. Pick a longer one, or" : "Your numbers show here once you" }} finish a workout or log an activity.<br /><button class="btn tonal" @click="startOpen = true">Start a workout</button></div>

    <template v-else-if="tab === 'overview'">
      <div class="grid g4">
        <div class="card hero stat"><div class="lbl"><span class="bi"><Icon name="dumbbell" :size="15" /></span>Workouts</div><div class="val">{{ T!.workouts }}</div><div class="sub">{{ change("workouts") || `on ${T!.days} ${T!.days === 1 ? "day" : "days"}` }}</div><Sparkline :values="weeks.map((w) => w.workouts)" color="var(--onc)" /></div>
        <div class="card stat"><div class="lbl"><span class="bi"><Icon name="clock" :size="15" /></span>Training time</div><div class="val">{{ fmt.dur(T!.timeS, true) }}</div><div class="sub">{{ change("timeS") || "workouts and activities" }}</div><Sparkline :values="weeks.map((w) => w.timeS)" /></div>
        <div class="card stat"><div class="lbl"><span class="bi"><Icon name="layers" :size="15" /></span>Volume</div><div class="val">{{ volParts.value }}<small>{{ volParts.unit }}</small></div><div class="sub">{{ change("volumeKg") || `${T!.sets} sets` }}</div><Sparkline :values="weeks.map((w) => w.volumeKg)" /></div>
        <div class="card stat"><div class="lbl"><span class="bi"><Icon name="walk" :size="15" /></span>Activities</div><div class="val">{{ T!.activities }}</div><div class="sub nw">{{ fmt.dist(T!.distM, 1) }}</div></div>
      </div>
      <div class="grid g2 spt">
        <div class="card"><div class="lbl hgap">Workouts per week{{ wkGoal ? ` · goal ${wkGoal}` : "" }}</div><BarChart :bars="weeks.slice(-16).map((w) => ({ label: wlabel(w.week).split(' ')[0]!, full: wlabel(w.week), group: monthOf(w.week), value: w.workouts, dim: !!wkGoal && w.workouts < wkGoal }))" :goal="wkGoal ?? undefined" :height="170" /></div>
        <div class="card"><div class="lbl hgap">Days you trained · last 6 months</div>
          <div ref="heatBox" class="heatw cht" :style="{ paddingTop: TIP_ROOM + 'px', '--tipup': TIP_ROOM + 'px' }" @click.self="heatTip = null"><div class="heat" @click.self="heatTip = null" @scroll.passive="heatTip = null" @mouseleave="heatTip?.pin || (heatTip = null)"><i v-for="(c, i) in heat" :key="c.k" :role="c.future ? undefined : 'img'" :aria-label="c.future ? undefined : `${heatText(c.n)}, ${fmt.date(c.k, { weekday: 'short', day: 'numeric', month: 'short' })}`" @mouseenter="heatAt($event, i)" @click="heatAt($event, i, true)" :style="c.future ? { opacity: 0 } : c.n ? { background: `color-mix(in srgb, var(--acc) ${Math.min(100, 45 + c.n * 30)}%, var(--s2))` } : undefined" /></div>
            <div v-if="heatTip && heat[heatTip.i]" ref="heatTipEl" class="ctip" :class="{ go: heatGo }" :role="heatGo ? 'button' : undefined" :tabindex="heatGo ? 0 : undefined" :style="heatTipStyle(heatTip.x, heatTip.y, !!heatGo, !!heatTip.pin)" @pointerdown="heatGo ? $event.preventDefault() : undefined" @click.stop.prevent="openHeat" @keydown.enter.prevent="openHeat" @keydown.space.prevent="openHeat"><b>{{ heatText(heat[heatTip.i]!.n) }}</b><span class="sep">·</span><span class="ctip-r">{{ fmt.date(heat[heatTip.i]!.k, { weekday: "short", day: "numeric", month: "short" }) }}</span><Icon v-if="heatGo" name="right" :size="13" class="ctip-go" /></div></div>
          <div class="grid g2" style="margin-top: var(--cpy); gap: var(--spg)"><div><div class="tiny hgap">Workouts by weekday</div><BarChart :bars="dow" :height="90" /></div><div><div class="tiny hgap">Workouts by time of day</div><BarChart :bars="hours" :height="90" /></div></div>
        </div>
      </div>
      <div class="card spt"><div class="lbl hgap">Duration (min)</div><LineChart :points="d.workouts.map((w: any) => ({ x: new Date(w.startedAt).getTime(), y: Math.round(w.durationS / 60), id: w.id, label: w.name }))" :height="160" @pick="(id) => router.push(`/workouts/${id}`)" /></div>
    </template>

    <template v-else-if="tab === 'routines'">
      <div v-if="!d.routines.length" class="card empty"><Icon name="routines" :size="34" /><b>No routine workouts in this period</b>Workouts started from a routine are compared here.</div>
      <div class="grid g2">
        <div v-for="r in d.routines" :key="r.routineId" class="card wkc click" @click="router.push(`/routines/${r.routineId}`)">
          <div class="row hgap"><span class="dot" :style="r.color ? { background: r.color } : undefined" /><b class="grow">{{ r.name }}</b><span class="tiny">Done {{ r.times }}×</span></div>
          <div class="wstats plain">
            <div class="ws" role="group" :aria-label="`Average duration ${fmt.dur(r.avgDurationS, true)}`"><div class="wlb"><Icon name="clock" :size="14" />Average duration</div><div class="wv">{{ fmt.dur(r.avgDurationS, true) }}</div></div>
            <div class="ws" role="group" :aria-label="`Planned duration ${r.estimateS ? fmt.dur(r.estimateS, true) : 'none'}`"><div class="wlb"><Icon name="timer" :size="14" />Planned duration</div><div class="wv">{{ r.estimateS ? fmt.dur(r.estimateS, true) : "-" }}</div></div>
            <div class="ws" role="group" :aria-label="`Exercises skipped ${Math.round(r.skipRate * 100)}%`"><div class="wlb"><Icon name="skip" :size="14" />Exercises skipped</div><div class="wv">{{ Math.round(r.skipRate * 100) }}%</div></div>
          </div>
          <div class="lbl hgap csec">Volume per workout ({{ fmt.wu }})</div>
          <LineChart :points="r.trend.map((t: any) => ({ x: new Date(t.at).getTime(), y: fmt.fromKg(t.volumeKg) }))" :height="110" :fmt="(v) => fmt.num(v / 1000, 1) + 'k'" />
        </div>
      </div>
    </template>

    <template v-else-if="tab === 'exercises'">
      <SearchField v-model="exq" class="hgap" placeholder="Search exercises" />
      <FilterPanel :count="`${exList.length} exercise${exList.length === 1 ? '' : 's'}`" :active="!!exq || exSort !== 'times'" @clear="exq = ''; exSort = 'times'">
        <FilterRow :model-value="exSort" label="Order" :options="EX_ORDER" @update:model-value="(v) => (exSort = v as typeof exSort)" />
      </FilterPanel>
      <div v-if="!exList.length" class="card empty"><Icon name="dumbbell" :size="34" /><b>{{ exq ? "No exercise matches" : "No exercises done in this period" }}</b>{{ exq ? "Try another name." : "Each exercise you do shows here with its progress." }}</div>
      <div v-else class="card"><div class="list">
        <div v-for="e in exList" :key="e.exerciseId" class="li click" @click="router.push(`/exercises/${e.exerciseId}?tab=charts`)">
          <div class="grow"><div class="t">{{ e.name }} <span v-if="e.stalled" class="mchip" title="No progress in the last 4 sessions">stalled</span></div><DotLine class="s" :parts="[`Done ${e.times}×`, `last ${fmt.date(e.lastAt)}`, e.bestE1rm ? `best estimated 1RM ${fmt.wu_(e.bestE1rm)}` : ''].filter(Boolean)" /></div>
          <div class="exspark"><Sparkline v-if="e.trend.length > 1" :values="e.trend.map((t: any) => t.e1rm || t.reps)" style="width:100%;height:100%" /></div>
          <div class="r tiny exchg" :title="e.change ? `Estimated 1RM ${e.change > 0 ? '+' : ''}${Math.round(e.change * 100)}% over this period` : undefined" :class="e.change > 0.005 ? 'pos' : e.change < -0.005 ? 'neg' : ''">{{ e.change ? `${e.change > 0 ? "+" : ""}${Math.round(e.change * 100)}%` : "" }}</div>
        </div>
      </div></div>
      <template v-if="skipped.length"><div class="sh"><h2>Most skipped</h2></div><div class="card"><div class="list"><div v-for="e in skipped" :key="e.exerciseId" class="li click" @click="router.push(`/exercises/${e.exerciseId}`)"><div class="grow"><div class="t">{{ e.name }}</div></div><span class="tiny">Skipped {{ e.skipped }}×</span></div></div></div></template>
    </template>

    <template v-else-if="tab === 'muscles'">
      <div v-if="!Object.keys(d.muscles).length" class="card empty"><Icon name="activity" :size="34" /><b>No sets in this period</b>The muscles you train, and how evenly, show here once you've done some workouts.</div>
      <div v-else class="grid g2">
        <div class="card"><div class="lbl hgap">Sets per muscle in this period</div><BodyMap :values="d.muscles" :height="240" legend inspect :focus="mSel?.muscles" :focus-tier="mSel?.tier" @pick="pickMuscle" @pick-tier="pickTier" />
          <div class="grid g2 keep" style="margin-top:12px;gap:6px 28px"><div v-for="[m, n] in Object.entries(d.muscles).sort((a: any, b: any) => b[1] - a[1])" :key="m" class="row tiny mrow" :class="{ on: mSel?.muscles.includes(m) }" role="button" tabindex="0" :aria-pressed="!!mSel?.muscles.includes(m)" @click="pickMuscle(m)" @keydown.enter.space.prevent="pickMuscle(m)"><span class="grow" style="color:var(--tx)">{{ muscleName(m) }}</span>{{ Math.round(Number(n)) }}</div></div>
          <div class="tiny" style="margin-top:10px">A set counts in full for its main muscles and as half for helpers.</div></div>
        <div class="stack">
          <div class="card"><div class="lbl hgap"><span class="grow">Working sets, last 7 days · target {{ WEEKLY_SET_RANGE[0] }}-{{ WEEKLY_SET_RANGE[1] }} per muscle group</span><LearnButton topic="weeklySets" /></div><BarChart :bars="groupWeek" horizontal :band="WEEKLY_SET_RANGE" /></div>
          <div v-if="trainWeeks > 1" class="card"><div class="lbl hgap"><span class="grow">Average per training week · {{ trainWeeks }} training weeks</span><LearnButton topic="weeklySets" /></div><BarChart :bars="groupAvg" horizontal :band="WEEKLY_SET_RANGE" /></div>
          <div class="card"><div class="lbl hgap">Balance</div>
            <div class="row tiny" style="margin-bottom:6px"><span class="num" style="width:96px">Push {{ Math.round(balance.push) }}</span><div class="pbar grow"><i :style="{ width: (balance.push / Math.max(1, balance.push + balance.pull)) * 100 + '%' }" /></div><span class="num" style="width:96px;text-align:end">{{ Math.round(balance.pull) }} Pull</span></div>
            <div class="row tiny"><span class="num" style="width:96px">Upper {{ Math.round(balance.upper) }}</span><div class="pbar grow"><i :style="{ width: (balance.upper / Math.max(1, balance.upper + balance.lower)) * 100 + '%' }" /></div><span class="num" style="width:96px;text-align:end">{{ Math.round(balance.lower) }} Lower</span></div>
            <div v-if="neglected.length" class="tiny" style="margin-top:10px">Not trained in this period: {{ neglected.join(", ") }}</div></div>
        </div>
      </div>
    </template>

    <template v-else-if="tab === 'activities'">
      <div v-if="!d.activities.length && !bandDist.length && !bandKcal.length" class="card empty"><Icon name="walk" :size="34" /><b>No activities in this period</b></div>
      <div class="grid g3"><div v-for="t in actTypes" :key="t.type" class="card stat"><div class="lbl"><span class="bi"><Icon :name="activityIcon(t.type)" :size="15" /></span>{{ typeName(t.type) }}</div><div class="val"><template v-if="t.m">{{ unitOf(fmt.dist(t.m, 1)).value }}<small>{{ unitOf(fmt.dist(t.m, 1)).unit }}</small></template><template v-else>{{ fmt.dur(t.s, true) }}</template></div><div class="sub">{{ t.n }} {{ t.n === 1 ? "time" : "times" }}{{ t.m ? " · " + fmt.dur(t.s, true) : "" }}{{ t.m && t.ps ? " · average pace " + fmt.pace(t.ps, t.m) : "" }}</div></div></div>
      <div v-if="d.activities.length" class="card spt"><div class="lbl hgap">Distance per week ({{ fmt.du }})</div><BarChart :bars="actWeeks.slice(-16).map((w) => ({ ...w, label: w.label.split(' ')[0]!, full: w.label, group: monthOf(w.week) }))" :height="160" :fmt="(v) => fmt.num(v, 1)" /></div>
      <!-- the band's whole-day totals: everything the person did that day, recorded activities included -->
      <!-- the source after a dot without "from" ("· Health Connect"), so the longer title stays on one line on a 360px phone -->
      <div v-if="bandDist.length || bandKcal.length" class="spt" :class="bandDist.length && bandKcal.length ? 'grid g2' : ''">
        <div v-if="bandDist.length" class="card"><div class="lbl hgap">Distance per day ({{ fmt.du }}) · {{ totalsFrom("distance_m") }}</div><LineChart :points="bandDist" :height="bandDist.length && bandKcal.length ? 140 : 160" :fmt="(v) => fmt.num(v, 1)" /><div class="tiny" style="margin-top:6px">Average {{ fmt.num(avgOf(bandDist), 1) }} {{ fmt.du }} a day · {{ fmt.num(bandDist.reduce((t, p) => t + p.y, 0), 1) }} {{ fmt.du }} in total</div></div>
        <div v-if="bandKcal.length" class="card"><div class="lbl hgap">Active calories per day (kcal) · {{ totalsFrom("active_kcal") }}</div><LineChart :points="bandKcal" :height="bandDist.length && bandKcal.length ? 140 : 160" :fmt="(v) => fmt.num(v, 0)" /><div class="tiny" style="margin-top:6px">Average {{ fmt.num(avgOf(bandKcal), 0) }} kcal a day</div></div>
      </div>
    </template>

    <StepsTab v-else-if="tab === 'steps'" v-model:view="stepsView" :day="stepsDay" @update:day="setDay" />
    <SleepTab v-else-if="tab === 'sleep'" v-model:view="sleepView" :day="stepsDay" @update:day="setDay" />
    <HeartTab v-else-if="tab === 'heart'" v-model:view="heartView" :day="stepsDay" @update:day="setDay" />
    <ScoresTab v-else-if="tab === 'scores'" />

    <Reports v-else-if="tab === 'reports'" />

    <template v-else-if="tab === 'achievements'">
      <div v-if="!ach.data.value" class="empty">Loading…</div>
      <div v-else class="grid g2">
        <div v-for="a in ach.data.value" :key="a.id" class="card">
          <div class="row"><b class="grow">{{ a.title }}</b><span class="tiny">{{ achAmount(a.unit, a.value) }}</span></div>
          <div class="tiny" style="margin-top:2px">{{ a.desc }}</div>
          <div class="achs">
            <div v-for="x in a.steps" :key="x.id" class="ach" :class="{ on: x.reachedAt }" :title="x.reachedAt ? `Reached ${fmt.date(x.reachedAt, { day: 'numeric', month: 'short', year: 'numeric' })}` : `${achAmount(a.unit, a.value)} of ${achAmount(a.unit, x.target)}`">
              <Icon name="trophy" :size="16" /><div class="grow"><div class="t">{{ x.name }}</div><div class="s">{{ x.reachedAt ? fmt.date(x.reachedAt, { day: "numeric", month: "short", year: "numeric" }) : `${Math.floor(Math.min(1, a.value / x.target) * 100)}%` }}</div>
                <div class="pbar" :class="{ ok: x.reachedAt }"><i :style="{ width: (x.reachedAt ? 100 : Math.min(1, a.value / x.target) * 100) + '%' }" /></div></div>
            </div>
          </div>
        </div>
      </div>
    </template>
</div></Transition>
  </div>
</template>

<style scoped>
.achs { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; margin-top: 12px; }
.ach { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 10px; background: var(--s2); color: var(--tx2); opacity: .6; }
.ach.on { opacity: 1; }
.ach.on svg { color: var(--warn); }
.ach .t { font-size: 13px; font-weight: 600; color: var(--tx); }
.ach .s { font-size: 11.5px; }
.ach .pbar { margin-top: calc(var(--lpy) / 2); height: 6px; background: var(--s1); } /* tile is --s2, so the track needs a different token to show the empty part */
.mrow { cursor: pointer; border-radius: 6px; outline: none; }
.mrow.on { font-weight: 600; color: var(--tx); }
.mrow:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; }
</style>
