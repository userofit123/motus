<script setup lang="ts">
// Monthly report and year in review (optional feature): what each month and year added up to.
import { computed, ref } from "vue";
import { GROUPS, groupOf, percentChange, type HomeRecord } from "@motus/shared";
import { useStats } from "../api/queries";
import { useFmt } from "../core/format";
import BarChart from "./BarChart.vue";
import Icon from "./Icon.vue";

const fmt = useFmt();
// the whole history, with every record set in it so each month can count its own
const all = useStats(ref({ records: 1 as const }));
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const by = (key: (d: Date) => string) => computed(() => {
  const m = new Map<string, any>();
  const d = all.data.value;
  if (!d) return [];
  const get = (k: string) => m.get(k) ?? (m.set(k, { k, workouts: 0, timeS: 0, volumeKg: 0, sets: 0, activities: 0, distM: 0, days: new Set<string>(), routines: new Map<string, number>(), groups: new Map<string, number>(), records: [] as HomeRecord[] }), m.get(k));
  for (const w of d.workouts) {
    const x = get(key(new Date(w.startedAt)));
    x.workouts++; x.timeS += w.durationS; x.volumeKg += w.volumeKg; x.sets += w.sets; x.days.add(w.startedAt.slice(0, 10)); x.routines.set(w.name, (x.routines.get(w.name) ?? 0) + 1);
    // sets per muscle group, counted as Stats counts muscles (a helper muscle's sets at half)
    for (const [mu, n] of Object.entries(w.muscles as Record<string, number>)) { const g = groupOf(mu); if (g !== "other") x.groups.set(g, (x.groups.get(g) ?? 0) + n); }
  }
  for (const a of d.activities) { const x = get(key(new Date(a.startedAt))); x.activities++; x.timeS += a.durationS; x.distM += Number(a.distanceM ?? 0); x.days.add(a.startedAt.slice(0, 10)); }
  for (const r of (d.records ?? []) as HomeRecord[]) m.get(key(new Date(r.at)))?.records.push(r);
  const top = <T,>(mp: Map<T, number>) => [...mp].sort((a, b) => b[1] - a[1])[0];
  return [...m.values()].sort((a, b) => b.k.localeCompare(a.k)).map((x) => {
    const g = top<string>(x.groups);
    return { ...x, days: x.days.size as number, top: top<string>(x.routines), group: g && { name: GROUPS.find((y) => y.id === g[0])?.name ?? g[0], sets: Math.round(g[1]) } };
  });
});
const months = by(monthKey);
const years = by((d) => String(d.getFullYear()));
const monthOf = (k: string) => new Date(Number(k.slice(0, 4)), Number(k.slice(5)) - 1, 15);
const label = (k: string) => (k.length === 4 ? k : monthOf(k).toLocaleDateString(undefined, { month: "long", year: "numeric" }));
const prevKey = (k: string) => { const d = monthOf(k); d.setMonth(d.getMonth() - 1); return monthKey(d); };

// Workouts per month: every month in a row up to this one (the empty ones too, so the gaps show), at most the last 12
// and at least 6, each named by its short month with the year under the first month of each year
const chart = computed(() => {
  if (!months.value.length) return [];
  const byK = new Map(months.value.map((m) => [m.k, m]));
  const now = new Date(), first = months.value.at(-1)!.k;
  const out = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 15), k = monthKey(d);
    if (k < first && i >= 6) continue;
    out.push({ label: d.toLocaleDateString(undefined, { month: "short" }), group: String(d.getFullYear()), value: byK.get(k)?.workouts ?? 0, tip: label(k) });
  }
  return out;
});

// a month's report: stat tiles as Home's This week, each with its change from the month before, then its highlights
interface Tile { key: string; icon: string; label: string; value: string; unit: string; delta: string; last: string }
const unitOf = (s: string) => { const i = s.lastIndexOf(" "); return i < 0 ? { value: s, unit: "" } : { value: s.slice(0, i), unit: s.slice(i + 1) }; };
const report = computed(() => {
  const byK = new Map(months.value.map((m) => [m.k, m]));
  return months.value.map((m) => {
    const p = byK.get(prevKey(m.k));
    const tile = (key: string, icon: string, lbl: string, get: (x: any) => number, show: (n: number) => string, split = false): Tile => {
      const v = show(get(m));
      return { key, icon, label: lbl, ...(split ? unitOf(v) : { value: v, unit: "" }), delta: percentChange(get(m), p ? get(p) : 0), last: show(p ? get(p) : 0) };
    };
    const tiles = [
      tile("workouts", "dumbbell", "Workouts", (x) => x.workouts, (n) => String(n)),
      tile("time", "clock", "Time", (x) => x.timeS, (n) => fmt.value.dur(n, true)),
      tile("volume", "layers", "Volume", (x) => x.volumeKg, (n) => fmt.value.vol(n), true),
      tile("days", "calendar", "Active days", (x) => x.days, (n) => String(n)),
    ];
    const names = [...new Set(m.records.map((r: HomeRecord) => r.name))] as string[];
    const highlights = [
      ...(m.records.length ? [{ key: "rec", icon: "trophy", t: "Records", s: names.length > 2 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : names.join(", "), r: String(m.records.length), pr: true }] : []),
      ...(m.top ? [{ key: "routine", icon: "routines", t: "Most done", s: m.top[0], r: m.top[1] === 1 ? "once" : `${m.top[1]} times` }] : []),
      ...(m.group ? [{ key: "group", icon: "activity", t: "Most trained", s: m.group.name, r: `${m.group.sets} sets` }] : []),
      ...(m.activities ? [{ key: "act", icon: "walk", t: "Activities", s: m.activities === 1 ? "1 activity" : `${m.activities} activities`, r: fmt.value.dist(m.distM, 1) }] : []),
    ];
    return { k: m.k, title: label(m.k), prev: monthOf(prevKey(m.k)).toLocaleDateString(undefined, { month: "long" }), tiles, anyDelta: tiles.some((x) => x.delta), highlights };
  });
});
</script>

