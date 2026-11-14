<script setup lang="ts">
// Recording an activity (requirement 18): any of your activity types. Those with a route (walk, run, ride…) get distance,
// pace and the map from GPS; the rest (yoga, climbing, a class) record time only. The recording itself
// lives in workout/recording.ts, so it keeps going while you use other pages (or run a workout); this page shows it and
// starts, pauses and ends it.
import { goBack } from "../core/leave";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useActivityTypes, useActive, loaded } from "../api/queries";
import { useFmt } from "../core/format";
import { confirm } from "../core/ask";
import { toast, toastError } from "../core/toast";
import { isNativeApp } from "../workout/native";
import { recording as rec, recDistM, recElapsedS, stepsLive, stepsOnScreen, stepsError, countsSteps, gpsError, here, previewLocation, previewSteps, startRecording, togglePause, finishRecording, discardRecording } from "../workout/recording";
import { clock } from "@motus/shared";
import Icon from "../components/Icon.vue";
import RouteMap from "../components/RouteMap.vue";
import ChoiceTiles from "../components/ChoiceTiles.vue";
import { newActivityType } from "../core/activityTypes";
import HeartRate from "../components/HeartRate.vue";
import { useSettings } from "../api/queries";
import { useLiveHr } from "../native/health";

const route = useRoute(), router = useRouter();
const types = useActivityTypes();
const active = useActive();
const fmt = useFmt();
const pick = ref(String(route.query.type ?? "walk"));
const slug = computed(() => rec.value?.type ?? pick.value);
const t = computed(() => (types.data.value ?? []).find((x: any) => x.slug === slug.value));
const noRoute: number[][] = [];
const gps = computed(() => t.value?.hasGps !== false);
// on foot (walk, run, hike, or a type added as on foot): the steps block is always there, and says why when it can't count
const onFoot = computed(() => (t.value ? !!t.value.hasSteps : countsSteps(slug.value)));
const stepsCounting = computed(() => !!rec.value && (stepsLive.value || rec.value.steps > 0));
const stepsNote = computed(() => (rec.value && stepsError.value) || ((rec.value ? stepsOnScreen.value : !isNativeApp()) ? "Estimated from motion while Motus is on screen" : ""));
// before you start, the map finds you (only for types with a route)
watch([gps, () => !!rec.value], ([g, r]) => previewLocation(g && !r), { immediate: true });
onBeforeUnmount(() => previewLocation(false));
// and the step counter for a type on foot (see previewSteps)
watch([() => onFoot.value, () => !!rec.value], ([f, r]) => previewSteps(f && !r), { immediate: true });
onBeforeUnmount(() => previewSteps(false));
// every type you have, the same list as logging one and goals; the last tile adds a new type and picks it
const NEW = "__new";
const tiles = computed(() => [...(types.data.value ?? []).map((x: any) => ({ value: x.slug, label: x.name, icon: x.icon })), { value: NEW, label: "New type", icon: "plus" }]);
let lastPick = pick.value;
watch(pick, async (v, old) => { if (v !== NEW) { lastPick = v; return; } pick.value = old ?? lastPick; const slug = await newActivityType(); if (slug) { await types.refetch(); pick.value = slug; } });
// a ride reads better as speed, on foot as pace (time per km or mile); nothing until there's a little distance to go on
const ride = computed(() => slug.value === "cycle" || (!!t.value && !onFoot.value));
const pace = computed(() => {
  const d = fmt.value.distNum(recDistM.value), s = recElapsedS.value;
  if (recDistM.value < 20 || !s) return null;
  return ride.value ? fmt.value.num(d / (s / 3600), 1) : clock(s / d);
});
// the band's heart rate while recording (Android app, Health Connect on): a tile from the first reading on (so the tiles
// don't move when one goes stale), and the line so far under them
const settings = useSettings();
const hr = useLiveHr(() => (rec.value ? new Date(rec.value.startedAt).toISOString() : null), () => !!rec.value && !!settings.value.features.healthConnect);
const hrLatest = hr.latest, hrSamples = hr.samples;
const busy = ref(false);
async function finish() {
  busy.value = true;
  try { const name = t.value?.name ?? "Activity"; const id = await finishRecording(); toast(`${name} saved`); router.replace(`/activities/${id}`); }
  catch (e) { toastError(e); } finally { busy.value = false; }
}
async function discard() { if (await confirm("Discard this recording?", { ok: "Discard", danger: true, noHistory: true })) { discardRecording(); router.back(); } }
// show the page once its data is in, all at once
await loaded(types, active);
</script>

<template>
  <div class="page">
    <button class="back" @click="goBack(router, '/')"><Icon name="left" :size="16" /><span>Back</span></button>
    <div class="ph"><div><h1>{{ t?.name ?? "Activity" }}</h1><div class="sub">{{ rec ? (rec.pauseAt ? "Paused" : "Recording") : "Ready" }}{{ gps && gpsError ? " · " + gpsError : "" }}</div></div></div>
    <ChoiceTiles v-if="!rec" v-model="pick" class="hgap" :options="tiles" compact min="110px" label="Activity" />
    <p v-if="!rec && active.data.value" class="tiny hgap">Your workout keeps going while you record. Each has its own bar at the bottom of the screen.</p>
    <RouteMap v-if="gps" :route="rec?.route ?? noRoute" :here="here" follow />
    <div class="grid rs spt">
      <div class="card stat hero"><div class="lbl">Time</div><div class="val">{{ clock(recElapsedS) }}</div></div>
      <div v-if="gps" class="card stat"><div class="lbl">Distance</div><div class="val">{{ fmt.num(fmt.distNum(recDistM), 2) }}<small>{{ fmt.du }}</small></div></div>
      <div v-if="gps" class="card stat"><div class="lbl">{{ ride ? "Speed" : "Pace" }}</div><div class="val">{{ pace ?? "-" }}<small v-if="pace">{{ ride ? `${fmt.du}/h` : `/${fmt.du}` }}</small></div></div>
      <div v-if="onFoot" class="card stat"><div class="lbl">Steps</div><div class="val">{{ stepsCounting ? fmt.num(rec!.steps, 0) : "-" }}</div><div v-if="stepsNote" class="sub">{{ stepsNote }}</div></div>
      <div v-if="hrSamples.length" class="card stat"><div class="lbl">Heart rate</div><div class="val">{{ hrLatest ? hrLatest.bpm : "-" }}<small v-if="hrLatest">bpm</small></div><div class="sub">{{ hrLatest ? hrLatest.ago : "Waiting for the band" }}</div></div>
    </div>
    <HeartRate v-if="hrSamples.length > 1" chart class="spt" :hr="hrSamples" />
    <div class="row spt" style="justify-content:center">
      <button v-if="!rec" class="btn lg" @click="startRecording(pick)"><Icon name="play" />Start</button>
      <template v-else>
        <button class="btn o lg" @click="togglePause"><Icon :name="rec.pauseAt ? 'play' : 'pause'" />{{ rec.pauseAt ? "Resume" : "Pause" }}</button>
        <button class="btn lg" :disabled="busy" @click="finish"><Icon name="check" />Finish</button>
        <button class="qb danger" @click="discard">Discard</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* as many across as fit, never narrower than a pace or a long time needs, so nothing is cut off */
.rs { grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr)); }
.rs .stat { min-height: 0; }
.rs .val { font-size: clamp(22px, 6.4vw, var(--fs-val)); font-variant-numeric: tabular-nums; white-space: nowrap; }
.rs .val small { font-size: 13px; }
</style>
