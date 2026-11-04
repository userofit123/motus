<script setup lang="ts">
// A route on a map (OpenStreetMap tiles). Follows the newest point while recording; `here` is where you are now,
// with a ring for how sure the phone is of it, so the map shows you before the route begins.
import { onMounted, onBeforeUnmount, ref, watch } from "vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const props = defineProps<{ route: number[][]; follow?: boolean; here?: { lat: number; lon: number; acc: number } | null }>();
const el = ref<HTMLElement | null>(null);
let map: L.Map | null = null, line: L.Polyline | null = null, dot: L.CircleMarker | null = null, ring: L.Circle | null = null, centred = false;
const color = () => getComputedStyle(document.documentElement).getPropertyValue("--acc").trim() || "#f8b396";
function draw() {
  if (!map) return;
  const pts = props.route.map((p) => [p[0], p[1]] as [number, number]);
  line?.setLatLngs(pts);
  if (pts.length) {
    const last = pts.at(-1)!;
    if (!dot) dot = L.circleMarker(last, { radius: 7, color: "#fff", weight: 2, fillColor: color(), fillOpacity: 1 }).addTo(map); else dot.setLatLng(last);
    if (props.follow) map.setView(last, Math.max(map.getZoom(), 16)); else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [24, 24] }); else map.setView(last, 16);
  }
  drawHere(!pts.length);
}
function drawHere(lead: boolean) {
  const h = props.here;
  if (!map || !h) return;
  const at: [number, number] = [h.lat, h.lon];
  if (!ring) ring = L.circle(at, { radius: h.acc, color: color(), weight: 1, opacity: 0.5, fillColor: color(), fillOpacity: 0.12, interactive: false }).addTo(map);
  else ring.setLatLng(at).setRadius(h.acc);
  // with no route yet, the dot is you; once there is one, the route's own dot marks its end
  if (lead) {
    if (!dot) dot = L.circleMarker(at, { radius: 7, color: "#fff", weight: 2, fillColor: color(), fillOpacity: 1 }).addTo(map); else dot.setLatLng(at);
    if (!centred || props.follow) { map.setView(at, Math.max(map.getZoom(), 16)); centred = true; }
  }
}
onMounted(() => {
  map = L.map(el.value!, { zoomControl: false, attributionControl: true }).setView([32.08, 34.78], 13);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
  line = L.polyline([], { color: color(), weight: 5, opacity: 0.95 }).addTo(map);
  draw();
});
watch(() => props.route.length, draw);
watch(() => props.here, () => drawHere(!props.route.length));
onBeforeUnmount(() => map?.remove());
</script>

<template><div ref="el" class="map" /></template>
