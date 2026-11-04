<script setup lang="ts">
// Choosing a rest time: common presets, or any minutes and seconds. A preset only selects; Set saves, Cancel or Back
// leaves things as they were.
import { computed, ref } from "vue";
import { clock } from "@motus/shared";
import Sheet from "./Sheet.vue";
import ChoiceTiles from "./ChoiceTiles.vue";

const props = defineProps<{ title: string; value: number | null; defaultLabel?: string; presets?: number[] }>();
const emit = defineEmits<{ close: []; pick: [v: number | null] }>();
const P = props.presets ?? [0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];
const m = ref(Math.floor((props.value ?? 90) / 60)), sec = ref((props.value ?? 90) % 60);
// null: the default (no time of its own)
const useDefault = ref(props.value == null && !!props.defaultLabel);
const total = computed(() => (m.value || 0) * 60 + (sec.value || 0));
function preset(p: number | "def") { if (p === "def") { useDefault.value = true; return; } m.value = Math.floor(p / 60); sec.value = p % 60; useDefault.value = false; }
// the presets as one even grid, the default (often a longer label, "def" here) on its own row above; a typed time that
// is not a preset leaves none chosen
const opts = P.map((p) => ({ value: p, label: p === 0 ? "No rest" : clock(p) }));
const picked = computed(() => (useDefault.value ? "def" : total.value));
</script>

<template>
  <Sheet :title="title" @close="emit('close')">
    <ChoiceTiles v-if="defaultLabel" :model-value="picked" :options="[{ value: 'def', label: defaultLabel }]" compact :cols="1" style="margin-bottom:8px" @update:model-value="preset" />
    <ChoiceTiles :model-value="picked" :options="opts" compact min="76px" label="Presets" style="margin-bottom:14px" @update:model-value="preset" />
    <div class="row" :style="{ opacity: useDefault ? 0.5 : 1 }"><input v-model.number="m" class="in" type="number" min="0" max="59" style="width:80px" @input="useDefault = false" /><span>min</span><input v-model.number="sec" class="in" type="number" min="0" max="59" step="5" style="width:80px" @input="useDefault = false" /><span>s</span></div>
    <template #foot><button class="btn o" @click="emit('close')">Cancel</button><button class="btn" @click="emit('pick', useDefault ? null : total)">Set</button></template>
  </Sheet>
</template>
