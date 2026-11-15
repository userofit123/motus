<script setup lang="ts">
// One activity: the map, time, distance, pace, steps, climb, calories, pace per km/mile, heart rate (from a band), notes;
// edit or delete. Only what there is: a time only type (climbing, yoga) shows its time, plus whatever a band measured then.
import { goBack } from "../core/leave";
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useActivity, useActivityTypes, useTypeName, loaded } from "../api/queries";
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
import DotLine from "../components/DotLine.vue";
import BarChart from "../components/BarChart.vue";
import HeartRate from "../components/HeartRate.vue";
import { routeSplits, M_PER_MI, fromM, activityDistance, activityClimb, type ActivityType } from "@motus/shared";
import { fromWhere, useDevice } from "../native/health";

const route = useRoute(), router = useRouter();
const id = computed(() => String(route.params.id));
const q = useActivity(id);
const fmt = useFmt();
const a = computed<any>(() => q.data.value);
const typeName = useTypeName();
// Where it came from, after the time like the workout page's "felt good": recorded live with the phone's GPS, or a
// GPX/TCX file; one logged by hand needs no note. A time only type is recorded live without GPS, so no route: no GPS said.
const source = computed(() => (a.value?.source === "gps" ? (a.value.route?.length ? "recorded with GPS" : "recorded live") : a.value?.source === "import" ? "imported from a file" : ""));
// How long each km (or mile) took, moving; only worth a chart with two or more to compare. The fastest full one is marked.
const splits = computed(() => (a.value?.route?.length ? routeSplits(a.value.route, fmt.value.du === "mi" ? M_PER_MI : 1000) : []));
const fastest = computed(() => splits.value.filter((t) => !t.partial).reduce<(typeof splits.value)[number] | null>((b, t) => (!b || t.s < b.s ? t : b), null));
// Under a tile, one pattern for the worn device's numbers: "From your watch" when the value is the device's, and the
// other source's number beside a value as "<source> · <number>" ("Your watch · 1.21 km"). Steps the device counted
// replace the phone's (a phone in a pocket or bag misses many), so they say both: "From your watch · phone counted 1,100"
// (the phone's count one part, so it never wraps away from its words). As parts for DotLine: the tile is half the width
// on a phone, so the line wraps between parts, never at a dot
const dev = useDevice();
const fromBand = computed(() => `From ${fromWhere(true, dev.value)}`);
const stepsSub = computed(() => a.value?.stepsSource !== "band" ? [] : a.value.stepsApp ? [fromBand.value, `phone counted ${fmt.value.num(a.value.stepsApp, 0)}`] : [fromBand.value]);
const types = useActivityTypes();
const type = computed(() => (types.data.value as ActivityType[] | undefined)?.find((t) => t.slug === a.value?.type));
// the activity's own distance and climb count where its type tracks them (@motus/shared, as every list and sum)
const ownDist = computed(() => (a.value ? activityDistance(a.value, type.value) : null));
const ownClimb = computed(() => (a.value ? activityClimb(a.value, type.value) : null));
// the pace as the value with its unit small beside it ("5:12" /km), as the other tiles' units; from the activity's own
// distance only, over its moving time where known
const pace = computed(() => { const x = a.value, d = ownDist.value; if (!d || !(x.movingS || x.durationS)) return null; return fmt.value.clock((x.movingS || x.durationS) / fromM(d, fmt.value.du)); });
// "3.42" and "km" apart, as the tiles show a value and its unit
const distParts = (m: number) => ({ value: fmt.value.num(fmt.value.distNum(m), 2), unit: fmt.value.du });
const distText = (m: number) => `${fmt.value.num(fmt.value.distNum(m), 2)} ${fmt.value.du}`;
type Tile = { key: string; icon: string; label: string; value: string; unit?: string; sub?: string[]; hero?: boolean };
// The stat tiles: only those with a value. A band's number for the activity's time (Health Connect, 037) fills a tile
// the activity has nothing of its own for, said under it; beside the activity's own number (typed or GPS, which always
// stays the activity's) it is said under that one.
const tiles = computed<Tile[]>(() => {
  const x = a.value, f = fmt.value, out: Tile[] = [];
  if (!x) return out;
  const band = (v: number | null | undefined) => (v != null && Number(v) > 0 ? Number(v) : null);
  const bDist = band(x.bandDistanceM), bClimb = band(x.bandElevationM), bFloors = band(x.bandFloors), bKcal = band(x.bandKcal);
  // as parts, so a half-width tile wraps at the dot ("Your watch · 1.21 km"), as the steps line does
  const said = (what: string) => [fromWhere(true, dev.value).replace(/^./, (c) => c.toUpperCase()), what], bandSub = [fromBand.value];
  out.push({ key: "time", icon: "clock", label: "Duration", value: f.dur(x.durationS, true), sub: x.movingS ? [`${f.dur(x.movingS, true)} moving`] : [], hero: true });
  if (ownDist.value) out.push({ key: "dist", icon: "map", label: "Distance", ...distParts(ownDist.value), sub: bDist ? said(distText(bDist)) : [] });
  else if (bDist) out.push({ key: "dist", icon: "map", label: "Distance", ...distParts(bDist), sub: bandSub });
  if (pace.value) out.push({ key: "pace", icon: "timer", label: "Average pace", value: pace.value, unit: `/${f.du}` });
  if (x.steps > 0) out.push({ key: "steps", icon: "steps", label: "Steps", value: f.num(x.steps, 0), sub: stepsSub.value });
  // the climb takes the steps' place as before (one or the other, so a walk keeps its two rows of two)
  if (!(x.steps > 0) && ownClimb.value != null) out.push({ key: "climb", icon: "arrowUp", label: "Climb", value: String(Math.round(ownClimb.value)), unit: "m", sub: bClimb ? said(`${Math.round(bClimb)} m`) : [] });
  else if (!(x.steps > 0) && bClimb) out.push({ key: "climb", icon: "arrowUp", label: "Climb", value: String(Math.round(bClimb)), unit: "m", sub: bandSub });
  else if (!(x.steps > 0) && bFloors) out.push({ key: "floors", icon: "arrowUp", label: "Floors", value: f.num(bFloors, bFloors % 1 ? 1 : 0), sub: bandSub });
  if (x.calories > 0) out.push({ key: "kcal", icon: "flame", label: "Active calories", value: f.num(x.calories, 0), unit: "kcal", sub: bKcal ? said(`${f.num(bKcal, 0)} kcal`) : [] });
  else if (bKcal) out.push({ key: "kcal", icon: "flame", label: "Active calories", value: f.num(bKcal, 0), unit: "kcal", sub: bandSub });
  return out;
});
async function del() { if (await confirm("Delete this activity?", { ok: "Delete", danger: true })) { await api.del(`/activities/${id.value}`); invalidate(["*"]); toast("Activity deleted"); router.replace("/history"); } }
async function edit(field: "name" | "notes") { const v = await prompt(field === "name" ? "Name" : "Notes", { value: a.value[field] }); if (v != null) { await api.put(`/activities/${id.value}`, { ...a.value, [field]: v, route: null }); invalidate(["activities"]); toast(field === "name" ? "Activity renamed" : "Notes saved"); } }
function gpx() {
  const pts = (a.value.route ?? []).map((p: number[]) => `<trkpt lat="${p[0]}" lon="${p[1]}">${p[3] != null ? `<ele>${p[3]}</ele>` : ""}${p[2] ? `<time>${new Date(p[2] * 1000).toISOString()}</time>` : ""}</trkpt>`).join("");
  const x = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Motus" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${a.value.name || a.value.type}</name><type>${a.value.type}</type><trkseg>${pts}</trkseg></trk></gpx>`;
  saveFile(new Blob([x], { type: "application/gpx+xml" }), `${a.value.type}-${a.value.startedAt.slice(0, 10)}.gpx`).catch(toastError);
}
// show the page once its data is in, all at once
await loaded(q, types);
</script>

