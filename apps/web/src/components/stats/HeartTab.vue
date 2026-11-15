<script setup lang="ts">
// Stats → Heart, there only once a band has handed over heart data: the day's resting heart rate, blood oxygen and HRV
// (each a tile with its trend, then its chart), and the heart rate during workouts and activities: how hard each one was
// over the period (the average of each, its chart, the sessions themselves), and how many of the period's have one.
// The vitals only with data in the period. Above it all the day (HeartDay: the heart rate through the day, picked with
// the Calendar's bar; its day is the link's, so a refresh or Back keeps it), then what stands out (a resting heart rate
// unusually high) and the time in heart rate zones over the period. The vitals have no tiles of their own: the day's
// tiles have the day's, and each chart's line has the latest and the trend.
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { ymd, weekStartOf, zoneMinutes, highRestingDays } from "@motus/shared";
import { api } from "../../api/client";
import { useWorkouts, useActivities, useTypeName, useSettings } from "../../api/queries";
import { mins } from "../../core/sleep";
import { ZONES, useMaxHr, hrSamples } from "../../core/heart";
import HeartDay from "./HeartDay.vue";
import BarChart from "../BarChart.vue";
import { useFmt, activityIcon } from "../../core/format";
import Icon from "../Icon.vue";
import { adviceWord, useDevice } from "../../native/health";
import LineChart from "../LineChart.vue";

// day: the day the link names, else the day card opens on the period's latest day with heart data
const props = defineProps<{ from: Date | null; to: Date | null; daily: { date: string; kind: string; value: number | string }[]; day?: string }>();
const emit = defineEmits<{ "update:day": [day: string] }>();
const router = useRouter();
const fmt = useFmt();
const dev = useDevice();
const typeName = useTypeName();
const range = computed(() => ({ ...(props.from ? { from: props.from.toISOString() } : {}), ...(props.to ? { to: props.to.toISOString() } : {}), limit: 1000 }));
const ws = useWorkouts(range);
const as = useActivities(range);

// a day's resting heart rate, blood oxygen and HRV from a band, each only when it has data in the period. Each chart has
// the same line under it as body weight: the latest, the smoothed trend and how far the trend moved over the last 7 days.
const VITALS = [{ id: "resting_hr", name: "Resting heart rate", unit: "bpm" }, { id: "spo2", name: "Blood oxygen", unit: "%" }, { id: "hrv", name: "HRV", unit: "ms" }] as const;
const vitals = computed(() => {
  const lo = props.from ? ymd(props.from) : "", hi = props.to ? ymd(props.to) : "9999";
  return VITALS.map((v) => {
    const pts = props.daily.filter((x) => x.kind === v.id && String(x.date).slice(0, 10) >= lo && String(x.date).slice(0, 10) < hi)
      .map((x) => ({ x: new Date(String(x.date).slice(0, 10) + "T12:00").getTime(), y: Number(x.value) })).sort((a, b) => a.x - b.x);
    let ema: number | null = null;
    const trend = pts.map((p) => (ema = ema == null ? p.y : ema + 0.15 * (p.y - ema)));
    // rounded before its sign is chosen, so a small move reads "+0", never "-0"; no unit, as the body weight line
    const moved = trend.length > 7 ? Math.round(trend.at(-1)! - trend.at(-8)!) : null;
    // whole numbers: "58 bpm", "97%" (a percent sits right after its number, as elsewhere in Stats), "45 ms"
    const f = (n: number) => fmt.value.num(n, 0), u = (n: number) => `${f(n)}${v.unit === "%" ? "" : "\u00a0"}${v.unit}`;
    return { ...v, pts, f,
      line: pts.length ? `Latest ${u(pts.at(-1)!.y)} · trend ${u(trend.at(-1)!)}${moved == null ? "" : moved === 0 ? " · no change over the last 7 days" : ` · ${moved > 0 ? "+" : "-"}${u(Math.abs(moved))} over the last 7 days`}` : "" };
  }).filter((v) => v.pts.length);
});

