<script setup lang="ts">
// One night in full, for Stats → Sleep's Night view: time asleep against the time in bed as a ring, and against your usual
// night; when you fell asleep
// and woke up, the time awake and the lowest heart rate as a report's tiles; the stages across the night (a hypnogram,
// from the band's saved sleep record) with the time of each, adding up to the ring's time asleep and the tile's time
// awake; the heart rate, blood oxygen and breathing through the night; and the workouts and activities since the day
// before began. A night imported before band records were kept has no record: it shows its totals (the stage bar, the
// night's own heart rate series), never empty charts.
// Each part after the first a block-padding below the one before, under a faint line, as Stats → Heart's day.
import { computed } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import { ymd } from "@motus/shared";
import { api } from "../../api/client";
import { useSleep, useSleepNight } from "../../api/queries";
import { useFmt } from "../../core/format";
import { asleepMin, inBedMin, efficiency, hasStages, isFull, mins, nightSegments, SEG_NAME, segColor, SHORT_WHY, type Seg, type SleepRecord } from "../../core/sleep";
import { hrSamples } from "../../core/heart";
import { deviceWord, useDevice } from "../../native/health";
import Icon from "../Icon.vue";
import Ring from "../Ring.vue";
import LineChart from "../LineChart.vue";
import StageBar from "./StageBar.vue";
import Hypnogram from "./Hypnogram.vue";
import DaySessionList from "./DaySessionList.vue";
import { useDaySessions, noRecords, type DaySession } from "./daySessions";

// noTimes: the night's times are in the card's header (Stats → Sleep), so not in the line under the ring
const props = defineProps<{ date: string; noTimes?: boolean }>();
const fmt = useFmt();
const dev = useDevice();
// keeping the night before while the next loads, so stepping a night doesn't flash
const nq = useSleepNight(computed(() => props.date), { keep: true });
const n = computed(() => nq.data.value ?? null);
const t0 = computed(() => (n.value ? Date.parse(n.value.startAt) : 0)), t1 = computed(() => (n.value ? Date.parse(n.value.endAt) : 0));
const iso = (ms: number) => new Date(ms).toISOString();
const clock = (ms: number) => fmt.value.time(iso(ms));

// the saved records around the night: its sleep record (an hour either side, a record can start before the night's
// summary does), its blood oxygen and breathing readings, and its heart rate samples; under the "readings" keys, so a
// change to the saved records (a sync, a deletion) reloads them
type Reading = { start: string; value?: number };
const on = computed(() => !!n.value);
const sleepQ = useQuery({ queryKey: computed(() => ["readings", "night", "sleep", props.date, t0.value]), enabled: on, placeholderData: keepPreviousData, retry: false,
  queryFn: () => api.get<{ records: SleepRecord[] }>("/health/records", { type: "sleep", from: iso(t0.value - 3600_000), to: iso(t1.value + 3600_000) }) });
const readQ = useQuery({ queryKey: computed(() => ["readings", "night", "spo2,resp_rate", props.date, t0.value]), enabled: on, placeholderData: keepPreviousData, retry: false,
  queryFn: () => api.get<{ records: (Reading & { type: string })[] }>("/health/records", { type: "spo2,resp_rate", from: iso(t0.value), to: iso(t1.value) }) });
const hrQ = useQuery({ queryKey: computed(() => ["readings", "night", "heart_rate", props.date, t0.value]), enabled: on, placeholderData: keepPreviousData, retry: false,
  queryFn: () => hrSamples(new Date(t0.value), new Date(t1.value)) });

const segs = computed<Seg[]>(() => (n.value && sleepQ.data.value ? nightSegments(sleepQ.data.value.records, n.value.startAt, n.value.endAt) : []));
const asleepSegs = computed(() => segs.value.filter((s) => s.k !== "awake"));
// the chart's span: the night, widened to its record's stretches
const from = computed(() => Math.min(t0.value, segs.value[0]?.a ?? Infinity)), to = computed(() => Math.max(t1.value, segs.value.at(-1)?.b ?? 0));
// the hours under the charts: whole hours every 2 (every 3 over a night longer than 10 hours), from the first after the
// night began, none closer than 20 minutes to either end so the labels never crowd the edges
const xt = computed(() => {
  const step = to.value - from.value > 10 * 3600_000 ? 3 : 2, out: number[] = [];
  const d = new Date(from.value); d.setMinutes(0, 0, 0);
  for (let x = d.getTime() + 3600_000; x <= to.value - 20 * 60_000; x += 3600_000) if (x - from.value >= 20 * 60_000 && new Date(x).getHours() % step === 0) out.push(x);
  return out;
});

