<script setup lang="ts">
// The pull-to-refresh spinner under the top of the screen (core/pullRefresh.ts does the gesture): the arc grows and
// turns with the pull, is whole once a release would refresh, and spins while the refresh runs.
import { computed } from "vue";
import { THRESHOLD } from "../core/pullRefresh";

const props = defineProps<{ dist: number; pulling: boolean; busy: boolean; done: boolean }>();
const R = 8, C = 2 * Math.PI * R;
const p = computed(() => Math.min(1, props.dist / THRESHOLD));
// three quarters of a ring at most, like the buttons' spinner
const dash = computed(() => `${(C * 0.75 * p.value).toFixed(2)} ${C.toFixed(2)}`);
</script>

<template>
  <div class="ptr" :class="{ drag: pulling, busy, done, ready: p >= 1 }" :style="{ '--ptr': dist + 'px', '--ptrp': busy || done ? 1 : p }" aria-hidden="true">
    <svg viewBox="0 0 24 24" :style="{ rotate: `${busy || done ? 270 : p * 270}deg` }"><circle cx="12" cy="12" :r="R" :stroke-dasharray="busy || done ? `${(C * 0.75).toFixed(2)} ${C.toFixed(2)}` : dash" /></svg>
  </div>
</template>
