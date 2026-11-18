<script setup lang="ts">
// A score's number with its word beside it and its ring on the right: Home's score blocks (Readiness and the health
// scores), Stats → Scores' blocks and a night's own sleep score (Stats → Sleep). The number is a .big value, so it takes
// the app's shared rules for one (app.css; right-aligned in Hebrew, lighter word on a reached goal's coloured tile).
// warn: the word that turns the ring the warning colour (Low, Take it easy)
import Ring from "../Ring.vue";
defineProps<{ score: number; label?: string | null; warn?: boolean }>();
</script>

<template>
  <div class="row"><div class="big grow">{{ score }}<small v-if="label">{{ label }}</small></div><Ring :pct="score / 100" :size="40" :color="warn ? 'var(--warn)' : undefined" /></div>
</template>
