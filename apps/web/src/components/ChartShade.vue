<script setup lang="ts">
// A session's span behind a chart's data (chartShade.ts says why it looks so): tinted in its colour with a 3px strip
// along the top; without a colour the theme's quiet accent tint (.chart .shd) with rounded corners and no strip, and
// soft: a coloured span without its strip (a quieter span, a workout's rests). fill: the span drawn another way (the
// Calendar day's timeline hatches its spans so they never read as one of the night's stage rows).
import { shadeFill } from "./chartShade";

defineProps<{ x: number; w: number; y: number; h: number; color?: string; soft?: boolean; fill?: string }>();
</script>

<template>
  <rect class="shd" :x="x" :y="y" :width="w" :height="h" :rx="color ? 0 : 3" :style="color ? { fill: fill ?? shadeFill(color) } : undefined" />
  <rect v-if="color && !soft" :x="x" :y="y" :width="w" height="3" rx="1.5" :style="{ fill: color }" />
</template>
