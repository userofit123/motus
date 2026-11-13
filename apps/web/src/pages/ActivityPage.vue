<script setup lang="ts">
// One activity: the map, time, distance, pace, climb, pace per km/mile, notes; edit or delete.
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
import { routeSplits, M_PER_MI } from "@motus/shared";

const route = useRoute(), router = useRouter();
const id = computed(() => String(route.params.id));
const q = useActivity(id);
const fmt = useFmt();
const a = computed<any>(() => q.data.value);
// Where it came from, after the time like the workout page's "felt good": recorded live with the phone's GPS, or a
// GPX/TCX file; one logged by hand needs no note.
const source = computed(() => (a.value?.source === "gps" ? "recorded with GPS" : a.value?.source === "import" ? "imported from a file" : ""));
// How long each km (or mile) took, moving; only worth a chart with two or more to compare. The fastest full one is marked.
const splits = computed(() => (a.value?.route?.length ? routeSplits(a.value.route, fmt.value.du === "mi" ? M_PER_MI : 1000) : []));
const fastest = computed(() => splits.value.filter((t) => Number.isInteger(t.n)).reduce<(typeof splits.value)[number] | null>((b, t) => (!b || t.s < b.s ? t : b), null));
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
    <div class="ph"><div><h1 style="text-transform:capitalize">{{ a.name || a.type }}</h1><div class="sub">{{ fmt.dateLong(a.startedAt) }} · {{ fmt.time(a.startedAt) }}-{{ fmt.time(a.endedAt) }}{{ source ? ` · ${source}` : "" }}</div></div>
      <div class="acts"><Menu :items="[{ label: 'Rename', icon: 'edit', run: () => edit('name') }, { label: 'Notes', icon: 'note', run: () => edit('notes') }, { label: 'Export GPX', icon: 'download', sep: true, run: gpx, hidden: !a.route?.length }, { label: 'Delete', icon: 'trash', danger: true, sep: true, run: del }]" /></div></div>
    <RouteMap v-if="a.route?.length" :route="a.route" />
    <div class="grid g4 spt">
      <div class="card stat hero"><div class="lbl">Time</div><div class="val">{{ fmt.clock(a.durationS) }}</div><div class="sub">{{ a.movingS ? `${fmt.clock(a.movingS)} moving` : "" }}</div></div>
      <div class="card stat"><div class="lbl">Distance</div><div class="val">{{ a.distanceM ? fmt.num(fmt.distNum(a.distanceM), 2) : "-" }}<small>{{ fmt.du }}</small></div></div>
      <div class="card stat"><div class="lbl">Pace</div><div class="val" style="font-size:26px">{{ a.distanceM ? fmt.pace(a.movingS || a.durationS, a.distanceM) : "-" }}</div></div>
      <div class="card stat"><div class="lbl">{{ a.steps ? "Steps" : "Climb" }}</div><div class="val">{{ a.steps ? fmt.num(a.steps, 0) : a.elevationM != null ? Math.round(a.elevationM) : "-" }}<small v-if="!a.steps && a.elevationM != null">m</small></div></div>
    </div>
    <div v-if="splits.length > 1" class="card spt">
      <div class="lbl hgap">Pace per {{ fmt.du }}{{ fastest ? ` · fastest ${fmt.clock(fastest.s)} in ${fmt.du} ${fastest.n}` : "" }}</div>
      <BarChart :bars="splits.map((t) => ({ label: String(t.n), value: t.s, color: t === fastest ? 'var(--pos)' : undefined, tip: Number.isInteger(t.n) ? `${fmt.du} ${t.n}` : `last ${fmt.num(t.n % 1, 1)} ${fmt.du}` }))" :fmt="(v) => `${fmt.clock(v)} /${fmt.du}`" :height="140" />
    </div>
    <div v-if="a.notes" class="banner note spt"><Icon name="note" :size="18" class="note-ic" />{{ a.notes }}</div>
  </div>
  <div v-else class="page"><div class="empty">Loading…</div></div>
</template>
