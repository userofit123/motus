<script setup lang="ts">
// Recording a walk, run or ride (requirement 18): time, distance, pace and the route on a map.
// The points are saved on this device as they come in, so closing the app never loses a walk. In a browser it records
// while the page is open; the Android app keeps recording with the screen off.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useActivityTypes } from "../api/queries";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { readJson, writeJson } from "../core/prefs";
import { useFmt } from "../core/format";
import { confirm } from "../core/ask";
import { toast, toastError } from "../core/toast";
import { keepAwake } from "../workout/native";
import { clock } from "@motus/shared";
import Icon from "../components/Icon.vue";
import RouteMap from "../components/RouteMap.vue";

const route = useRoute(), router = useRouter();
const types = useActivityTypes();
const fmt = useFmt();
interface Rec { type: string; startedAt: number; route: number[][]; pausedMs: number; pauseAt: number | null; running: boolean }
const KEY = "motusRecording";
const rec = ref<Rec>(readJson<Rec | null>(KEY, null) ?? { type: String(route.query.type ?? "walk"), startedAt: 0, route: [], pausedMs: 0, pauseAt: null, running: false });
const save = () => writeJson(KEY, rec.value);
const now = ref(Date.now());
let watchId: number | null = null, tick: ReturnType<typeof setInterval> | null = null;
const R = 6371000, rad = (d: number) => (d * Math.PI) / 180;
const hav = (a: number[], b: number[]) => { const dLat = rad(b[0]! - a[0]!), dLon = rad(b[1]! - a[1]!); const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0]!)) * Math.cos(rad(b[0]!)) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const dist = computed(() => rec.value.route.reduce((t, p, i, a) => (i ? t + hav(a[i - 1]!, p) : 0), 0));
const elapsed = computed(() => rec.value.startedAt ? Math.max(0, ((rec.value.pauseAt ?? now.value) - rec.value.startedAt - rec.value.pausedMs) / 1000) : 0);
const gpsError = ref("");
function startGps() {
  if (!("geolocation" in navigator)) { gpsError.value = "Location is not available here"; return; }
  watchId = navigator.geolocation.watchPosition((p) => {
    if (!rec.value.running || rec.value.pauseAt) return;
    if (p.coords.accuracy > 40) return; // ignore rough fixes
    const pt = [p.coords.latitude, p.coords.longitude, Math.round(p.timestamp / 1000), p.coords.altitude ?? undefined] as number[];
    const last = rec.value.route.at(-1);
    if (last && hav(last, pt) < 3) return; // standing still
    rec.value.route.push(pt); save();
  }, (e) => (gpsError.value = e.code === 1 ? "Allow location to record the route" : "Looking for GPS…"), { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
}
function start() { rec.value = { ...rec.value, startedAt: Date.now(), route: [], pausedMs: 0, pauseAt: null, running: true }; save(); startGps(); keepAwake(true); }
function pause() { if (rec.value.pauseAt) { rec.value.pausedMs += Date.now() - rec.value.pauseAt; rec.value.pauseAt = null; } else rec.value.pauseAt = Date.now(); save(); }
async function finish() {
  try {
    const end = rec.value.pauseAt ?? Date.now();
    const r = await api.post("/activities", { type: rec.value.type, startedAt: new Date(rec.value.startedAt).toISOString(), endedAt: new Date(end).toISOString(), durationS: Math.round(elapsed.value), route: rec.value.route, source: "gps", clientId: `gps:${rec.value.startedAt}` });
    localStorage.removeItem(KEY); keepAwake(false);
    invalidate(["activities", "stats", "goals", "home", "calendar"]); toast("Saved");
    router.replace(`/activities/${r.id}`);
  } catch (e) { toastError(e); }
}
async function discard() { if (await confirm("Discard this recording?", { ok: "Discard", danger: true })) { localStorage.removeItem(KEY); keepAwake(false); router.back(); } }
onMounted(() => { tick = setInterval(() => (now.value = Date.now()), 1000); if (rec.value.running) { startGps(); keepAwake(true); } });
onBeforeUnmount(() => { if (watchId != null) navigator.geolocation.clearWatch(watchId); if (tick) clearInterval(tick); });
const t = computed(() => (types.data.value ?? []).find((x: any) => x.slug === rec.value.type));
</script>

<template>
  <div class="page">
    <button class="back" @click="router.back()"><Icon name="left" :size="16" />Back</button>
    <div class="ph"><div><h1>{{ t?.name ?? "Activity" }}</h1><div class="sub">{{ rec.running ? (rec.pauseAt ? "Paused" : "Recording") : "Ready" }}{{ gpsError ? " · " + gpsError : "" }}</div></div></div>
    <div v-if="!rec.running" class="chips" style="margin-bottom:12px"><button v-for="x in (types.data.value ?? []).filter((y: any) => y.hasGps)" :key="x.slug" class="fchip" :class="{ on: rec.type === x.slug }" @click="rec.type = x.slug"><Icon :name="x.icon" :size="15" />{{ x.name }}</button></div>
    <RouteMap :route="rec.route" follow />
    <div class="grid g3" style="margin-top:var(--spg)">
      <div class="card stat hero"><div class="lbl">Time</div><div class="val">{{ clock(elapsed) }}</div></div>
      <div class="card stat"><div class="lbl">Distance</div><div class="val">{{ fmt.num(fmt.distNum(dist), 2) }}<small>{{ fmt.du }}</small></div></div>
      <div class="card stat"><div class="lbl">Pace</div><div class="val" style="font-size:26px">{{ fmt.pace(elapsed, dist) || "–" }}</div></div>
    </div>
    <div class="row" style="margin-top:var(--spg);justify-content:center">
      <button v-if="!rec.running" class="btn lg" @click="start"><Icon name="play" />Start</button>
      <template v-else>
        <button class="btn o lg" @click="pause"><Icon :name="rec.pauseAt ? 'play' : 'pause'" />{{ rec.pauseAt ? "Resume" : "Pause" }}</button>
        <button class="btn lg" @click="finish"><Icon name="check" />Finish</button>
        <button class="qb danger" @click="discard">Discard</button>
      </template>
    </div>
  </div>
</template>
