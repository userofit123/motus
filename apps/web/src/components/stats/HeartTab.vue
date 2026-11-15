<script setup lang="ts">
// Stats → Heart (M-242), there only once a band has handed over heart data. A Day/Week/Month/Year view as Steps and
// Sleep, moved with the Calendar's bar. Day: the day card (HeartDay: the heart rate through the day, its numbers, zones
// and sessions; its day is the link's, so a refresh or Back keeps it). Week, month, year: what stands out (a resting
// heart rate unusually high), the day's resting heart rate, blood oxygen and HRV over the stretch (each a chart whose
// line starts with the trend), the time in heart rate zones, and the heart rate during workouts and activities: how hard
// each one was (the average of each, its chart, the sessions themselves), and how many of the stretch's have one.
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { ymd, weekStartOf, zoneMinutes, highRestingDays } from "@motus/shared";
import { api } from "../../api/client";
import { useWorkouts, useActivities, useTypeName, useSettings } from "../../api/queries";
import { mins } from "../../core/sleep";
import { ZONES, useMaxHr, hrSamples } from "../../core/heart";
import HeartDay from "./HeartDay.vue";
import DayNav from "./DayNav.vue";
import DaySessionList from "./DaySessionList.vue";
import BarChart from "../BarChart.vue";
import { useFmt, activityIcon } from "../../core/format";
import Icon from "../Icon.vue";
import { adviceWord, useDevice } from "../../native/health";
import LineChart from "../LineChart.vue";
import Sparkline from "../Sparkline.vue";
import { useToday, stretchOf, stepDay, stretchTitle, WORKOUT_COLOR, ACTIVITY_COLOR, type StretchView, type DaySession } from "./daySessions";

export type HeartView = StretchView;
const view = defineModel<HeartView>("view", { required: true });
const props = defineProps<{ day?: string }>();
const emit = defineEmits<{ "update:day": [day: string] }>();
const router = useRouter();
const fmt = useFmt();
const dev = useDevice();
const typeName = useTypeName();
const settings = useSettings();
const maxHr = useMaxHr();

// the shown day, and the week, month or year around it in the other views, so the day never drifts outside them
const today = useToday();
const anchor = ref(props.day && props.day <= today.value ? props.day : today.value);
// opened again from elsewhere (Home, the calendar) with a day while this tab is still around
watch(() => props.day, (d) => { if (d && d <= today.value && d !== anchor.value) { anchor.value = d; view.value = "day"; } });
// the shown day into the link, so a refresh or Back opens it again
watch([anchor, view], ([d, v]) => { if (v === "day" && d !== props.day) emit("update:day", d); });
const isDay = computed(() => view.value === "day");
const range = computed(() => stretchOf(view.value, anchor.value, settings.value.firstDay));
const hasToday = computed(() => range.value.from <= today.value && today.value < range.value.to);
const shift = (n: number) => { anchor.value = stepDay(view.value, anchor.value, n, today.value); };
const title = computed(() => stretchTitle(view.value, range.value, today.value, fmt.value));
const from = computed(() => new Date(range.value.from + "T00:00")), to = computed(() => new Date(range.value.to + "T00:00"));
const inRange = (d: string) => d >= range.value.from && d < range.value.to;

const params = computed(() => ({ from: from.value.toISOString(), to: to.value.toISOString(), limit: 1000 }));
const ws = useWorkouts(params, { keep: true });
const as = useActivities(params, { keep: true });
// the vitals from 28 days before the stretch on (a day early in it still has its usual resting heart rate), under the key
// Home's daily log uses, so live updates reload it
type Daily = { date: string; kind: string; value: number | string };
const histFrom = computed(() => ymd(new Date(from.value.getTime() - 28 * 86400000)));
const hist = useQuery({ queryKey: computed(() => ["activities", "daily", histFrom.value]), queryFn: () => api.get<Daily[]>("/daily", { from: histFrom.value, tz: new Date().getTimezoneOffset() }) });
const daily = computed(() => (hist.data.value ?? []).map((x) => ({ ...x, date: String(x.date).slice(0, 10) })));
const resting = computed(() => daily.value.filter((x) => x.kind === "resting_hr").map((x) => ({ date: x.date, value: Number(x.value) })));

