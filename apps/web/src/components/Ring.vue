<script setup lang="ts">
// A progress ring (goals, rest timer). done: the full ring also holds a thin check, so a reached goal reads at a glance.
// Without a colour the arc and the check are painted in the accent, from --acc to --acc2 like the app's other accent
// fills (+ button, progress bars); a theme without a gradient has both the same, so it reads as one solid accent.
import { useId } from "vue";
import Icon from "./Icon.vue";
const props = defineProps<{ pct: number; size?: number; stroke?: number; color?: string; done?: boolean }>();
const S = props.size ?? 44, W = props.stroke ?? 5, R = (S - W) / 2, C = 2 * Math.PI * R;
// the check fills a little over half the hole; the svg is turned so the ring starts at the top, and the check is turned back
const K = Math.round((S - 2 * W) * 0.56);
// each ring needs its own gradient ids, or every ring on the page would paint with the first one's
const id = useId();
const paint = (part: string) => props.color ?? `url(#${id}-${part})`;
</script>

<template>
  <svg class="ring" :width="S" :height="S" :viewBox="`0 0 ${S} ${S}`" style="transform:rotate(-90deg)">
    <defs v-if="!color">
      <!-- the svg is turned a quarter left, so these run top-left to bottom-right on screen, like the app's 135deg fills -->
      <linearGradient :id="`${id}-arc`" x1="1" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--acc)" /><stop offset="1" style="stop-color:var(--acc2)" /></linearGradient>
      <!-- the check is turned back upright, so its gradient runs the plain way -->
      <linearGradient :id="`${id}-chk`" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--acc)" /><stop offset="1" style="stop-color:var(--acc2)" /></linearGradient>
    </defs>
    <circle :cx="S / 2" :cy="S / 2" :r="R" fill="none" stroke="var(--s2)" :stroke-width="W" />
    <circle :cx="S / 2" :cy="S / 2" :r="R" fill="none" :stroke="paint('arc')" :stroke-width="W" stroke-linecap="round" :stroke-dasharray="C" :stroke-dashoffset="C * (1 - Math.max(0, Math.min(1, done ? 1 : pct)))" style="transition:stroke-dashoffset .5s" />
    <g v-if="done" :transform="`rotate(90 ${S / 2} ${S / 2}) translate(${(S - K) / 2} ${(S - K) / 2})`"><Icon class="rchk" name="check" :size="K" :style="{ stroke: paint('chk') }" /></g>
  </svg>
</template>

<style scoped>
/* thinner than the app's 1.8 icon line, so the check sits lightly inside the ring's thick stroke */
.rchk { stroke-width: 1.5; }
</style>