<template>
  <div v-if="a" class="page">
    <button class="back" @click="goBack(router, '/history')"><Icon name="left" :size="16" /><span>Back</span></button>
    <div class="ph"><div><h1>{{ a.name || typeName(a.type) }}</h1><DotLine class="sub" :parts="[fmt.dateLong(a.startedAt), `${fmt.time(a.startedAt)}-${fmt.time(a.endedAt)}`, source].filter(Boolean)" /></div>
      <div class="acts"><Menu :items="[{ label: 'Rename', icon: 'edit', run: () => edit('name') }, { label: 'Notes', icon: 'note', run: () => edit('notes') }, { label: 'Export GPX', icon: 'download', sep: true, run: gpx, hidden: !a.route?.length }, { label: 'Delete', icon: 'trash', danger: true, sep: true, run: del }]" /></div></div>
    <RouteMap v-if="a.route?.length" :route="a.route" />
    <div class="grid g4 spt" :class="`n${tiles.length}`">
      <div v-for="t in tiles" :key="t.key" class="card stat" :class="{ hero: t.hero }"><div class="lbl"><span class="bi"><Icon :name="t.icon" :size="15" /></span>{{ t.label }}</div><div class="val">{{ t.value }}<small v-if="t.unit">{{ t.unit }}</small></div><DotLine v-if="t.sub?.length" class="sub" :parts="t.sub" /></div>
    </div>
    <div v-if="splits.length > 1" class="card spt">
      <div class="lbl hgap">Pace per {{ fmt.du }}{{ fastest ? ` · fastest ${fmt.clock(fastest.s)} in ${fmt.du} ${fastest.n}` : "" }}</div>
      <BarChart :bars="splits.map((t) => ({ label: String(t.n), value: t.s, color: t === fastest ? 'var(--pos)' : undefined, tip: t.partial ? `last ${fmt.num(t.fraction ?? 0, 2)} ${fmt.du}` : `${fmt.du} ${t.n}` }))" :fmt="(v) => `${fmt.clock(v)} /${fmt.du}`" :height="140" />
    </div>
    <HeartRate v-if="a.hr?.length || a.avgHr" class="spt" :avg="a.avgHr" :max="a.maxHr" :hr="a.hr" />
    <div v-if="a.notes" class="banner note spt"><Icon name="note" :size="18" class="note-ic" />{{ a.notes }}</div>
  </div>
  <div v-else class="page"><div class="empty">Loading…</div></div>
</template>
