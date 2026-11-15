<script setup lang="ts">
// One activity: the map, time, distance, pace, steps, climb, calories, pace per km/mile, heart rate (from a band), notes;
// edit or delete. Only what there is: a time only type (climbing, yoga) shows its time, plus whatever a band measured then.
import { goBack } from "../core/leave";
import { computed, ref } from "vue";
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
import Sheet from "../components/Sheet.vue";
import StepSourceRows from "../components/StepSourceRows.vue";
import { routeSplits, M_PER_MI, fromM, activityDistance, activityClimb, appSteps, stepsTyped, bandStepsVerdict, type ActivityType } from "@motus/shared";
import { fromWhere, useDevice, adviceWord, canActivitySources, activitySources, type ActivitySources } from "../native/health";

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
// Step sources (the Android app with Health Connect, an activity recorded or logged in Motus whose type counts steps):
// each app's steps in Health Connect for the activity's time, read as a sync reads them, the count Motus kept, which
// one is used and, when the worn device's isn't, why: the engine's own rule (bandStepsVerdict) on what Health Connect
// has now, so the reason is the one the next sync goes by
const srcs = ref<{ data: ActivitySources | null; error: string | null } | null>(null);
const canSources = computed(() => canActivitySources() && !!a.value?.endedAt && a.value.source !== "health_connect" && counts.value);
let srcRead = 0;
async function showSources() {
  const x = a.value, n = ++srcRead;
  srcs.value = { data: null, error: null };
  try { const data = await activitySources(new Date(x.startedAt).toISOString(), new Date(x.endedAt).toISOString()); if (n === srcRead && srcs.value) srcs.value = { data, error: null }; }
  catch (e) { if (n === srcRead && srcs.value) srcs.value = { data: null, error: (e as Error)?.message || "Health Connect could not be read" }; }
}
// the type counts steps, as the engine decides it (a type deleted since: walks, runs and hikes do)
const counts = computed(() => (type.value ? type.value.hasSteps !== false : ["walk", "run", "hike"].includes(a.value?.type)));
// the device in words, the same in the sheet's intro and its reason: the kind the worn device's records name, else the
// person's (both kinds while not known)
const srcWord = computed(() => {
  const d = srcs.value?.data, best = d?.sources.find((s) => s.band && s.app === d.used);
  return best && ["watch", "band", "ring", "chest strap"].includes(best.device) ? best.device : adviceWord(dev.value);
});
const bandUsed = computed(() => a.value?.stepsSource === "band");
// why the worn device's count isn't the activity's ("" when it is)
const srcReason = computed(() => {
  const x = a.value, d = srcs.value?.data, f = fmt.value;
  if (!x || !d || bandUsed.value) return "";
  const best = d.sources.find((s) => s.band && s.app === d.used) ?? null;
  // the device by the kind its records name, else the person's (useDevice)
  const app = appSteps(x), word = srcWord.value;
  const v = bandStepsVerdict({ steps: best?.steps ?? null, covered: !!best?.covered, app, counts: counts.value, typed: stepsTyped(x) });
  const what = (x.name || typeName(x.type)).toLowerCase();
  switch (v) {
    case "typed": return "You typed this count";
    case "notCounted": return `Motus doesn't count steps for this type`;
    case "none": return `Your ${word} has no steps for this time`;
    case "partial": {
      // the plugin's coverage rule says which part is missing
      const gap = best?.gapStart && best.gapEnd ? `${f.time(best.gapStart)}-${f.time(best.gapEnd)}` : "";
      if (best?.why === "after") return `Your ${word} has no data after this ${what} yet - it hasn't synced`;
      if (best?.why === "before") return `Your ${word} has no data from before this ${what}`;
      if (best?.why === "worn") return `Your ${word} wasn't worn during part of this ${what}${gap ? ` (no heart rate ${gap})` : ""}`;
      return `Your ${word}'s steps don't cover the whole ${what}${gap ? ` (gap ${gap})` : ""}`;
    }
    case "phone": return `Your ${word}'s count is the same as Motus's, so it's the phone's own count`;
    case "far": return `Your ${word}'s count is far from Motus's (${f.num(best!.steps, 0)} vs ${f.num(app ?? 0, 0)}), so it may be from another time`;
    default: return "Not checked yet - pull down to refresh";
  }
});
// show the page once its data is in, all at once
await loaded(q, types);
</script>

<template>
  <div v-if="a" class="page">
    <button class="back" @click="goBack(router, '/history')"><Icon name="left" :size="16" /><span>Back</span></button>
    <div class="ph"><div><h1>{{ a.name || typeName(a.type) }}</h1><DotLine class="sub" :parts="[fmt.dateLong(a.startedAt), `${fmt.time(a.startedAt)}-${fmt.time(a.endedAt)}`, source].filter(Boolean)" /></div>
      <div class="acts"><Menu :items="[{ label: 'Rename', icon: 'edit', run: () => edit('name') }, { label: 'Notes', icon: 'note', run: () => edit('notes') }, { label: 'Step sources', icon: 'info', hidden: !canSources, run: showSources }, { label: 'Export GPX', icon: 'download', sep: true, run: gpx, hidden: !a.route?.length }, { label: 'Delete', icon: 'trash', danger: true, sep: true, run: del }]" /></div></div>
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
    <Sheet v-if="srcs" title="Where these steps came from" @close="srcs = null">
      <p class="muted hgap">Steps each app saved to Health Connect from {{ fmt.time(a.startedAt) }} to {{ fmt.time(a.endedAt) }}. When your {{ srcWord }} has data for the whole {{ (a.name || typeName(a.type)).toLowerCase() }}, Motus uses its count.</p>
      <div v-if="srcs.error" class="empty sm"><b>Couldn't read Health Connect</b>{{ srcs.error }}<br /><button class="btn tonal" @click="showSources">Try again</button></div>
      <div v-else-if="!srcs.data" class="empty sm">Reading Health Connect…</div>
      <template v-else>
        <StepSourceRows :sources="srcs.data.sources" :phone-name="srcs.data.phoneName" :used="bandUsed ? srcs.data.used : null"
          :total="{ icon: 'steps', label: 'Counted by Motus', value: appSteps(a), used: !bandUsed, sub: stepsTyped(a) ? 'Typed by you' : a.source === 'import' ? 'From the file' : 'While recording' }" />
        <div v-if="srcReason" class="banner note spt" style="margin-bottom:0"><Icon name="info" :size="18" />{{ srcReason }}</div>
      </template>
    </Sheet>
  </div>
  <div v-else class="page"><div class="empty">Loading…</div></div>
</template>
