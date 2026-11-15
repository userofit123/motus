<script setup lang="ts">
// The Calendar's month bar for Stats' days, nights and stretches (Steps, Sleep, Heart): ‹ the title › in the middle, never past today
// (atEnd), and a Today chip on the right while away from it.
import Icon from "../Icon.vue";

// unit: what one step moves, for the arrows' names ("Previous day"); home: the chip's word, the title it brings back
// ("Today", or "Last night" on Sleep's night), so the chip and the title say the same
withDefaults(defineProps<{ title: string; unit: string; atEnd: boolean; away: boolean; home?: string }>(), { home: "Today" });
const emit = defineEmits<{ step: [n: number]; today: [] }>();
</script>

<template>
  <div class="calnav">
    <div class="calm">
      <button class="ib sm plain" :aria-label="`Previous ${unit}`" @click="emit('step', -1)"><Icon name="left" :size="18" /></button>
      <b>{{ title }}</b>
      <button class="ib sm plain" :aria-label="`Next ${unit}`" :disabled="atEnd" @click="emit('step', 1)"><Icon name="right" :size="18" /></button>
    </div>
    <div class="calx"><button v-if="away" class="fchip acc" @click="emit('today')">{{ home }}</button></div>
  </div>
</template>