// fell asleep and woke up: the first and the last stretch asleep, else the night's start and end
const fell = computed(() => asleepSegs.value[0]?.a ?? t0.value), woke = computed(() => asleepSegs.value.at(-1)?.b ?? t1.value);
// time awake between falling asleep and waking up, and how many times (stretches of a minute or more)
const wakes = computed(() => segs.value.filter((s) => s.k === "awake" && s.a >= fell.value && s.b <= woke.value && s.b - s.a >= 60_000));
const awakeMin = computed(() => (segs.value.length ? wakes.value.reduce((t, s) => t + (s.b - s.a), 0) / 60000 : n.value?.awakeMin ?? null));
const samples = computed<[number, number][]>(() => (hrQ.data.value?.length ? hrQ.data.value : n.value?.hr ?? []));
const low = computed(() => samples.value.reduce<[number, number] | null>((m, p) => (!m || p[1] < m[1] ? p : m), null));
const lowHr = computed(() => low.value?.[1] ?? n.value?.minHr ?? null);

// the night against your usual, the hero's second line as Steps' and Heart's days say theirs: the usual is the average
// time asleep of the 30 days' nights before it (full nights only, from 5 on, as Stats → Sleep's 30-day average), the
// difference in the good colour when longer and the warning one when shorter (10 minutes either way)
const beforeQ = useSleep(computed(() => ({ from: ymd(new Date(new Date(props.date + "T12:00").getTime() - 30 * 86400000)), to: props.date })), on, { keep: true });
const vsUsual = computed(() => {
  const xs = (beforeQ.data.value?.nights ?? []).filter((x) => x.date < props.date && isFull(x));
  if (!n.value || !isFull(n.value) || xs.length < 5) return null;
  const usual = xs.reduce((t, x) => t + asleepMin(x), 0) / xs.length, d = Math.round(asleepMin(n.value) - usual);
  return { text: d === 0 ? mins(0) : `${d > 0 ? "+" : "-"}${mins(Math.abs(d))}`, tone: Math.abs(d) < 10 ? undefined : d > 0 ? "pos" : "neg", usual: mins(usual) };
});

type Tile = { key: string; icon: string; label: string; value: string; unit: string; sub: string };
const tiles = computed<Tile[]>(() => {
  if (!n.value) return [];
  const out: Tile[] = [];
  const apart = (a: number, b: number) => Math.abs(a - b) >= 5 * 60_000;
  out.push({ key: "fell", icon: "clock", label: "Fell asleep", value: clock(fell.value), unit: "", sub: apart(fell.value, t0.value) ? `in bed ${clock(t0.value)}` : "" });
  out.push({ key: "woke", icon: "bell", label: "Woke up", value: clock(woke.value), unit: "", sub: apart(woke.value, t1.value) ? `up ${clock(t1.value)}` : "" });
  if (awakeMin.value) out.push({ key: "awake", icon: "eye", label: "Awake", value: mins(awakeMin.value), unit: "", sub: wakes.value.length ? (wakes.value.length === 1 ? "once" : `${wakes.value.length} times`) : "during the night" });
  if (lowHr.value != null) out.push({ key: "hr", icon: "heart", label: "Lowest heart rate", value: fmt.value.num(lowHr.value, 0), unit: "bpm", sub: low.value ? `at ${clock(low.value[0] * 1000)}` : "" });
  return out;
});

// the time in each stage, from the record's stretches over the whole hypnogram, so the bar shows what the chart draws:
// the stages asleep scaled to add up to the night's time asleep (the ring's), the time awake the Awake tile's
const parts = computed(() => {
  if (!n.value || !asleepSegs.value.length) return null;
  const m = new Map<Seg["k"], number>();
  for (const s of asleepSegs.value) m.set(s.k, (m.get(s.k) ?? 0) + (s.b - s.a) / 60000);
  const drawnAsleep = [...m.values()].reduce((t, v) => t + v, 0), k = drawnAsleep ? asleepMin(n.value) / drawnAsleep : 1;
  return (["deep", "light", "rem", "asleep", "awake"] as const).map((key) => ({ key, name: SEG_NAME[key], color: segColor(key), min: Math.round(key === "awake" ? awakeMin.value ?? 0 : (m.get(key) ?? 0) * k) }));
});
// a hypnogram once the record tells more than one stretch apart
const drawn = computed(() => segs.value.length > 1);

