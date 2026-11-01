<script setup lang="ts">
// A calm, simplified body (front and back): each muscle is tinted by how much it was worked.
// values: muscle name (as in the exercise library) → amount; the busiest muscle gets the full accent colour.
import { computed } from "vue";

const props = defineProps<{ values: Record<string, number>; max?: number; height?: number; highlight?: string[]; secondary?: string[] }>();
type Shape = { m: string; d?: string; e?: [number, number, number, number]; r?: [number, number, number, number, number] };
const E = (m: string, cx: number, cy: number, rx: number, ry: number, mirror = true): Shape[] => mirror ? [{ m, e: [cx, cy, rx, ry] }, { m, e: [100 - cx, cy, rx, ry] }] : [{ m, e: [cx, cy, rx, ry] }];
const FRONT: Shape[] = [
  { m: "neck", r: [45, 24, 10, 7, 3] },
  ...E("shoulders", 31, 40, 7.5, 7), ...E("chest", 42, 47, 8.5, 7), ...E("biceps", 26.5, 58, 4.5, 9), ...E("forearms", 22.5, 79, 4, 10.5),
  { m: "abdominals", r: [43, 56, 14, 30, 6] }, ...E("abductors", 35.5, 94, 3.5, 7), ...E("adductors", 47.6, 104, 2.4, 9),
  ...E("quadriceps", 41.5, 118, 6.5, 18), ...E("calves", 41.5, 160, 4.8, 14),
];
const BACK: Shape[] = [
  { m: "traps", d: "M40 30 Q50 25 60 30 L64 38 Q50 44 36 38 Z" },
  ...E("shoulders", 31, 40, 7.5, 7), { m: "middle back", r: [44, 41, 12, 17, 4] }, ...E("lats", 38.5, 58, 6, 12), { m: "lower back", r: [44, 61, 12, 17, 5] },
  ...E("triceps", 26.5, 58, 4.5, 9), ...E("forearms", 22.5, 79, 4, 10.5), ...E("glutes", 43, 93, 7.5, 8.5),
  ...E("hamstrings", 41.5, 120, 6.5, 17), ...E("calves", 41.5, 158, 5.5, 14),
];
const SIL = "M50 3a11 11 0 0 1 0 22a11 11 0 0 1 0-22zM36 30h28q10 2 12 12l5 38q2 10-1 18l-4-1-4-30-2 14v20l-3 70-2 14h-7l-1-14-2-60-2 60-1 14h-7l-2-14-3-70V92l-2-14-4 30-4 1q-3-8-1-18l5-38q2-10 12-12z";

const top = computed(() => props.max ?? Math.max(1, ...Object.values(props.values)));
function fill(m: string) {
  if (props.highlight) return props.highlight.includes(m) ? "var(--acc)" : props.secondary?.includes(m) ? "color-mix(in srgb, var(--acc) 40%, var(--s2))" : undefined;
  const v = props.values[m] ?? 0;
  if (!v) return undefined;
  const pct = Math.round(25 + 75 * Math.min(1, v / top.value));
  return `color-mix(in srgb, var(--acc) ${pct}%, var(--s2))`;
}
const label = (m: string) => `${m}${props.values[m] ? ": " + Math.round(props.values[m]! * 10) / 10 : ""}`;
</script>

<template>
  <div class="bodymap" :style="{ height: (height ?? 200) + 'px' }">
    <svg v-for="(shapes, i) in [FRONT, BACK]" :key="i" viewBox="0 0 100 180" role="img" :aria-label="i ? 'Back' : 'Front'">
      <path class="sil" :d="SIL" />
      <template v-for="(s, j) in shapes" :key="j">
        <ellipse v-if="s.e" class="m" :cx="s.e[0]" :cy="s.e[1]" :rx="s.e[2]" :ry="s.e[3]" :style="{ fill: fill(s.m) }"><title>{{ label(s.m) }}</title></ellipse>
        <rect v-else-if="s.r" class="m" :x="s.r[0]" :y="s.r[1]" :width="s.r[2]" :height="s.r[3]" :rx="s.r[4]" :style="{ fill: fill(s.m) }"><title>{{ label(s.m) }}</title></rect>
        <path v-else class="m" :d="s.d" :style="{ fill: fill(s.m) }"><title>{{ label(s.m) }}</title></path>
      </template>
    </svg>
  </div>
</template>
