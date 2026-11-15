<script setup lang="ts">
// Stats → Heart's day: one day's heart rate as a tracker app shows it, stepped through with ‹ › over the days that have
// heart data. Its numbers as a report's tiles (the range with the average, resting heart rate against your usual, HRV,
// blood oxygen; each only when read), the heart rate from midnight to midnight with the day's workouts and activities
// shaded on it, the time in each heart rate zone, and the day's sessions with their heart rate. A day whose band
// records weren't saved (before they were kept) shows the day's own series if there is one, else just its numbers.
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import { zoneMinutes, ymd } from "@motus/shared";
import { useTypeName, type HealthDay } from "../../api/queries";
import { api } from "../../api/client";
import { useFmt, activityIcon } from "../../core/format";
import { mins } from "../../core/sleep";
import { ZONES, useMaxHr, hrSamples } from "../../core/heart";
import Icon from "../Icon.vue";
import HeartRate from "../HeartRate.vue";
import StageBar from "./StageBar.vue";

// days: the days with heart data, oldest first; start: the one to open on; resting: the resting heart rate by day, for your usual
const props = defineProps<{ days: string[]; start: string; resting: { date: string; value: number }[] }>();
const router = useRouter();
const fmt = useFmt();
const typeName = useTypeName();
const maxHr = useMaxHr();
const date = ref(props.start);
watch(() => props.start, (d) => (date.value = d));
const prev = computed(() => [...props.days].reverse().find((d) => d < date.value) ?? null);
const next = computed(() => props.days.find((d) => d > date.value) ?? null);
const today = ymd(new Date());
const title = computed(() => {
  const y = new Date(); y.setDate(y.getDate() - 1);
  return date.value === today ? "Today" : date.value === ymd(y) ? "Yesterday" : fmt.value.date(date.value, { weekday: "long", day: "numeric", month: "short" });
});

// the day by the app's calendar: its midnight to the next
const from = computed(() => new Date(date.value + "T00:00"));
const to = computed(() => { const d = new Date(from.value); d.setDate(d.getDate() + 1); return d; });
const recs = useQuery({ queryKey: computed(() => ["health", "records", "heart_rate", date.value]), queryFn: () => hrSamples(from.value, to.value), placeholderData: keepPreviousData });
// the same keys as useHealthDay, useWorkouts and useActivities, each keeping the day before while the next one loads,
// so stepping a day doesn't empty the tiles and the list for a moment
const day = useQuery({ queryKey: computed(() => ["health", "day", date.value]), queryFn: () => api.get<HealthDay>(`/health/day/${date.value}`), placeholderData: keepPreviousData });
// the saved samples, else the day's own series (kept before every record was)
const samples = computed<[number, number][]>(() => recs.data.value?.length ? recs.data.value : day.data.value?.hr?.series ?? []);
const ys = computed(() => samples.value.map((p) => p[1]));
const lo = computed(() => ys.value.length ? Math.min(...ys.value) : day.data.value?.hr?.min ?? null);
const hi = computed(() => ys.value.length ? Math.max(...ys.value) : day.data.value?.hr?.max ?? null);
const avg = computed(() => ys.value.length ? Math.round(ys.value.reduce((t, v) => t + v, 0) / ys.value.length) : day.data.value?.hr?.avg ?? null);

// your usual resting heart rate: the average of the 28 days before, once at least 7 of them have one
const usual = computed(() => {
  const a = ymd(new Date(from.value.getTime() - 28 * 86400000));
  const xs = props.resting.filter((x) => x.date >= a && x.date < date.value);
  return xs.length >= 7 ? Math.round(xs.reduce((t, x) => t + x.value, 0) / xs.length) : null;
});
const p = (v: number) => fmt.value.num(v, Number.isInteger(v) ? 0 : 1);
const restingHr = computed(() => day.data.value?.restingHr ?? null), hrv = computed(() => day.data.value?.hrv ?? null), spo2 = computed(() => day.data.value?.spo2 ?? null);
const count = computed(() => (lo.value != null ? 1 : 0) + [restingHr.value, hrv.value, spo2.value].filter((v) => v != null).length);

// the day's workouts and activities: shaded on the chart, and listed under it
const range = computed(() => ({ from: from.value.toISOString(), to: to.value.toISOString(), limit: 50 }));
const ws = useQuery({ queryKey: computed(() => ["workouts", "list", range.value]), queryFn: () => api.get("/workouts", range.value), placeholderData: keepPreviousData });
const as = useQuery({ queryKey: computed(() => ["activities", range.value]), queryFn: () => api.get("/activities", range.value), placeholderData: keepPreviousData });
const sessions = computed(() => [
  ...((ws.data.value ?? []) as any[]).map((w) => ({ key: `/workouts/${w.id}`, icon: "dumbbell", name: w.name || "Workout", at: w.startedAt as string, durationS: Number(w.durationS) || 0, avg: w.avgHr ? Number(w.avgHr) : null })),
  ...((as.data.value ?? []) as any[]).map((a) => ({ key: `/activities/${a.id}`, icon: activityIcon(a.type), name: a.name || typeName(a.type), at: a.startedAt as string, durationS: Number(a.durationS) || 0, avg: a.avgHr ? Number(a.avgHr) : null })),
].sort((a, b) => a.at.localeCompare(b.at)));
const spans = computed(() => sessions.value.filter((s) => s.durationS > 0).map((s) => { const a = new Date(s.at).getTime(); return { a, b: a + s.durationS * 1000, id: s.key, name: s.name }; }));
const end = (s: { at: string; durationS: number }) => new Date(new Date(s.at).getTime() + s.durationS * 1000).toISOString();