// workouts and activities with a heart rate, oldest first. A session only has one when a band was worn while it was
// recorded and has synced since (or Health Connect handed it over), so often few of the period's sessions do: the
// section says how many, and shows the chart only from three on (one or two points draw no trend)
const sessions = computed(() => [
  ...((ws.data.value ?? []) as any[]).filter((w) => w.avgHr).map((w) => ({ key: `w${w.id}`, path: `/workouts/${w.id}`, icon: "dumbbell", name: w.name || "Workout", at: w.startedAt as string, durationS: Number(w.durationS), avg: Number(w.avgHr), max: w.maxHr ? Number(w.maxHr) : null })),
  ...((as.data.value ?? []) as any[]).filter((a) => a.avgHr).map((a) => ({ key: `a${a.id}`, path: `/activities/${a.id}`, icon: activityIcon(a.type), name: a.name || typeName(a.type), at: a.startedAt as string, durationS: Number(a.durationS), avg: Number(a.avgHr), max: a.maxHr ? Number(a.maxHr) : null })),
].sort((a, b) => a.at.localeCompare(b.at)));
// every workout and activity in the period, with a heart rate or not
const total = computed(() => ((ws.data.value ?? []) as any[]).length + ((as.data.value ?? []) as any[]).length);
const top = computed(() => sessions.value.filter((x) => x.max != null).reduce<(typeof sessions.value)[number] | null>((m, x) => (!m || x.max! > m.max! ? x : m), null));
// newest first: ten of them, then all on request (as Stats → Sleep's nights)
const showAll = ref(false);
const newest = computed(() => { const all = [...sessions.value].reverse(); return showAll.value ? all : all.slice(0, 10); });
// the sessions' heart rates come in after Stats' own data: nothing until they're in, so the tiles don't jump
const loading = computed(() => ws.isLoading.value || as.isLoading.value || hist.isLoading.value || recDays.isLoading.value);
const open = (key: string) => { const x = sessions.value.find((s) => s.key === key); if (x) router.push(x.path); };

const settings = useSettings();
const maxHr = useMaxHr();
// the vitals from 28 days before the period on, so a day early in it still has its usual resting heart rate
const histFrom = computed(() => (props.from ? ymd(new Date(props.from.getTime() - 28 * 86400000)) : "2000-01-01"));
// as useDaily (Home's Today's log), with the day it starts from following the period
const hist = useQuery({ queryKey: computed(() => ["activities", "daily", histFrom.value]), queryFn: () => api.get<{ date: string; kind: string; value: number | string }[]>("/daily", { from: histFrom.value, tz: new Date().getTimezoneOffset() }) });
const resting = computed(() => ((hist.data.value ?? []) as { date: string; kind: string; value: number | string }[])
  .filter((x) => x.kind === "resting_hr").map((x) => ({ date: String(x.date).slice(0, 10), value: Number(x.value) })));
// the days that have saved heart rate records (every day, not only the period's)
const recDays = useQuery({ queryKey: ["health", "records", "days"], queryFn: () => api.get<{ days: { date: string; types: Record<string, number> }[] }>("/health/records/days") });
const today = ymd(new Date());
// the days the day card steps through: with saved heart rate, a resting heart rate, HRV or blood oxygen, or a session with a heart rate
const heartDays = computed(() => [...new Set([
  ...(recDays.data.value?.days ?? []).filter((d) => d.types.heart_rate).map((d) => d.date),
  ...((hist.data.value ?? []) as { date: string; kind: string }[]).filter((x) => ["resting_hr", "hrv", "spo2"].includes(x.kind)).map((x) => String(x.date).slice(0, 10)),
  ...sessions.value.map((x) => ymd(new Date(x.at))),
])].filter((d) => d <= today).sort());
// it opens on the period's latest day with heart data; none in the period, no day card (as Sleep's last night)
const startDay = computed(() => {
  const lo = props.from ? ymd(props.from) : "", hi = props.to ? ymd(props.to) : "9999";
  const inP = heartDays.value.filter((d) => d >= lo && d < hi);
  return inP.at(-1) ?? "";
});
const today0 = ymd(new Date());
const day = ref(props.day && props.day <= today0 ? props.day : "");
watch(startDay, (d) => { if (!day.value && d) day.value = d; }, { immediate: true });
watch(() => props.day, (d) => { if (d && d <= today0) day.value = d; });
watch(day, (d) => { if (d && d !== props.day) emit("update:day", d); });

// what stands out: days in the period whose resting heart rate was well above your usual (a sign of fatigue or a cold coming on)
const highs = computed(() => { const lo = props.from ? ymd(props.from) : "", hi = props.to ? ymd(props.to) : "9999"; return highRestingDays(resting.value).filter((d) => d.date >= lo && d.date < hi); });
const insights = computed(() => {
  const h = highs.value, last = h.at(-1);
  if (!last) return [];
  const on = fmt.value.date(last.date, { weekday: "short", day: "numeric", month: "short" });
  return [{ icon: "heartPulse", t: h.length === 1 ? `Resting heart rate high on ${on}` : `Resting heart rate high on ${h.length} days`,
    s: `${h.length === 1 ? "" : `latest ${on} · `}${fmt.value.num(last.value, 0)} bpm, usual ${last.usual}`,
    rv: `+${Math.round(last.value - last.usual)} bpm` }];
});

