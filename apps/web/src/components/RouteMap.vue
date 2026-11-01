<script setup lang="ts">
// A route on a map (OpenStreetMap tiles). Follows the newest point while recording.
import { onMounted, onBeforeUnmount, ref, watch } from "vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const props = defineProps<{ route: number[][]; follow?: boolean }>();
const el = ref<HTMLElement | null>(null);
let map: L.Map | null = null, line: L.Polyline | null = null, dot: L.CircleMarker | null = null;
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
}
onMounted(() => {
  map = L.map(el.value!, { zoomControl: false, attributionControl: true }).setView([32.08, 34.78], 13);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
  line = L.polyline([], { color: color(), weight: 5, opacity: 0.95 }).addTo(map);
  draw();
});
watch(() => props.route.length, draw);
onBeforeUnmount(() => map?.remove());
</script>

<template><div ref="el" class="map" /></template>