// a day's resting heart rate, blood oxygen and HRV from a band, each only when it has data in the stretch. Each chart's
// line starts with the smoothed trend and how far it moved over the last 7 days, then the latest
const VITALS = [{ id: "resting_hr", name: "Resting heart rate", unit: "bpm" }, { id: "spo2", name: "Blood oxygen", unit: "%" }, { id: "hrv", name: "HRV", unit: "ms" }] as const;
const vitals = computed(() => VITALS.map((v) => {
  const pts = daily.value.filter((x) => x.kind === v.id && inRange(x.date)).map((x) => ({ x: new Date(x.date + "T12:00").getTime(), y: Number(x.value), id: x.date })).sort((a, b) => a.x - b.x);
  let ema: number | null = null;
  const trend = pts.map((p) => (ema = ema == null ? p.y : ema + 0.15 * (p.y - ema)));
  // rounded before its sign is chosen, so a small move reads "+0", never "-0"
  const moved = trend.length > 7 ? Math.round(trend.at(-1)! - trend.at(-8)!) : null;
  // whole numbers: "58 bpm", "97%" (a percent sits right after its number, as elsewhere in Stats), "45 ms"
  const f = (n: number) => fmt.value.num(n, 0), u = (n: number) => `${f(n)}${v.unit === "%" ? "" : "\u00a0"}${v.unit}`;
  return { ...v, pts, f,
    line: pts.length ? `Trend ${u(trend.at(-1)!)}${moved == null ? "" : moved === 0 ? " · no change over the last 7 days" : ` · ${moved > 0 ? "+" : "-"}${u(Math.abs(moved))} over the last 7 days`} · latest ${u(pts.at(-1)!.y)}` : "" };
}).filter((v) => v.pts.length));

// workouts and activities with a heart rate, oldest first, as the day card's rows. A session only has one when a band was
// worn while it was recorded and has synced since (or Health Connect handed it over), so often few of the stretch's do:
// the section says how many, and shows the chart only from three on (one or two points draw no trend)
type Row = { id: string | number; name?: string | null; type?: string; color?: string | null; startedAt: string; durationS?: number | string | null; avgHr?: number | string | null; maxHr?: number | string | null };
const wRows = computed(() => (ws.data.value ?? []) as Row[]), aRows = computed(() => (as.data.value ?? []) as Row[]);
const toSession = (x: Row, kind: "workout" | "activity"): DaySession => {
  const a = new Date(x.startedAt).getTime(), d = Number(x.durationS) || 0;
  return { key: `/${kind === "workout" ? "workouts" : "activities"}/${x.id}`, kind, icon: kind === "workout" ? "dumbbell" : activityIcon(x.type ?? ""),
    name: x.name || (kind === "workout" ? "Workout" : typeName(x.type ?? "")), color: kind === "workout" ? x.color ?? WORKOUT_COLOR : ACTIVITY_COLOR,
    kindName: kind === "workout" ? "Workout" : typeName(x.type ?? ""), a, b: a + d * 1000, durationS: d,
    avgHr: Number(x.avgHr) || null, maxHr: Number(x.maxHr) || null, steps: null };
};
const sessions = computed(() => [...wRows.value.filter((w) => Number(w.avgHr) > 0).map((w) => toSession(w, "workout")), ...aRows.value.filter((x) => Number(x.avgHr) > 0).map((x) => toSession(x, "activity"))].sort((x, y) => x.a - y.a));
// every workout and activity in the stretch, with a heart rate or not
const total = computed(() => wRows.value.length + aRows.value.length);
// newest first: ten of them, then all on request
const showAll = ref(false);
const newest = computed(() => { const all = [...sessions.value].reverse(); return showAll.value ? all : all.slice(0, 10); });
// the days that have saved heart rate records (every day, not only the stretch's)
const recDays = useQuery({ queryKey: ["readings", "days"], queryFn: () => api.get<{ days: { date: string; types: Record<string, number> }[] }>("/health/records/days") });
// the sessions' heart rates come in after Stats' own data: nothing until they're in, so the tiles don't jump
const loading = computed(() => !isDay.value && (ws.isLoading.value || as.isLoading.value || hist.isLoading.value || recDays.isLoading.value));
const failed = computed(() => !isDay.value && (ws.isError.value || as.isError.value || hist.isError.value));
const retry = () => { ws.refetch(); as.refetch(); hist.refetch(); };

