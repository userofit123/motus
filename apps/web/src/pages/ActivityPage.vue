<script setup lang="ts">
// One activity: the map, time, distance, pace, climb, splits per km/mile, notes; edit or delete.
import { goBack } from "../core/leave";
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useActivity, loaded } from "../api/queries";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { useFmt } from "../core/format";
import { confirm, prompt } from "../core/ask";
import { noteSheet } from "../core/ui";
import { toast, toastError } from "../core/toast";
import { saveFile } from "../core/saveFile";
import Icon from "../components/Icon.vue";
import Menu from "../components/Menu.vue";
import RouteMap from "../components/RouteMap.vue";
import BarChart from "../components/BarChart.vue";

const route = useRoute(), router = useRouter();
const id = computed(() => String(route.params.id));
const q = useActivity(id);
const fmt = useFmt();
const a = computed<any>(() => q.data.value);
async function del() { if (await confirm("Delete this activity?", { ok: "Delete", danger: true })) { await api.del(`/activities/${id.value}`); invalidate(["*"]); toast("Activity deleted"); router.replace("/history"); } }
async function edit(field: "name" | "notes") { const v = await prompt(field === "name" ? "Name" : "Notes", { value: a.value[field] }); if (v != null) { await api.put(`/activities/${id.value}`, { ...a.value, [field]: v, route: null }); invalidate(["activities"]); toast(field === "name" ? "Activity renamed" : "Notes saved"); } }
function gpx() {
  const pts = (a.value.route ?? []).map((p: number[]) => `<trkpt lat="${p[0]}" lon="${p[1]}">${p[3] != null ? `<ele>${p[3]}</ele>` : ""}${p[2] ? `<time>${new Date(p[2] * 1000).toISOString()}</time>` : ""}</trkpt>`).join("");
  const x = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Motus" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${a.value.name || a.value.type}</name><type>${a.value.type}</type><trkseg>${pts}</trkseg></trk></gpx>`;
  saveFile(new Blob([x], { type: "application/gpx+xml" }), `${a.value.type}-${a.value.startedAt.slice(0, 10)}.gpx`).catch(toastError);
}
// show the page once its data is in, all at once
await loaded(q);
</script>

<template>
  <div v-if="a" class="page">
    <button class="back" @click="goBack(router, '/history')"><Icon name="left" :size="16" /><span>Back</span></button>
    <div class="ph"><div><h1 style="text-transform:capitalize">{{ a.name || a.type }}</h1><div class="sub">{{ fmt.dateLong(a.startedAt) }} · {{ fmt.time(a.startedAt) }}{{ a.source === "import" ? " · imported" : a.source === "gps" ? " · recorded" : "" }}</div></div>
      <div class="acts"><Menu :items="[{ label: 'Rename', icon: 'edit', run: () => edit('name') }, { label: 'Notes', icon: 'note', run: () => edit('notes') }, { label: 'Export GPX', icon: 'download', sep: true, run: gpx, hidden: !a.route?.length }, { label: 'Delete', icon: 'trash', danger: true, sep: true, run: del }]" /></div></div>
    <RouteMap v-if="a.route?.length" :route="a.route" />
    <div class="grid g4 spt">
      <div class="card stat hero"><div class="lbl">Time</div><div class="val">{{ fmt.clock(a.durationS) }}</div><div class="sub">{{ a.movingS ? `${fmt.clock(a.movingS)} moving` : "" }}</div></div>
      <div class="card stat"><div class="lbl">Distance</div><div class="val">{{ a.distanceM ? fmt.num(fmt.distNum(a.distanceM), 2) : "-" }}<small>{{ fmt.du }}</small></div></div>
      <div class="card stat"><div class="lbl">Pace</div><div class="val" style="font-size:26px">{{ a.distanceM ? fmt.pace(a.movingS || a.durationS, a.distanceM) : "-" }}</div></div>
      <div class="card stat"><div class="lbl">{{ a.steps ? "Steps" : "Climb" }}</div><div class="val">{{ a.steps ? fmt.num(a.steps, 0) : a.elevationM != null ? Math.round(a.elevationM) : "-" }}<small v-if="!a.steps && a.elevationM != null">m</small></div></div>
    </div>
    <div v-if="a.splits?.length" class="card spt"><div class="lbl hgap">Splits (min per km)</div><BarChart :bars="a.splits.map((s: any) => ({ label: String(s.km), value: Math.round((s.s / 60) * 10) / 10 }))" :height="140" /></div>
    <div v-if="a.notes" class="banner note spt"><Icon name="note" :size="18" class="note-ic" />{{ a.notes }}</div>
  </div>
  <div v-else class="page"><div class="empty">Loading…</div></div>
</template>
