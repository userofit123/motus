<script setup lang="ts">
// One activity: the map, time, distance, pace, climb, splits per km/mile, notes; edit or delete.
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useActivity } from "../api/queries";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { useFmt } from "../core/format";
import { confirm, prompt } from "../core/ask";
import { noteSheet } from "../core/ui";
import Icon from "../components/Icon.vue";
import Menu from "../components/Menu.vue";
import RouteMap from "../components/RouteMap.vue";
import BarChart from "../components/BarChart.vue";

const route = useRoute(), router = useRouter();
const id = computed(() => String(route.params.id));
const q = useActivity(id);
const fmt = useFmt();
const a = computed<any>(() => q.data.value);
async function del() { if (await confirm("Delete this activity?", { ok: "Delete", danger: true })) { await api.del(`/activities/${id.value}`); invalidate(["*"]); router.replace("/history"); } }
async function edit(field: "name" | "notes") { const v = await prompt(field === "name" ? "Name" : "Notes", { value: a.value[field] }); if (v != null) { await api.put(`/activities/${id.value}`, { ...a.value, [field]: v, route: null }); invalidate(["activities"]); } }
function gpx() {
  const pts = (a.value.route ?? []).map((p: number[]) => `<trkpt lat="${p[0]}" lon="${p[1]}">${p[3] != null ? `<ele>${p[3]}</ele>` : ""}${p[2] ? `<time>${new Date(p[2] * 1000).toISOString()}</time>` : ""}</trkpt>`).join("");
  const x = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Motus" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${a.value.name || a.value.type}</name><type>${a.value.type}</type><trkseg>${pts}</trkseg></trk></gpx>`;
  const el = document.createElement("a"); el.href = URL.createObjectURL(new Blob([x], { type: "application/gpx+xml" })); el.download = `${a.value.type}-${a.value.startedAt.slice(0, 10)}.gpx`; el.click();
}
</script>

<template>
  <div v-if="a" class="page">
    <button class="back" @click="router.back()"><Icon name="left" :size="16" />Back</button>
    <div class="ph"><div><h1 style="text-transform:capitalize">{{ a.name || a.type }}</h1><div class="sub">{{ fmt.dateLong(a.startedAt) }} · {{ fmt.time(a.startedAt) }}{{ a.source === "import" ? " · imported" : a.source === "gps" ? " · recorded" : "" }}</div></div>
      <div class="acts"><Menu :items="[{ label: 'Rename', icon: 'edit', run: () => edit('name') }, { label: 'Notes', icon: 'note', run: () => edit('notes') }, { label: 'Export GPX', icon: 'download', run: gpx, hidden: !a.route?.length }, { label: 'Delete', icon: 'trash', danger: true, sep: true, run: del }]" /></div></div>
    <RouteMap v-if="a.route?.length" :route="a.route" />
    <div class="grid g4" style="margin-top:var(--spg)">
      <div class="card stat hero"><div class="lbl">Time</div><div class="val">{{ fmt.clock(a.durationS) }}</div><div class="sub">{{ a.movingS ? `${fmt.clock(a.movingS)} moving` : "" }}</div></div>
      <div class="card stat"><div class="lbl">Distance</div><div class="val">{{ a.distanceM ? fmt.num(fmt.distNum(a.distanceM), 2) : "–" }}<small>{{ fmt.du }}</small></div></div>
      <div class="card stat"><div class="lbl">Pace</div><div class="val" style="font-size:26px">{{ a.distanceM ? fmt.pace(a.movingS || a.durationS, a.distanceM) : "–" }}</div></div>
      <div class="card stat"><div class="lbl">{{ a.steps ? "Steps" : "Climb" }}</div><div class="val">{{ a.steps ? a.steps.toLocaleString() : a.elevationM != null ? Math.round(a.elevationM) : "–" }}<small v-if="!a.steps && a.elevationM != null">m</small></div></div>
    </div>
    <div v-if="a.splits?.length" class="card" style="margin-top:var(--spg)"><div class="lbl" style="margin-bottom:8px">Splits (min per km)</div><BarChart :bars="a.splits.map((s: any) => ({ label: String(s.km), value: Math.round((s.s / 60) * 10) / 10 }))" :height="140" /></div>
    <div v-if="a.notes" class="banner note" style="margin-top:var(--spg)"><Icon name="note" />{{ a.notes }}</div>
  </div>
  <div v-else class="page"><div class="empty">Loading…</div></div>
</template>