// what stands out: days in the period whose resting heart rate was well above your usual (a sign of fatigue or a cold coming on)
const highs = computed(() => highRestingDays(resting.value).filter((d) => inRange(d.date)));
const insights = computed(() => {
  const h = highs.value, last = h.at(-1);
  if (!last) return [];
  const on = fmt.value.date(last.date, { weekday: "short", day: "numeric", month: "short" });
  return [{ icon: "heartPulse", t: h.length === 1 ? `Resting heart rate high on ${on}` : `Resting heart rate high on ${h.length} days`,
    s: `${h.length === 1 ? "" : `latest ${on} · `}${fmt.value.num(last.value, 0)} bpm, usual ${last.usual}`,
    rv: `+${Math.round(last.value - last.usual)} bpm` }];
});

// the time in heart rate zones over the stretch, from the saved samples: a bar a day, or a week over two months; a year
// covers only its last three months with records (more samples than a screen should load at once)
const ZONE_SPAN = 92 * 86400000;
const hrDays = computed(() => (recDays.data.value?.days ?? []).filter((d) => d.types.heart_rate && inRange(d.date)).map((d) => d.date).sort());
const zSpan = computed(() => {
  const lastDay = hrDays.value.at(-1), firstDay = hrDays.value[0];
  const end = lastDay ? new Date(Math.min(to.value.getTime(), new Date(lastDay + "T00:00").getTime() + 86400000)) : to.value;
  const first = firstDay ? new Date(firstDay + "T00:00") : end;
  const start = new Date(Math.max(first.getTime(), end.getTime() - ZONE_SPAN));
  return { start, end, cut: first.getTime() < end.getTime() - ZONE_SPAN };
});
const zq = useQuery({ queryKey: computed(() => ["readings", "zones", zSpan.value.start.toISOString(), zSpan.value.end.toISOString()]),
  queryFn: () => hrSamples(zSpan.value.start, zSpan.value.end), enabled: computed(() => !isDay.value && !!maxHr.value && zSpan.value.end > zSpan.value.start && hrDays.value.length > 0) });
const zDays = computed(() => maxHr.value && hrDays.value.length && zq.data.value?.length ? [...zoneMinutes(zq.data.value, maxHr.value.bpm, (t) => ymd(new Date(t * 1000)))].sort((a, b) => a[0].localeCompare(b[0])) : []);
const zPerWeek = computed(() => zSpan.value.end.getTime() - zSpan.value.start.getTime() > 62 * 86400000);
const zBars = computed(() => {
  const month = (d: string) => fmt.value.date(d, { month: "short" });
  const rows = new Map<string, number[]>();
  for (const [d, m] of zDays.value) { const k = zPerWeek.value ? weekStartOf(new Date(d + "T12:00"), settings.value.firstDay) : d; const r = rows.get(k) ?? rows.set(k, ZONES.map(() => 0)).get(k)!; m.forEach((v, i) => (r[i]! += v)); }
  return [...rows].map(([k, m]) => { const full = fmt.value.date(k, { day: "numeric", month: "short" });
    return { label: full.split(" ")[0]!, full, group: month(k), tip: zPerWeek.value ? `week of ${full}` : fmt.value.date(k, { weekday: "short", day: "numeric", month: "short" }),
      value: m.reduce((t, v) => t + v, 0), parts: m.map((v, i) => ({ value: v, color: ZONES[i]!.color })) }; });
});
// moderate or harder (zones 3 to 5): the minutes most activity advice counts
// the charts open what was tapped, as Steps' and Sleep's: a vitals point or a zones bar its day, a zones bar by week its week
const openDay = (d: string) => { anchor.value = d; view.value = "day"; };
const openZone = (k: string) => { anchor.value = k; view.value = zPerWeek.value ? "week" : "day"; };
const zHard = computed(() => zDays.value.reduce((t, [, m]) => t + m[2]! + m[3]! + m[4]!, 0));

