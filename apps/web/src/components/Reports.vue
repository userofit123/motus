<script setup lang="ts">
// Monthly report and year in review (optional feature): what each month and year added up to.
import { computed, ref } from "vue";
import { GROUPS, groupOf, percentChange, isNight, type HomeRecord } from "@motus/shared";
import { useStats } from "../api/queries";
import { useFmt, unitOf } from "../core/format";
import { mins } from "../core/sleep";
import BarChart from "./BarChart.vue";
import Icon from "./Icon.vue";

const fmt = useFmt();
// the whole history, with every record set in it so each month can count its own
const all = useStats(ref({ records: 1 as const }));
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

// what one month (or year) added up to while the history is read, then its counts once it is done
interface Acc { k: string; workouts: number; timeS: number; volumeKg: number; sets: number; activities: number; distM: number; days: Set<string>; routines: Map<string, number>; groups: Map<string, number>; records: HomeRecord[];
  // what a band handed over: minutes asleep a night, resting heart rate and HRV a day, a workout's average heart rate
  sleep: number[]; rhr: number[]; hrv: number[]; whr: number[] }
type Period = Omit<Acc, "days"> & { days: number; top?: [string, number]; group?: { name: string; sets: number } };
interface StatsWorkout { startedAt: string; durationS: number; volumeKg: number; sets: number; name: string; muscles: Record<string, number>; avgHr?: number | string | null }
interface StatsDaily { date: string | Date; kind: string; value: number | string }
interface StatsActivity { startedAt: string; durationS: number; distanceM: number | string | null }
const by = (key: (d: Date) => string, dayKey: (d: string) => string) => computed<Period[]>(() => {
  const m = new Map<string, Acc>();
  const d = all.data.value as { workouts: StatsWorkout[]; activities: StatsActivity[]; records?: HomeRecord[]; daily?: StatsDaily[] } | undefined;
  if (!d) return [];
  const get = (k: string): Acc => {
    let x = m.get(k);
    if (!x) m.set(k, (x = { k, workouts: 0, timeS: 0, volumeKg: 0, sets: 0, activities: 0, distM: 0, days: new Set(), routines: new Map(), groups: new Map(), records: [], sleep: [], rhr: [], hrv: [], whr: [] }));
    return x;
  };
  for (const w of d.workouts) {
    const x = get(key(new Date(w.startedAt)));
    x.workouts++; x.timeS += w.durationS; x.volumeKg += w.volumeKg; x.sets += w.sets; x.days.add(w.startedAt.slice(0, 10)); x.routines.set(w.name, (x.routines.get(w.name) ?? 0) + 1);
    // sets per muscle group, counted as Stats counts muscles (a helper muscle's sets at half)
    for (const [mu, n] of Object.entries(w.muscles)) { const g = groupOf(mu); if (g !== "other") x.groups.set(g, (x.groups.get(g) ?? 0) + n); }
    if (Number(w.avgHr) > 0) x.whr.push(Number(w.avgHr));
  }
  for (const a of d.activities) { const x = get(key(new Date(a.startedAt))); x.activities++; x.timeS += a.durationS; x.distM += Number(a.distanceM ?? 0); x.days.add(a.startedAt.slice(0, 10)); }
  for (const r of d.records ?? []) m.get(key(new Date(r.at)))?.records.push(r);
  // a day's numbers count in the month (or year) it is a day of, in one that has a report (a workout or an activity);
  // sleep only as a night, not a nap or partial record (as Stats → Sleep averages it)
  const DAILY: Record<string, "sleep" | "rhr" | "hrv"> = { sleep_h: "sleep", resting_hr: "rhr", hrv: "hrv" };
  for (const x of d.daily ?? []) {
    const f = DAILY[x.kind], v = Number(x.value);
    if (f && v > 0 && (f !== "sleep" || isNight(v))) m.get(dayKey(String(x.date).slice(0, 10)))?.[f].push(f === "sleep" ? v * 60 : v);
  }
  const top = (mp: Map<string, number>) => [...mp].sort((a, b) => b[1] - a[1])[0];
  return [...m.values()].sort((a, b) => b.k.localeCompare(a.k)).map((x) => {
    const g = top(x.groups);
    return { ...x, days: x.days.size, top: top(x.routines), group: g && { name: GROUPS.find((y) => y.id === g[0])?.name ?? g[0], sets: Math.round(g[1]) } };
  });
});
const months = by(monthKey, (d) => d.slice(0, 7));
const years = by((d) => String(d.getFullYear()), (d) => d.slice(0, 4));
const monthOf = (k: string) => new Date(Number(k.slice(0, 4)), Number(k.slice(5)) - 1, 15);
const label = (k: string) => (k.length === 4 ? k : monthOf(k).toLocaleDateString(undefined, { month: "long", year: "numeric" }));
const prevKey = (k: string) => { const d = monthOf(k); d.setMonth(d.getMonth() - 1); return monthKey(d); };