// the time in heart rate zones over the period, from the saved samples: a bar a day, or a week over two months; a longer
// period than three months covers only its last three (more samples than a screen should load at once)
const ZONE_SPAN = 92 * 86400000;
const zSpan = computed(() => {
  const end = props.to ?? new Date(), first = heartDays.value[0] ? new Date(heartDays.value[0] + "T00:00") : end;
  const start = new Date(Math.max(props.from?.getTime() ?? first.getTime(), first.getTime(), end.getTime() - ZONE_SPAN));
  return { start, end, cut: (props.from?.getTime() ?? 0) < end.getTime() - ZONE_SPAN && first.getTime() < end.getTime() - ZONE_SPAN };
});
const zq = useQuery({ queryKey: computed(() => ["health", "records", "heart_rate", "span", zSpan.value.start.toISOString(), zSpan.value.end.toISOString()]),
  queryFn: () => hrSamples(zSpan.value.start, zSpan.value.end), enabled: computed(() => !!maxHr.value && zSpan.value.end > zSpan.value.start && !!recDays.data.value?.days.some((d) => d.types.heart_rate)) });
const zDays = computed(() => maxHr.value && zq.data.value?.length ? [...zoneMinutes(zq.data.value, maxHr.value.bpm, (t) => ymd(new Date(t * 1000)))].sort((a, b) => a[0].localeCompare(b[0])) : []);
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
const zHard = computed(() => zDays.value.reduce((t, [, m]) => t + m[2]! + m[3]! + m[4]!, 0));
</script>

<template>
  <div v-if="loading" class="empty">Loading…</div>
  <div v-else-if="!vitals.length && !sessions.length && !day" class="card empty"><Icon name="heart" :size="34" /><b>No heart data in this period</b>Pick a longer period, or wear your {{ adviceWord(dev) }} through the day and during workouts.</div>
  <template v-else>
    <HeartDay v-if="day" v-model:day="day" :resting="resting" />

    <!-- as Stats → Sleep's -->
    <div v-if="insights.length" class="card wkc spt">
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
    <div v-if="vitals.length" class="grid g2 spt"><div v-for="v in vitals" :key="v.id" class="card"><div class="lbl hgap">{{ v.name }} ({{ v.unit }})</div>
      <LineChart :points="v.pts" :height="140" :fmt="v.f" /><div class="tiny ht-line">{{ v.line }}</div></div></div>

    <div v-if="zBars.length" class="card spt">
      <div class="lbl hgap">Time in heart rate zones{{ zPerWeek ? ", by week" : "" }} · max {{ maxHr!.bpm }} bpm{{ maxHr!.own ? "" : " from your age" }}</div>
      <BarChart :bars="zBars" :height="170" :fmt="(v) => mins(v)" />
      <div class="bmlegend ht-leg"><span v-for="z in ZONES" :key="z.key"><i :style="{ background: z.color }" />{{ z.name }}</span></div>
      <div class="tiny ht-line">{{ mins(zHard) }} moderate or harder{{ zSpan.cut ? " in the last 3 months" : "" }}.</div>
    </div>

    <!-- how hard each workout and activity was, over the period: its average heart rate -->
    <div class="sh"><h2>Heart rate in workouts</h2><span v-if="sessions.length" class="tiny">{{ sessions.length }}</span></div>
    <template v-if="sessions.length">
      <p class="tiny">How hard each workout and activity was: its average and highest heart rate.{{ total > sessions.length ? ` ${total - sessions.length} more in this period have none: wear your ${adviceWord(dev)} while you record to add it.` : "" }}</p>
      <div v-if="sessions.length > 2" class="card"><div class="lbl hgap">Average per session (bpm)</div>
        <LineChart :points="sessions.map((x) => ({ x: new Date(x.at).getTime(), y: x.avg, id: x.key, label: x.name }))" :height="160" :fmt="(v) => fmt.num(v, 0)" @pick="open" />
        <div v-if="top" class="tiny ht-line">Highest {{ top.max }} bpm in {{ top.name }} on {{ fmt.date(top.at) }}</div></div>
      <div class="card" :class="{ spt: sessions.length > 2 }"><div class="list">
        <div v-for="x in newest" :key="x.key" class="li click" role="button" tabindex="0" @click="router.push(x.path)" @keydown.enter="router.push(x.path)">
          <span class="bi sg"><Icon :name="x.icon" :size="16" /></span>
          <div class="grow"><div class="t">{{ x.name }}</div><div class="s">{{ fmt.date(x.at, { weekday: "short", day: "numeric", month: "short" }) }} · {{ fmt.dur(x.durationS, true) }}</div></div>
          <!-- the average, and the highest under it: on the left with the date and time it wrapped on a phone -->
          <div class="r"><b class="num">{{ x.avg }} bpm</b><div v-if="x.max" class="s">highest {{ x.max }} bpm</div></div>
        </div>
      </div></div>
      <div v-if="sessions.length > 10 && !showAll" class="center spt"><button class="qb" @click="showAll = true">Show all {{ sessions.length }} sessions</button></div>
    </template>
    <div v-else-if="total" class="card empty"><Icon name="heart" :size="34" /><b>No heart rate in workouts yet</b>Workouts and activities you record while wearing your {{ adviceWord(dev) }} show their heart rate here once it has synced.</div>
    <div v-else class="card empty"><Icon name="heart" :size="34" /><b>No workouts in this period</b>Pick a longer period, or record one while wearing your {{ adviceWord(dev) }}.</div>
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