// the stretch's numbers on top, as Steps' and Sleep's tiles, each only with data: the average resting heart rate (the
// first, with its days' line), the average HRV, the moderate-or-harder minutes a week (a stretch shorter than a week
// counts as one), and the days with any heart data of the stretch's days so far. The charts' captions below say other
// numbers (the trend, the latest), so none is said twice
type HTile = { key: string; icon: string; label: string; value: string; unit: string; sub: string; spark?: number[] };
const avgOf = (id: string) => { const xs = vitals.value.find((v) => v.id === id)?.pts ?? []; return xs.length ? { n: xs.length, v: xs.reduce((t, p) => t + p.y, 0) / xs.length, ys: xs.map((p) => p.y) } : null; };
const nDays = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
const tiles = computed(() => {
  const out: HTile[] = [];
  const r = avgOf("resting_hr");
  if (r) out.push({ key: "rest", icon: "heartPulse", label: "Resting heart rate", value: fmt.value.num(r.v, 0), unit: "bpm", sub: `average of ${nDays(r.n)}`, spark: r.ys.length > 1 ? r.ys : undefined });
  const h = avgOf("hrv");
  if (h) out.push({ key: "hrv", icon: "wave", label: "HRV", value: fmt.value.num(h.v, 0), unit: "ms", sub: `average of ${nDays(h.n)}` });
  if (zBars.value.length) {
    const weeks = Math.max(1, (zSpan.value.end.getTime() - zSpan.value.start.getTime()) / (7 * 86400000));
    out.push({ key: "zone", icon: "bolt", label: "Zone minutes", value: mins(zHard.value / weeks), unit: "", sub: `moderate or harder a week${zSpan.value.cut ? " · last 3 months" : ""}` });
  }
  const seen = new Set([...hrDays.value, ...daily.value.filter((x) => (x.kind === "resting_hr" || x.kind === "spo2" || x.kind === "hrv") && inRange(x.date)).map((x) => x.date)]);
  const end = range.value.to <= today.value ? range.value.to : ymd(new Date(new Date(today.value + "T12:00").getTime() + 86400000));
  const sofar = Math.max(1, Math.round((new Date(end + "T12:00").getTime() - new Date(range.value.from + "T12:00").getTime()) / 86400000));
  if (seen.size) out.push({ key: "days", icon: "calendar", label: "Days with data", value: String(seen.size), unit: seen.size === 1 ? "day" : "days", sub: `of ${sofar}${hasToday.value ? " so far" : ""}` });
  return out;
});
</script>