// minutes in each zone, from the samples
const zones = computed(() => {
  if (!maxHr.value || samples.value.length < 2) return [];
  const m = zoneMinutes(samples.value, maxHr.value.bpm).get("") ?? [];
  return ZONES.map((z, i) => ({ key: z.key, name: z.name, color: z.color, min: Math.round(m[i] ?? 0) }));
});
const zoned = computed(() => zones.value.some((z) => z.min > 0));
// "Loading…" only the first time: stepping to another day keeps the card as it is until the day is in, so it doesn't jump
const loaded = ref(false);
const loading = computed(() => !loaded.value && (recs.isLoading.value || day.isLoading.value));
watch(() => !recs.isLoading.value && !day.isLoading.value, (v) => { if (v) loaded.value = true; }, { immediate: true });
</script>

<template>
  <div class="card wkc hd">
    <div class="ch"><span class="bi"><Icon name="heart" :size="15" /></span><span class="t grow">{{ title }}</span>
      <button class="ib sm plain" aria-label="Previous day" :disabled="!prev" @click="prev && (date = prev)"><Icon name="left" :size="18" /></button>
      <button class="ib sm plain" aria-label="Next day" :disabled="!next" @click="next && (date = next)"><Icon name="right" :size="18" /></button></div>
    <div v-if="loading" class="empty">Loading…</div>
    <template v-else>
      <div v-if="count" class="wstats" :class="{ n4: count === 4 }">
        <div v-if="lo != null" class="ws"><div class="wlb"><Icon name="activity" :size="14" />Heart rate</div><div class="wv">{{ lo }}-{{ hi }} <small>bpm</small></div><div class="wd">{{ avg != null ? `average ${avg}` : "lowest-highest" }}</div></div>
        <div v-if="restingHr != null" class="ws"><div class="wlb"><Icon name="heart" :size="14" />Resting heart rate</div><div class="wv">{{ fmt.num(restingHr, 0) }} <small>bpm</small></div><div class="wd">{{ usual != null ? `usual ${usual}` : "average" }}</div></div>
        <div v-if="hrv != null" class="ws"><div class="wlb"><Icon name="heartPulse" :size="14" />HRV</div><div class="wv">{{ fmt.num(hrv, 0) }} <small>ms</small></div><div class="wd">average</div></div>
        <div v-if="spo2 != null" class="ws"><div class="wlb"><Icon name="water" :size="14" />Blood oxygen</div><div class="wv">{{ p(spo2) }} <small>%</small></div><div class="wd">average</div></div>
      </div>
      <div v-else-if="!sessions.length" class="tiny">No heart data on this day.</div>

      <div v-if="samples.length > 1" class="hd-sec"><HeartRate inline chart :hr="samples" :height="170" :day="{ from: from.getTime(), to: to.getTime(), spans }" @pick="(id) => router.push(id)" />
        <div v-if="spans.length" class="bmlegend hd-leg"><span><i class="hd-sw" />Workouts and activities</span></div></div>

      <div v-if="zoned" class="hd-sec"><div class="lbl hgap">Time in heart rate zones · max {{ maxHr!.bpm }} bpm{{ maxHr!.own ? "" : " from your age" }}</div><StageBar :parts="zones" /></div>
      <div v-else-if="!maxHr && samples.length > 1" class="tiny hd-sec"><button class="lnk inl" @click="router.push('/body?tab=details')">Set your year of birth</button> to see the time in heart rate zones.</div>

      <div v-if="sessions.length" class="hd-sec"><div class="lbl hgap">Workouts and activities</div><div class="list hd-list">
        <div v-for="x in sessions" :key="x.key" class="li click" role="button" tabindex="0" @click="router.push(x.key)" @keydown.enter="router.push(x.key)">
          <span class="bi sg"><Icon :name="x.icon" :size="16" /></span>
          <div class="grow"><div class="t">{{ x.name }}</div><div class="s">{{ fmt.time(x.at) }}-{{ fmt.time(end(x)) }} · {{ fmt.dur(x.durationS, true) }}</div></div>
          <b class="num">{{ x.avg != null ? `${x.avg} bpm` : "-" }}</b>
        </div>
      </div></div>
    </template>
  </div>
</template>

<style scoped>
/* each part a block-padding below the one before, under a faint line, as Stats → Sleep's last night */
.hd { margin-bottom: var(--spg); }
.hd-sec { margin-top: var(--cpy); padding-top: var(--cpy); border-top: 1px solid var(--ol); }
/* nothing above it but the header: no line */
.ch + .hd-sec { margin-top: 0; padding-top: 0; border-top: 0; }
.hd-leg { margin-top: var(--hg); }
/* the swatch as the chart's shading, a little stronger so it reads at legend size */
.hd-sw { background: color-mix(in srgb, var(--acc) 30%, transparent); }
.hd-list .li:first-child { padding-top: 0; }
.hd-list .li:last-child { border-bottom: 0; padding-bottom: 0; }
.hd-list .grow { min-width: 0; }
/* in the phone's rows the line goes under the label and the value stands on the right, as Stats → Sleep's last night (NightStats) */
@container (max-width: 330px) {
  .wstats, .wstats.n4 { grid-template-columns: minmax(0, 1fr) auto; }
  .wstats .ws .wlb { grid-column: 1; }
  .wstats .ws .wv { grid-column: 2; grid-row: span 2; align-self: center; }
  .wstats .ws .wd { grid-column: 1; text-align: start; margin-bottom: var(--tdy); }
  .wstats .ws:last-child .wd { margin-bottom: 0; }
}
</style>
