<script setup lang="ts">
// Monthly report and year in review (optional feature): what each month and year added up to.
import { computed, ref } from "vue";
import { useStats } from "../api/queries";
import { useFmt } from "../core/format";
import BarChart from "./BarChart.vue";

const fmt = useFmt();
const all = useStats(ref({}));
const by = (key: (d: Date) => string) => computed(() => {
  const m = new Map<string, any>();
  const d = all.data.value;
  if (!d) return [];
  const get = (k: string) => m.get(k) ?? (m.set(k, { k, workouts: 0, timeS: 0, volumeKg: 0, sets: 0, activities: 0, distM: 0, days: new Set<string>(), routines: new Map<string, number>() }), m.get(k));
  for (const w of d.workouts) { const x = get(key(new Date(w.startedAt))); x.workouts++; x.timeS += w.durationS; x.volumeKg += w.volumeKg; x.sets += w.sets; x.days.add(w.startedAt.slice(0, 10)); x.routines.set(w.name, (x.routines.get(w.name) ?? 0) + 1); }
  for (const a of d.activities) { const x = get(key(new Date(a.startedAt))); x.activities++; x.timeS += a.durationS; x.distM += Number(a.distanceM ?? 0); x.days.add(a.startedAt.slice(0, 10)); }
  return [...m.values()].sort((a, b) => b.k.localeCompare(a.k)).map((x) => ({ ...x, days: x.days.size, top: [...x.routines].sort((a, b) => b[1] - a[1])[0]?.[0] }));
});
const months = by((d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
const years = by((d) => String(d.getFullYear()));
const label = (k: string) => (k.length === 4 ? k : new Date(k + "-15").toLocaleDateString(undefined, { month: "long", year: "numeric" }));
</script>

<template>
  <div>
    <template v-for="y in years.slice(0, 1)" :key="y.k">
      <div class="card hero spb">
        <div class="lbl">{{ y.k }} in review</div>
        <div class="grid g4" style="margin-top:10px">
          <div><div class="val" style="font-size:28px">{{ y.workouts }}</div><div class="sub">workouts</div></div>
          <div><div class="val" style="font-size:28px">{{ Math.round(y.timeS / 3600) }} h</div><div class="sub">moving</div></div>
          <div><div class="val" style="font-size:28px">{{ fmt.vol(y.volumeKg) }}</div><div class="sub">lifted</div></div>
          <div><div class="val" style="font-size:28px">{{ y.days }}</div><div class="sub">active days{{ y.top ? ` · most: ${y.top}` : "" }}</div></div>
        </div>
      </div>
    </template>
    <div v-if="months.length" class="card spb"><div class="lbl hgap">Workouts per month</div><BarChart :bars="months.slice(0, 12).reverse().map((m) => ({ label: m.k.slice(5), value: m.workouts }))" :height="150" /></div>
    <div class="grid g2">
      <div v-for="m in months" :key="m.k" class="card">
        <b>{{ label(m.k) }}</b>
        <div class="grid g3" style="margin-top:8px;gap:8px">
          <div><div class="lbl">Workouts</div><div style="font-weight:600">{{ m.workouts }}</div></div>
          <div><div class="lbl">Time</div><div style="font-weight:600">{{ fmt.dur(m.timeS, true) }}</div></div>
          <div><div class="lbl">Volume</div><div style="font-weight:600">{{ fmt.vol(m.volumeKg) }}</div></div>
        </div>
        <div class="tiny" style="margin-top:6px">{{ m.days }} active days{{ m.activities ? ` · ${m.activities} activities, ${fmt.dist(m.distM, 1)}` : "" }}{{ m.top ? ` · most: ${m.top}` : "" }}</div>
      </div>
    </div>
    <div v-if="!months.length" class="card empty"><b>Nothing to report yet</b></div>
  </div>
</template>
