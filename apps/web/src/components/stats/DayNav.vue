<script setup lang="ts">
// The Calendar's month bar for Stats' days and stretches (Steps, Heart): ‹ the title › in the middle, never past today
// (atEnd), and a Today chip on the right while away from it.
import Icon from "../Icon.vue";

// unit: what one step moves, for the arrows' names ("Previous day")
defineProps<{ title: string; unit: string; atEnd: boolean; away: boolean }>();
const emit = defineEmits<{ step: [n: number]; today: [] }>();
</script>

<template>
  <div class="calnav">
    <div class="calm">
      <button class="ib sm plain" :aria-label="`Previous ${unit}`" @click="emit('step', -1)"><Icon name="left" :size="18" /></button>
      <b>{{ title }}</b>
      <button class="ib sm plain" :aria-label="`Next ${unit}`" :disabled="atEnd" @click="emit('step', 1)"><Icon name="right" :size="18" /></button>
    </div>
    <div class="calx"><button v-if="away" class="fchip acc" @click="emit('today')">Today</button></div>
  </div>
</template>
