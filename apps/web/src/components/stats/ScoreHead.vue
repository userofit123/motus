<script setup lang="ts">
// A score's number with its word beside it and its ring, as Home's score blocks show theirs: Stats → Scores' blocks and a
// night's own sleep score (Stats → Sleep). warn: the word that turns the ring the warning colour (Low, Take it easy)
import Ring from "../Ring.vue";
// small: the number at a hero's size under a bigger one (a night's score under its hours asleep, .gs-val)
defineProps<{ score: number; label?: string | null; warn?: boolean; small?: boolean }>();
</script>

<template>
  <div class="row"><div class="sch grow" :class="{ sm: small }">{{ score }}<small v-if="label">{{ label }}</small></div><Ring :pct="score / 100" :size="40" :color="warn ? 'var(--warn)' : undefined" /></div>
</template>

<style scoped>
/* as Home's .big */
.sch { font-size: var(--fs-val); font-weight: 650; letter-spacing: -.8px; line-height: 1.1; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sch.sm { font-size: 26px; letter-spacing: -.4px; }
.sch small { font-size: var(--fs); font-weight: 500; margin-inline-start: 5px; color: var(--tx2); letter-spacing: 0; }
</style>