<template>
  <div>
    <template v-for="y in years.slice(0, 1)" :key="y.k">
      <div class="card hero spb">
        <div class="lbl">{{ y.k }} in review</div>
        <div class="grid g4" style="margin-top:10px">
          <div><div class="val" style="font-size:28px">{{ y.workouts }}</div><div class="sub">workouts</div></div>
          <div><div class="val" style="font-size:28px">{{ Math.round(y.timeS / 3600) }}h</div><div class="sub">moving</div></div>
          <div><div class="val" style="font-size:28px">{{ fmt.vol(y.volumeKg) }}</div><div class="sub">lifted</div></div>
          <div><div class="val" style="font-size:28px">{{ y.days }}</div><div class="sub">active days{{ y.top ? ` · most: ${y.top[0]}` : "" }}</div></div>
        </div>
      </div>
    </template>
    <div v-if="chart.length" class="card spb">
      <div class="ch"><span class="bi"><Icon name="stats" :size="15" /></span><span class="t grow">Workouts per month</span><span class="tiny">{{ chart.length === 12 ? "Last 12 months" : `Last ${chart.length} months` }}</span></div>
      <BarChart :bars="chart" values :height="170" />
    </div>
    <div class="grid g2">
      <div v-for="m in report" :key="m.k" class="card mrep">
        <div class="ch"><span class="bi"><Icon name="calendar" :size="15" /></span><span class="t grow">{{ m.title }}</span><span v-if="m.anyDelta" class="tiny">Vs {{ m.prev }}</span></div>
        <div class="wstats n4" :class="{ plain: !m.anyDelta }">
          <div v-for="x in m.tiles" :key="x.key" class="ws" role="group" :aria-label="`${[x.label, x.value, x.unit, x.delta].filter(Boolean).join(' ')}, ${m.prev} ${x.last}`" :title="`${m.prev} ${x.last}`">
            <div class="wlb"><Icon :name="x.icon" :size="14" />{{ x.label }}</div>
            <div class="wv">{{ x.value }}<small v-if="x.unit">{{ x.unit }}</small></div>
            <div v-if="m.anyDelta" class="wd">{{ x.delta }}</div>
          </div>
        </div>
        <div v-if="m.highlights.length" class="list hl">
          <div v-for="h in m.highlights" :key="h.key" class="li">
            <Icon :name="h.icon" :size="18" :class="h.pr ? 'rec' : 'muted'" />
            <div class="grow"><div class="t">{{ h.t }}</div><div class="s">{{ h.s }}</div></div>
            <b class="r rv">{{ h.r }}</b>
          </div>
        </div>
      </div>
    </div>
    <div v-if="!months.length" class="card empty"><Icon name="stats" :size="34" /><b>Nothing to report yet</b>Each month's report shows here once you finish a workout or log an activity.</div>
  </div>
</template>

<style scoped>
/* the block header as on Home: the icon in its tile, the title, a quiet note on the right */
.ch .bi { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; background: var(--s2); color: var(--acc); flex: none; }

/* a month's stat tiles, the same as Home's This week: label with its icon, the value with its unit set small, the change
   from the month before; four across, two by two in a narrower card, rows on the narrowest */
.mrep { container-type: inline-size; min-width: 0; }
.wstats { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: var(--hg); }
.ws { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ws + .ws { border-inline-start: 1px solid var(--ol); padding-inline-start: var(--hg); }
.wlb { display: flex; align-items: center; gap: 4px; font-size: var(--fs-sm); color: var(--tx2); white-space: nowrap; }
.wlb :deep(svg) { color: var(--acc); flex: none; }
.wv { font-size: clamp(var(--fs-lg), calc((100cqi - 6 * var(--hg)) / 22.4), calc(var(--fs-lg) * 1.25)); font-weight: 650; line-height: 1.2; font-variant-numeric: tabular-nums; white-space: nowrap; }
.wv small { font-size: var(--fs); font-weight: 500; margin-inline-start: 5px; color: var(--tx2); letter-spacing: 0; }
.wd { font-size: var(--fs-sm); line-height: 1.4; min-height: 1.4em; color: var(--tx2); font-variant-numeric: tabular-nums; white-space: nowrap; }
@container (max-width: 460px) {
  .wstats { grid-auto-flow: row; grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: var(--hg); }
  .ws:nth-child(odd) { border-inline-start: 0; padding-inline-start: 0; }
  .wv { font-size: clamp(var(--fs-lg), calc((100cqi - 2 * var(--hg)) / 11.2), calc(var(--fs-lg) * 1.25)); }
}
@container (max-width: 330px) {
  .wstats { grid-template-columns: minmax(0, 1fr) auto auto; column-gap: var(--cpx); row-gap: var(--tdy); align-items: baseline; }
  .wstats.plain { grid-template-columns: minmax(0, 1fr) auto; }
  .ws { display: contents; }
  .wlb { align-self: center; }
  .wv { font-size: var(--fs-lg); text-align: end; }
  .wd { text-align: end; }
}

/* the month's highlights under the tiles, as list rows: what on the left, its number on the right; a record in the
   accent colour, the way records are marked elsewhere */
.hl { margin-top: var(--hg); border-top: 1px solid var(--ol); }
.hl .li:last-child { border-bottom: 0; padding-bottom: 0; }
.hl .s { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hl .grow { min-width: 0; }
.rec { color: var(--acc); }
.rv { font-variant-numeric: tabular-nums; white-space: nowrap; }
</style>