// Workouts per month: every month in a row up to this one (the empty ones too, so the gaps show), at most the last 12
// and at least 6, each named by its short month (its narrow one when a phone is too narrow for that) with the year
// under the first month of each year; left out when none of those months has a workout (a history all older than that)
const chart = computed(() => {
  if (!months.value.length) return [];
  const byK = new Map(months.value.map((m) => [m.k, m]));
  const now = new Date(), first = months.value.at(-1)!.k;
  const out = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 15), k = monthKey(d);
    if (k < first && i >= 6) continue;
    out.push({ label: d.toLocaleDateString(undefined, { month: "short" }), short: d.toLocaleDateString(undefined, { month: "narrow" }), group: String(d.getFullYear()), value: byK.get(k)?.workouts ?? 0, tip: label(k) });
  }
  return out.some((b) => b.value) ? out : [];
});

// a month's or year's report: stat tiles as Home's This week, each with its change from the period before, then its
// highlights as list rows
interface Tile { key: string; icon: string; label: string; value: string; unit: string; delta: string; last: string }
interface Highlight { key: string; icon: string; t: string; s: string; r: string; pr?: boolean }
const mean = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / xs.length;
// what a report covers, under its title: a year the months that have data in it, a month whether it is still going
const span = (k: string) => {
  // only the month still going and the year still going have something to say; a past month's or year's title is enough
  if (k.length !== 4) return k === monthKey(new Date()) ? "This month so far" : "";
  if (k !== String(new Date().getFullYear())) return "";
  const ks = months.value.map((x) => x.k).filter((x) => x.startsWith(k)).sort();
  const mn = (x: string) => monthOf(x).toLocaleDateString(undefined, { month: "short" });
  return ks.length < 2 ? k : `${mn(ks[0]!)}-${mn(ks.at(-1)!)} ${k}`;
};
const build = (m: Period, p: Period | undefined, prev: string) => {
  const tile = (key: string, icon: string, lbl: string, get: (x: Period) => number, show: (n: number) => string, split = false): Tile => {
    const v = show(get(m));
    return { key, icon, label: lbl, ...(split ? unitOf(v) : { value: v, unit: "" }), delta: percentChange(get(m), p ? get(p) : 0), last: show(p ? get(p) : 0) };
  };
  const tiles = [
    tile("workouts", "dumbbell", "Workouts", (x) => x.workouts, (n) => String(n)),
    tile("time", "clock", "Time", (x) => x.timeS, (n) => fmt.value.dur(n, true)),
    tile("volume", "layers", "Volume", (x) => x.volumeKg, (n) => fmt.value.vol(n), true),
    tile("days", "calendar", "Active days", (x) => x.days, (n) => String(n)),
  ];
  const names = [...new Set(m.records.map((r) => r.name))];
  const highlights: Highlight[] = [
    ...(m.records.length ? [{ key: "rec", icon: "trophy", t: "Records", s: names.length > 2 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : names.join(", "), r: String(m.records.length), pr: true }] : []),
    ...(m.top ? [{ key: "routine", icon: "routines", t: "Most done", s: m.top[0], r: m.top[1] === 1 ? "once" : `${m.top[1]} times` }] : []),
    ...(m.group ? [{ key: "group", icon: "activity", t: "Most trained", s: m.group.name, r: `${m.group.sets} sets` }] : []),
    // the count on the right as Records has it; the distance under the name only when there is one
    ...(m.activities ? [{ key: "act", icon: "walk", t: "Activities", s: m.distM > 0 ? fmt.value.dist(m.distM, 1) : "", r: String(m.activities) }] : []),
    // then what a band handed over, each only when there: sleep a night, resting heart rate (with HRV under it), and the
    // workouts' heart rate, the average on the right as the counts above
    ...(m.sleep.length ? [{ key: "sleep", icon: "moon", t: "Sleep", s: `Average of ${m.sleep.length} ${m.sleep.length === 1 ? "night" : "nights"}`, r: mins(mean(m.sleep)) }] : []),
    ...(m.rhr.length ? [{ key: "rhr", icon: "heart", t: "Resting heart rate", s: m.hrv.length ? `HRV ${Math.round(mean(m.hrv))} ms` : "", r: `${Math.round(mean(m.rhr))} bpm` }]
      : m.hrv.length ? [{ key: "hrv", icon: "heartPulse", t: "HRV", s: "", r: `${Math.round(mean(m.hrv))} ms` }] : []),
    ...(m.whr.length ? [{ key: "whr", icon: "heartPulse", t: "Workout heart rate", s: `Average of ${m.whr.length} ${m.whr.length === 1 ? "workout" : "workouts"}`, r: `${Math.round(mean(m.whr))} bpm` }] : []),
  ];
  return { k: m.k, title: m.k.length === 4 ? (m.k === String(new Date().getFullYear()) ? "This year so far" : `${m.k} in review`) : label(m.k), sub: span(m.k), prev, tiles, anyDelta: tiles.some((x) => x.delta), highlights };
};
const report = computed(() => {
  const byK = new Map(months.value.map((m) => [m.k, m]));
  return months.value.map((m) => build(m, byK.get(prevKey(m.k)), monthOf(prevKey(m.k)).toLocaleDateString(undefined, { month: "long" })));
});
// a year card (against the year before it) when this year has two months with data; early in the year, last year's instead
// (if it has two), never an older one. One month alone would only repeat that month's own report.
const year = computed(() => {
  const now = new Date().getFullYear();
  const y = [now, now - 1].map(String).map((k) => years.value.find((x) => x.k === k))
    .find((x) => x && months.value.filter((m) => m.k.startsWith(x.k)).length >= 2);
  if (!y) return null;
  const before = String(Number(y.k) - 1);
  return build(y, years.value.find((x) => x.k === before), before);
});
</script>

