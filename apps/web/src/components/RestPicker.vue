<script setup lang="ts">
// Choosing a rest time: common presets, or any minutes and seconds.
import { ref } from "vue";
import { clock } from "@motus/shared";
import Sheet from "./Sheet.vue";

const props = defineProps<{ title: string; value: number | null; defaultLabel?: string; presets?: number[] }>();
const emit = defineEmits<{ close: []; pick: [v: number | null] }>();
const P = props.presets ?? [0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];
const m = ref(Math.floor((props.value ?? 90) / 60)), sec = ref((props.value ?? 90) % 60);
</script>

<template>
  <Sheet :title="title" @close="emit('close')">
    <div class="chips" style="margin-bottom:14px">
      <button v-if="defaultLabel" class="fchip" :class="{ on: value == null }" @click="emit('pick', null)">{{ defaultLabel }}</button>
      <button v-for="p in P" :key="p" class="fchip" :class="{ on: value === p }" @click="emit('pick', p)">{{ p === 0 ? "No rest" : clock(p) }}</button>
    </div>
    <div class="row"><input v-model.number="m" class="in" type="number" min="0" max="59" style="width:80px" /><span>min</span><input v-model.number="sec" class="in" type="number" min="0" max="59" step="5" style="width:80px" /><span>s</span></div>
    <template #foot><button class="btn o" @click="emit('close')">Cancel</button><button class="btn" @click="emit('pick', (m || 0) * 60 + (sec || 0))">Set</button></template>
  </Sheet>
</template>
