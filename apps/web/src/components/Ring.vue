<script setup lang="ts">
// A progress ring (weekly goal, rest timer). done: the full ring also holds a thin check, so a reached goal reads at a glance.
import Icon from "./Icon.vue";
const props = defineProps<{ pct: number; size?: number; stroke?: number; color?: string; done?: boolean }>();
const S = props.size ?? 44, W = props.stroke ?? 5, R = (S - W) / 2, C = 2 * Math.PI * R;
// the check fills a little over half the hole; the svg is turned so the ring starts at the top, and the check is turned back
const K = Math.round((S - 2 * W) * 0.56);
</script>

<template>
  <svg class="ring" :width="S" :height="S" :viewBox="`0 0 ${S} ${S}`" style="transform:rotate(-90deg)">
    <circle :cx="S / 2" :cy="S / 2" :r="R" fill="none" stroke="var(--s2)" :stroke-width="W" />
    <circle :cx="S / 2" :cy="S / 2" :r="R" fill="none" :stroke="color ?? 'var(--acc)'" :stroke-width="W" stroke-linecap="round" :stroke-dasharray="C" :stroke-dashoffset="C * (1 - Math.max(0, Math.min(1, done ? 1 : pct)))" style="transition:stroke-dashoffset .5s" />
    <g v-if="done" :transform="`rotate(90 ${S / 2} ${S / 2}) translate(${(S - K) / 2} ${(S - K) / 2})`" :style="{ color: color ?? 'var(--acc)' }"><Icon class="rchk" name="check" :size="K" /></g>
  </svg>
</template>

<style scoped>
/* thinner than the app's 1.8 icon line, so the check sits lightly inside the ring's thick stroke */
.rchk { stroke-width: 1.5; }
</style>