<template>
  <!-- nothing until the history is read, so the empty state doesn't flash up while it loads -->
  <div v-if="all.data.value">
    <!-- workouts per month across the top, then the year so far (once two months have data), then a card per month; one header and set of tiles
         for all of them -->
    <div v-if="report.length" class="grid g2">
      <div v-if="chart.length" class="card full">
        <div class="ch"><span class="bi"><Icon name="stats" :size="15" /></span><span class="t grow">Workouts per month</span><span class="tiny">{{ chart.length === 12 ? "Last 12 months" : `Last ${chart.length} months` }}</span></div>
        <BarChart :bars="chart" values :height="170" />
      </div>
      <template v-for="r in [...(year ? [year] : []), ...report]" :key="r.k">
        <div class="card wkc" :class="{ full: r === year || !year && report.length === 1 }">
          <div class="ch"><span class="bi"><Icon :name="r === year ? 'star' : 'calendar'" :size="15" /></span><span class="grow"><span class="t">{{ r.title }}</span><span v-if="r.sub || r.k.length === 7" class="s sub" :class="{ ghost: !r.sub }">{{ r.sub || "\u00a0" }}</span></span><span v-if="r.anyDelta" class="tiny">Vs {{ r.prev }}</span></div>
          <div class="wstats n4" :class="{ plain: !r.anyDelta }">
            <div v-for="x in r.tiles" :key="x.key" class="ws" role="group" :aria-label="`${[x.label, x.value, x.unit, x.delta].filter(Boolean).join(' ')}, ${r.prev} ${x.last}`" :title="`${r.prev} ${x.last}`">
              <div class="wlb"><Icon :name="x.icon" :size="14" />{{ x.label }}</div>
              <div class="wv">{{ x.value }} <small v-if="x.unit">{{ x.unit }}</small></div>
              <div v-if="r.anyDelta" class="wd">{{ x.delta }}</div>
            </div>
          </div>
          <div v-if="r.highlights.length" class="list hl">
            <div v-for="h in r.highlights" :key="h.key" class="li">
              <Icon :name="h.icon" :size="18" :class="h.pr ? 'rec' : 'muted'" />
              <div class="grow"><div class="t">{{ h.t }}</div><div v-if="h.s" class="s">{{ h.s }}</div></div>
              <b class="r rv">{{ h.r }}</b>
            </div>
          </div>
        </div>
      </template>
    </div>
    <div v-else class="card empty"><Icon name="stats" :size="34" /><b>Nothing to report yet</b>Each month's report shows here once you finish a workout or log an activity.</div>
  </div>
</template>

<style scoped>
/* the period under a title, as a list row's sub line (that one is scoped to list rows, so it is repeated here) */
.sub { display: block; font-size: 12.5px; color: var(--tx2); margin-top: 1px; font-weight: 400; }
/* a month card without a note keeps the line empty so two cards side by side have equal headers; a phone stacks them, so there it is dropped */
html.phone .sub.ghost { display: none; }
/* the year in review and the chart take the whole row, and so does a lone month; the months otherwise sit two across */
.full { grid-column: 1 / -1; }

/* the highlights under the tiles, as list rows: what on the left, its number on the right; a record in the
   accent colour, the way records are marked elsewhere */
/* a report is dense (four tiles, then rows), so the highlights sit a block-padding gap below the tiles */
.hl { margin-top: var(--cpy); border-top: 1px solid var(--ol); }
.hl .li:last-child { border-bottom: 0; padding-bottom: 0; }
.hl .s { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hl .grow { min-width: 0; }
.rec { color: var(--acc); }
.rv { font-variant-numeric: tabular-nums; white-space: nowrap; }
</style>