<template>
  <HeartDay v-if="isDay" v-model:day="anchor" :resting="resting" />
  <template v-else>
    <DayNav :title="title" :unit="view" :at-end="hasToday" :away="!hasToday" @step="shift" @today="anchor = today" />
    <div v-if="failed" class="card empty"><Icon name="info" :size="34" /><b>Couldn't load your heart data</b>{{ ((ws.error.value ?? as.error.value ?? hist.error.value) as Error | null)?.message }}<br /><button class="btn tonal" @click="retry">Try again</button></div>
    <div v-else-if="loading" class="empty">Loading…</div>
    <div v-else-if="!vitals.length && !sessions.length && !zBars.length" class="card empty"><Icon name="heart" :size="34" /><b>No heart data in this {{ view }}</b>Pick another {{ view }} with the arrows.</div>
    <template v-else>
      <!-- the stretch's numbers, as Steps' and Sleep's tiles -->
      <div v-if="tiles.length" class="grid g4" :class="tiles.length < 4 ? `n${tiles.length}` : ''">
        <div v-for="(x, i) in tiles" :key="x.key" class="card stat" :class="{ hero: i === 0 }"><div class="lbl"><span class="bi"><Icon :name="x.icon" :size="15" /></span>{{ x.label }}</div>
          <div class="val">{{ x.value }}<small v-if="x.unit">{{ x.unit }}</small></div><div class="sub">{{ x.sub }}</div><Sparkline v-if="i === 0 && x.spark" :values="x.spark" color="var(--onc)" /></div>
      </div>

      <!-- as Stats → Sleep's -->
      <div v-if="insights.length" class="card wkc" :class="{ spt: tiles.length }">
        <div class="ch"><span class="bi"><Icon name="sparkle" :size="15" /></span><span class="t grow">What stands out</span></div>
        <div class="list ht-ins">
          <div v-for="(x, i) in insights" :key="i" class="li">
            <Icon :name="x.icon" :size="18" class="neg" />
            <div class="grow"><div class="t">{{ x.t }}</div><div class="s">{{ x.s }}</div></div>
            <b class="r rv neg">{{ x.rv }}</b>
          </div>
        </div>
        <div class="tiny ht-line">A high resting heart rate can follow a hard day, a short night or a cold coming on.</div>
      </div>

      <!-- each a card as the body measurements' -->
      <div v-if="vitals.length" class="grid g2" :class="{ spt: tiles.length || insights.length }"><div v-for="(v, i) in vitals" :key="v.id" class="card"><div class="lbl hgap">{{ v.name }} ({{ v.unit }})</div>
        <LineChart :points="v.pts" :height="140" :fmt="v.f" @pick="openDay" /><div class="tiny ht-line">{{ v.line }}{{ !zBars.length && i === 0 ? " Tap a day to open it." : "" }}</div></div></div>

      <div v-if="zBars.length" class="card" :class="{ spt: tiles.length || insights.length || vitals.length }">
        <div class="lbl hgap">Time in heart rate zones{{ zPerWeek ? ", by week" : "" }} · max {{ maxHr!.bpm }} bpm{{ maxHr!.own ? "" : " from your age" }}</div>
        <BarChart :bars="zBars" :height="170" :fmt="(v) => mins(v)" @pick="openZone" />
        <div class="bmlegend ht-leg"><span v-for="z in ZONES" :key="z.key"><i :style="{ background: z.color }" />{{ z.name }}</span></div>
        <div class="tiny ht-line">{{ zPerWeek ? "Tap a week to open it." : "Tap a day to open it." }}</div>
      </div>

      <!-- how hard each workout and activity was, over the stretch: its average and highest heart rate, as Stats → Sleep's
           "Sleep after workouts"; nothing at all when the stretch has no workouts -->
      <div v-if="total" class="card wkc" :class="{ spt: tiles.length || insights.length || vitals.length || zBars.length }">
        <div class="ch"><span class="bi"><Icon name="dumbbell" :size="15" /></span><span class="t grow">Heart rate in workouts</span><span v-if="sessions.length" class="tiny">{{ sessions.length }}</span></div>
        <template v-if="sessions.length">
          <template v-if="sessions.length > 2"><div class="lbl hgap">Average per session (bpm)</div>
            <LineChart :points="sessions.map((x) => ({ x: x.a, y: x.avgHr!, id: x.key, label: x.name }))" :height="160" :fmt="(v) => fmt.num(v, 0)" @pick="(id) => router.push(id)" /></template>
          <div :class="{ csec: sessions.length > 2 }"><DaySessionList :sessions="newest" dated :value="(x) => `${Math.round(x.avgHr!)} bpm`" :sub="(x) => (x.maxHr != null ? `highest ${Math.round(x.maxHr)} bpm` : '')" /></div>
          <div class="tiny ht-line">How hard each workout and activity was: its average and highest heart rate.{{ total > sessions.length ? ` ${total - sessions.length} more in this ${view} have none: wear your ${adviceWord(dev)} while you record to add it.` : "" }}</div>
        </template>
        <div v-else class="tiny">None of this {{ view }}'s workouts and activities has a heart rate yet. Record them while wearing your {{ adviceWord(dev) }} and they show it here once it has synced.</div>
      </div>
      <div v-if="sessions.length > 10 && !showAll" class="center spt"><button class="qb" @click="showAll = true">Show all {{ sessions.length }} sessions</button></div>
    </template>
  </template>
</template>

<style scoped>
.ht-line { margin-top: var(--tdy); }
.ht-leg { margin-top: var(--hg); }
/* the highlights as Stats → Sleep's: the last row without its line, the number in the row's tone */
.ht-ins .li:last-child { border-bottom: 0; padding-bottom: 0; }
.ht-ins .li:first-child { padding-top: 0; }
.ht-ins .grow { min-width: 0; }
.rv { font-variant-numeric: tabular-nums; white-space: nowrap; }
</style>
