<script setup lang="ts">
// Stats → Heart, there only once a band has handed over heart data: the day's resting heart rate, blood oxygen and HRV
// (each a tile with its trend, then its chart), and the heart rate during workouts and activities: how hard each one was
// over the period (the average of each, its chart, the sessions themselves), and how many of the period's have one.
// The vitals only with data in the period.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { ymd } from "@motus/shared";
import { useWorkouts, useActivities, useActivityTypes } from "../../api/queries";
import { useFmt, activityIcon } from "../../core/format";
import Icon from "../Icon.vue";
import LineChart from "../LineChart.vue";
import Sparkline from "../Sparkline.vue";

const props = defineProps<{ from: Date | null; to: Date | null; daily: { date: string; kind: string; value: number | string }[] }>();
const router = useRouter();
const fmt = useFmt();
const types = useActivityTypes();
const range = computed(() => ({ ...(props.from ? { from: props.from.toISOString() } : {}), ...(props.to ? { to: props.to.toISOString() } : {}), limit: 1000 }));
const ws = useWorkouts(range);
const as = useActivities(range);

// a day's resting heart rate, blood oxygen and HRV from a band, each only when it has data in the period. Each chart has
// the same line under it as body weight: the latest, the smoothed trend and how far the trend moved over the last 7 entries.
const VITALS = [{ id: "resting_hr", name: "Resting heart rate", short: "Resting", icon: "heart", unit: "bpm" }, { id: "spo2", name: "Blood oxygen", short: "Blood oxygen", icon: "water", unit: "%" }, { id: "hrv", name: "HRV", short: "HRV", icon: "heartPulse", unit: "ms" }] as const;
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
    const f = (n: number) => fmt.value.num(n, 0), u = (n: number) => `${f(n)}${v.unit === "%" ? "" : " "}${v.unit}`;
    const mean = pts.length ? pts.reduce((t, p) => t + p.y, 0) / pts.length : 0;
    return { ...v, pts, f, latest: pts.at(-1)?.y ?? 0, avg: u(mean),
      line: pts.length ? `Latest ${u(pts.at(-1)!.y)} · trend ${u(trend.at(-1)!)}${moved != null ? ` · ${moved >= 0 ? "+" : "-"}${f(Math.abs(moved))} over the last 7 entries` : ""}` : "" };
  }).filter((v) => v.pts.length);
});

// workouts and activities with a heart rate, oldest first. A session only has one when a band was worn while it was
// recorded and has synced since (or Health Connect handed it over), so often few of the period's sessions do: the
// section says how many, and shows the chart only from three on (one or two points draw no trend)
const typeName = (slug: string) => (types.data.value ?? []).find((t: any) => t.slug === slug)?.name ?? slug[0]!.toUpperCase() + slug.slice(1);
const sessions = computed(() => [
  ...((ws.data.value ?? []) as any[]).filter((w) => w.avgHr).map((w) => ({ key: `w${w.id}`, path: `/workouts/${w.id}`, icon: "dumbbell", name: w.name || "Workout", at: w.startedAt as string, durationS: Number(w.durationS), avg: Number(w.avgHr), max: w.maxHr ? Number(w.maxHr) : null })),
  ...((as.data.value ?? []) as any[]).filter((a) => a.avgHr).map((a) => ({ key: `a${a.id}`, path: `/activities/${a.id}`, icon: activityIcon(a.type), name: a.name || typeName(a.type), at: a.startedAt as string, durationS: Number(a.durationS), avg: Number(a.avgHr), max: a.maxHr ? Number(a.maxHr) : null })),
].sort((a, b) => a.at.localeCompare(b.at)));
// every workout and activity in the period, with a heart rate or not
const total = computed(() => ((ws.data.value ?? []) as any[]).length + ((as.data.value ?? []) as any[]).length);
const sAvg = computed(() => sessions.value.length ? Math.round(sessions.value.reduce((t, x) => t + x.avg, 0) / sessions.value.length) : 0);
const top = computed(() => sessions.value.filter((x) => x.max != null).reduce<(typeof sessions.value)[number] | null>((m, x) => (!m || x.max! > m.max! ? x : m), null));
// newest first: ten of them, then all on request (as Stats → Sleep's nights)
const showAll = ref(false);
const newest = computed(() => { const all = [...sessions.value].reverse(); return showAll.value ? all : all.slice(0, 10); });
// the sessions' heart rates come in after Stats' own data: nothing until they're in, so the tiles don't jump
const loading = computed(() => ws.isLoading.value || as.isLoading.value);
const open = (key: string) => { const x = sessions.value.find((s) => s.key === key); if (x) router.push(x.path); };
// as many tiles as there is data for, as Overview's (four across on a computer, two on the phone)
const tiles = computed(() => vitals.value.length + (sessions.value.length ? 1 : 0));
</script>

