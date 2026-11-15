<script setup lang="ts">
// Stats → Heart's day: one day's heart rate as a tracker app shows it, picked with the Calendar's bar a day at a time
// (as Stats → Steps' day). One card, as Steps' day and Sleep's night: the day's average heart rate as its hero with the
// resting heart rate against your usual, the range, HRV and blood oxygen as a report's tiles (each only when read), the
// heart rate from midnight to midnight with the day's workouts and activities shaded on it in the Calendar's colours,
// the time in each heart rate zone, and the day's sessions with their heart rate. A day whose band records weren't saved
// (before they were kept) shows the day's own series if there is one, else just its numbers and why there is no chart.
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import { zoneMinutes, ymd } from "@motus/shared";
import { useHealthDay } from "../../api/queries";
import { useFmt } from "../../core/format";
import { ZONES, useMaxHr, hrSamples } from "../../core/heart";
import Icon from "../Icon.vue";
import HeartRate from "../HeartRate.vue";
import StageBar from "./StageBar.vue";
import DayNav from "./DayNav.vue";
import DaySessionList from "./DaySessionList.vue";
import { useDaySessions, useToday, legendOf, dayHours, dayTitle, noRecords, DAY_DATA_COLOR } from "./daySessions";

// day: the day shown ("YYYY-MM-DD"); resting: the resting heart rate by day, for your usual
const date = defineModel<string>("day", { required: true });
const props = defineProps<{ resting: { date: string; value: number }[] }>();
const router = useRouter();
const fmt = useFmt();
const maxHr = useMaxHr();
const today = useToday();
const title = computed(() => dayTitle(date.value, today.value, fmt.value));
// a day at a time, never past today
const step = (n: number) => { const d = new Date(date.value + "T12:00"); d.setDate(d.getDate() + n); const k = ymd(d); date.value = k > today.value ? today.value : k; };

// the day by the app's calendar: its midnight to the next
const from = computed(() => new Date(date.value + "T00:00"));
const to = computed(() => { const d = new Date(from.value); d.setDate(d.getDate() + 1); return d; });
// each keeps the day before on screen while the next one loads, so stepping a day doesn't empty the card for a moment;
// the samples under a "readings" key, so a change to the saved records reloads them
const recs = useQuery({ queryKey: computed(() => ["readings", "day", "heart_rate", date.value]), queryFn: () => hrSamples(from.value, to.value), placeholderData: keepPreviousData });
const day = useHealthDay(date, true, { keep: true });
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
// the hero: the day's average heart rate (else its resting one), with the resting heart rate against your usual as Steps'
// day says its steps against your usual day: the difference in the good colour when lower and the warning one when
// higher (3 bpm either way, a band's day-to-day wobble), then "vs usual" and the usual
const rest = computed(() => (day.data.value?.restingHr != null ? Math.round(day.data.value.restingHr) : null));
const hero = computed(() => (avg.value != null ? { value: avg.value, unit: "bpm average" } : rest.value != null ? { value: rest.value, unit: "bpm resting" } : null));
const vsUsual = computed(() => {
  if (rest.value == null || usual.value == null) return null;
  const d = rest.value - usual.value;
  return { text: d === 0 ? "0 bpm" : `${d > 0 ? "+" : "-"}${Math.abs(d)} bpm`, tone: Math.abs(d) < 3 ? undefined : d > 0 ? "neg" : "pos", usual: usual.value };
});
// the tiles: heart = the day's range, timer = HRV (the time between beats), water = blood oxygen, as Stats →
// Heart's charts
type Tile = { key: string; icon: string; label: string; value: string; unit: string; sub: string };
const tiles = computed(() => {
  const d = day.data.value, out: Tile[] = [];
  if (lo.value != null) out.push({ key: "hr", icon: "heart", label: "Heart rate", value: `${lo.value}-${hi.value}`, unit: "bpm", sub: "lowest-highest" });
  if (d?.hrv != null) out.push({ key: "hrv", icon: "timer", label: "HRV", value: fmt.value.num(d.hrv, 0), unit: "ms", sub: "average" });
  if (d?.spo2 != null) out.push({ key: "spo2", icon: "water", label: "Blood oxygen", value: p(d.spo2), unit: "%", sub: "average" });
  return out;
});
const label = (x: Tile) => [x.label, x.value, x.unit, x.sub].filter(Boolean).join(" ");

// the day's workouts and activities: shaded on the chart, and listed under it
const { q: calQ, sessions } = useDaySessions(date, computed(() => true));
const spans = computed(() => sessions.value.filter((s) => s.b > s.a).map((s) => ({ a: s.a, b: s.b, id: s.key, name: s.name, color: s.color })));
const legend = computed(() => legendOf(sessions.value));
const ticks = computed(() => dayHours(date.value, fmt.value).map((h) => h.at));