// blood oxygen and breathing through the night, each a line once it has two readings, else the night's own averages
const series = (type: string) => (readQ.data.value?.records ?? []).filter((r) => r.type === type && r.value != null).map((r) => ({ x: Date.parse(r.start), y: r.value!, label: fmt.value.time(r.start) }));
const p1 = (v: number) => fmt.value.num(v, Number.isInteger(v) ? 0 : 1);
const curves = computed(() => {
  const x = n.value;
  if (!x) return [];
  const hr = samples.value.map((p) => ({ x: p[0] * 1000, y: p[1], label: clock(p[0] * 1000) }));
  const sp = series("spo2"), br = series("resp_rate");
  const line = (ys: number[], u: (v: number) => string, lowest: boolean) => ys.length ? [`average ${u(ys.reduce((t, y) => t + y, 0) / ys.length)}`, lowest ? `lowest ${u(Math.min(...ys))}` : ""].filter(Boolean).join(" · ") : "";
  const pct = (v: number) => `${p1(Math.round(v * 10) / 10)}%`, bpm = (v: number) => `${fmt.value.num(v, 0)} bpm`, br1 = (v: number) => `${fmt.value.num(v, 0)} breaths/min`;
  return [
    { id: "hr", name: "Heart rate (bpm)", pts: hr, f: (v: number) => fmt.value.num(v, 0),
      // the average only: the lowest is in its tile above
      line: hr.length ? line(hr.map((p) => p.y), bpm, false) : x.avgHr != null ? `average ${bpm(x.avgHr)}` : "" },
    { id: "spo2", name: "Blood oxygen (%)", pts: sp, f: p1,
      line: sp.length ? line(sp.map((p) => p.y), pct, true) : [x.avgSpo2 != null ? `average ${pct(x.avgSpo2)}` : "", x.minSpo2 != null ? `lowest ${pct(x.minSpo2)}` : ""].filter(Boolean).join(" · ") },
    { id: "resp", name: "Breathing rate (breaths/min)", pts: br, f: (v: number) => fmt.value.num(v, 0),
      line: br.length ? line(br.map((p) => p.y), br1, false) : x.respRate != null ? `average ${br1(x.respRate)}` : "" },
  ].filter((c) => c.pts.length > 1 || c.line);
});

// the workouts and activities from the start of the day before to going to bed, as Stats → Steps' and Heart's day lists,
// each with how long before bed it ended
const dayBefore = computed(() => { const d = new Date(props.date + "T12:00"); d.setDate(d.getDate() - 1); return ymd(d); });
const date = computed(() => props.date);
const s1 = useDaySessions(dayBefore, on), s2 = useDaySessions(date, on);
const before = computed<DaySession[]>(() => [...s1.sessions.value, ...s2.sessions.value].filter((x) => x.a < t0.value));
const beforeBed = (x: DaySession) => mins(Math.max(0, t0.value - x.b) / 60000);
</script>

<template>
  <div v-if="!n" class="empty">
    <template v-if="nq.isError.value"><Icon name="info" :size="34" /><b>This night is gone</b>It may have been deleted on another device.</template>
    <template v-else>Loading…</template>
  </div>
  <template v-else>
    <div class="gs-top">
      <Ring :pct="efficiency(n)" :size="64" :stroke="7" :done="efficiency(n) >= 0.85" />
      <div class="grow">
        <div class="gs-val">{{ mins(asleepMin(n)) }}<small>asleep</small></div>
        <div class="tiny"><template v-if="!noTimes">{{ fmt.time(n.startAt) }}-{{ fmt.time(n.endAt) }} · </template>{{ mins(inBedMin(n)) }} in bed · {{ Math.round(efficiency(n) * 100) }}% of it asleep</div>
        <div v-if="vsUsual" class="tiny"><span :class="vsUsual.tone">{{ vsUsual.text }}</span> vs usual {{ vsUsual.usual }}</div>
      </div>
    </div>
    <div v-if="!isFull(n)" class="tiny nv-note">{{ SHORT_WHY }}</div>
    <div v-if="n.edited" class="tiny nv-note">Time asleep as you set it for this day; your {{ deviceWord(dev) }} measured {{ mins(n.asleepMin) }}.</div>

    <div class="wstats rows2 csec" :class="{ n4: tiles.length === 4 }">
      <div v-for="x in tiles" :key="x.key" class="ws" role="group" :aria-label="[x.label, x.value, x.unit, x.sub].filter(Boolean).join(' ')">
        <div class="wlb"><Icon :name="x.icon" :size="14" />{{ x.label }}</div>
        <div class="wv">{{ x.value }} <small v-if="x.unit">{{ x.unit }}</small></div>
        <div class="wd">{{ x.sub }}</div>
      </div>
    </div>

    <div v-if="drawn || hasStages(n) || n.awakeMin" class="csec">
      <div class="lbl hgap">Stages</div>
      <Hypnogram v-if="drawn" class="hgap" :segs="segs" :from="from" :to="to" :xt="xt" />
      <StageBar v-if="parts" :parts="parts" />
      <StageBar v-else :night="n" />
      <div v-if="!drawn" class="tiny nv-line">{{ noRecords("night") }}</div>
    </div>

    <div v-for="c in curves" :key="c.id" class="csec">
      <div class="lbl hgap">{{ c.name }}</div>
      <LineChart v-if="c.pts.length > 1" :points="c.pts" :height="130" :fmt="c.f" :domain="[from, to]" :xt="xt" :gap="20 * 60_000" :xfmt="clock" />
      <div class="tiny nv-line">{{ c.line }}</div>
    </div>

    <div v-if="before.length" class="csec">
      <div class="lbl hgap">Before this night</div>
      <DaySessionList :sessions="before" :value="beforeBed" :sub="() => 'before bed'" />
    </div>
  </template>
</template>

<style scoped>
.nv-note { margin-top: var(--hg); }
.nv-line { margin-top: var(--tdy); }
</style>