<template>
  <div v-if="loading" class="empty">Loading…</div>
  <div v-else-if="!vitals.length && !sessions.length" class="card empty"><Icon name="heart" :size="34" /><b>No heart data in this period</b>Pick a longer period, or wear your band through the day and during workouts.</div>
  <template v-else>
    <div class="grid g4" :class="tiles < 4 ? `n${tiles}` : ''">
      <div v-for="(v, i) in vitals" :key="v.id" class="card stat" :class="{ hero: i === 0 }"><div class="lbl"><span class="bi"><Icon :name="v.icon" :size="15" /></span>{{ v.short }}</div>
        <div class="val">{{ v.f(v.latest) }}<small>{{ v.unit }}</small></div><div class="sub">average {{ v.avg }}</div><Sparkline v-if="v.pts.length > 1" :values="v.pts.map((p) => p.y)" :color="i === 0 ? 'var(--onc)' : undefined" /></div>
      <div v-if="sessions.length" class="card stat" :class="{ hero: !vitals.length }"><div class="lbl"><span class="bi"><Icon name="dumbbell" :size="15" /></span>Exercise</div>
        <div class="val">{{ sAvg }}<small>bpm</small></div><div class="sub">{{ sessions.length }} {{ sessions.length === 1 ? "session" : "sessions" }}</div><Sparkline v-if="sessions.length > 2" :values="sessions.map((x) => x.avg)" :color="!vitals.length ? 'var(--onc)' : undefined" /></div>
    </div>

    <!-- each a card as the body measurements' -->
    <div v-if="vitals.length" class="grid g2 spt"><div v-for="v in vitals" :key="v.id" class="card"><div class="lbl hgap">{{ v.name }} ({{ v.unit }})</div>
      <LineChart :points="v.pts" :height="140" :fmt="v.f" /><div class="tiny ht-line">{{ v.line }}</div></div></div>

    <!-- how hard each workout and activity was, over the period: its average heart rate -->
    <div class="sh"><h2>Heart rate during exercise</h2><span v-if="sessions.length" class="tiny">{{ sessions.length }}</span></div>
    <template v-if="sessions.length">
      <p class="tiny">How hard each workout and activity was: its average and highest heart rate.{{ total > sessions.length ? ` ${total - sessions.length} more in this period have none: wear your band while you record to add it.` : "" }}</p>
      <div v-if="sessions.length > 2" class="card"><div class="lbl hgap">Average per session (bpm)</div>
        <LineChart :points="sessions.map((x) => ({ x: new Date(x.at).getTime(), y: x.avg, id: x.key, label: x.name }))" :height="160" :fmt="(v) => fmt.num(v, 0)" @pick="open" />
        <div v-if="top" class="tiny ht-line">Highest {{ top.max }} bpm in {{ top.name }} on {{ fmt.date(top.at) }}</div></div>
      <div class="card" :class="{ spt: sessions.length > 2 }"><div class="list">
        <div v-for="x in newest" :key="x.key" class="li click" role="button" tabindex="0" @click="router.push(x.path)" @keydown.enter="router.push(x.path)">
          <span class="bi sg"><Icon :name="x.icon" :size="16" /></span>
          <div class="grow"><div class="t">{{ x.name }}</div><div class="s">{{ fmt.date(x.at, { weekday: "short", day: "numeric", month: "short" }) }} · {{ fmt.dur(x.durationS, true) }}</div></div>
          <!-- the average, and the highest under it: on the left with the date and time it wrapped on a phone -->
          <div class="r"><b class="num">{{ x.avg }} bpm</b><div v-if="x.max" class="s">up to {{ x.max }}</div></div>
        </div>
      </div></div>
      <div v-if="sessions.length > 10 && !showAll" class="center spt"><button class="qb" @click="showAll = true">Show all {{ sessions.length }} sessions</button></div>
    </template>
    <div v-else-if="total" class="card empty"><Icon name="heart" :size="34" /><b>No exercise heart rate yet</b>Workouts and activities you record while wearing your band show their heart rate here once it has synced.</div>
    <div v-else class="card empty"><Icon name="heart" :size="34" /><b>No workouts in this period</b>Pick a longer period, or record one while wearing your band.</div>
  </template>
</template>

<style scoped>
.ht-line { margin-top: 6px; }
</style>