// minutes in each zone, from the samples
const zones = computed(() => {
  if (!maxHr.value || samples.value.length < 2) return [];
  const m = zoneMinutes(samples.value, maxHr.value.bpm).get("") ?? [];
  return ZONES.map((z, i) => ({ key: z.key, name: z.name, color: z.color, min: Math.round(m[i] ?? 0) }));
});
const zoned = computed(() => zones.value.some((z) => z.min > 0));
const charted = computed(() => samples.value.length > 1);
// "Loading…" only the first time: stepping to another day keeps the card as it is until the day is in, so it doesn't jump
const loaded = ref(false);
const loading = computed(() => !loaded.value && (recs.isLoading.value || day.isLoading.value || calQ.isLoading.value));
// as Steps' and Sleep's: the day's numbers failed (the samples alone failing still leaves the day's own series)
const failed = computed(() => day.isError.value && !day.data.value);
watch(() => !recs.isLoading.value && !day.isLoading.value && !calQ.isLoading.value, (v) => { if (v) loaded.value = true; }, { immediate: true });
</script>

<template>
  <DayNav :title="title" unit="day" :at-end="date >= today" :away="date !== today" @step="step" @today="date = today" />
  <div v-if="failed" class="card empty"><Icon name="info" :size="34" /><b>Couldn't load your heart data</b>{{ (day.error.value as Error | null)?.message }}<br /><button class="btn tonal" @click="day.refetch(); recs.refetch()">Try again</button></div>
  <div v-else-if="loading" class="empty">Loading…</div>
  <div v-else-if="!hero && !tiles.length && !sessions.length && !charted" class="card empty"><Icon name="heart" :size="34" /><b>No heart data on this day</b>Pick another day with the arrows.</div>
  <div v-else class="card wkc">
    <div class="ch"><span class="bi"><Icon name="heart" :size="15" /></span><span class="t grow">Heart</span></div>
    <!-- the day's heart rate, then its other numbers as a report's tiles under a faint line, as Steps' day -->
    <div v-if="hero" class="gs-top">
      <span class="gs-ico"><Icon name="heart" :size="28" /></span>
      <div class="grow"><div class="gs-val">{{ hero.value }}<small>{{ hero.unit }}</small></div>
        <div v-if="rest != null && hero.unit !== 'bpm resting'" class="tiny">resting {{ rest }} bpm<template v-if="vsUsual"> · <span :class="vsUsual.tone">{{ vsUsual.text }}</span> vs usual {{ vsUsual.usual }}</template></div>
        <div v-else-if="vsUsual" class="tiny"><span :class="vsUsual.tone">{{ vsUsual.text }}</span> vs usual {{ vsUsual.usual }}</div></div>
    </div>
    <div v-if="tiles.length" class="wstats rows2 hd-sec" :class="{ n4: tiles.length === 4 }">
      <div v-for="x in tiles" :key="x.key" class="ws" role="group" :aria-label="label(x)">
        <div class="wlb"><Icon :name="x.icon" :size="14" />{{ x.label }}</div>
        <div class="wv">{{ x.value }} <small>{{ x.unit }}</small></div>
        <div class="wd">{{ x.sub }}</div>
      </div>
    </div>

    <div class="hd-sec"><div class="lbl hgap">Heart rate by hour</div>
      <template v-if="charted"><HeartRate inline chart :hr="samples" :height="170" :day="{ from: from.getTime(), to: to.getTime(), spans, ticks, color: DAY_DATA_COLOR }" @pick="(id) => router.push(id)" />
        <div v-if="legend.length" class="bmlegend hd-leg"><span><i :style="{ background: DAY_DATA_COLOR }" />Heart rate</span><span v-for="k in legend" :key="k.color"><i :style="{ background: k.color }" />{{ k.name }}</span></div></template>
      <div v-else class="tiny">{{ noRecords("day") }}</div></div>

    <div v-if="zoned" class="hd-sec"><div class="lbl hgap">Time in heart rate zones · max {{ maxHr!.bpm }} bpm{{ maxHr!.own ? "" : " from your age" }}</div><StageBar :parts="zones" /></div>
    <div v-else-if="!maxHr && charted" class="tiny hd-sec"><button class="lnk inl" @click="router.push('/body?tab=details')">Set your year of birth or max heart rate</button> to see the time in heart rate zones.</div>

    <div v-if="sessions.length" class="hd-sec"><div class="lbl hgap">Workouts and activities</div>
      <DaySessionList :sessions="sessions" :value="(x) => (x.avgHr != null ? `${Math.round(x.avgHr)} bpm` : '-')" :sub="(x) => (x.maxHr != null ? `highest ${Math.round(x.maxHr)} bpm` : '')" /></div>
  </div>
</template>

<style scoped>
/* each part a block-padding below the one before, under a faint line, as Stats → Sleep's last night */
.hd-sec { margin-top: var(--cpy); padding-top: var(--cpy); border-top: 1px solid var(--ol); }
/* nothing above it but the header: no line */
.ch + .hd-sec { margin-top: 0; padding-top: 0; border-top: 0; }
.hd-leg { margin-top: var(--hg); }
</style>
