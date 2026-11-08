<script setup lang="ts">
// One workout setting from core/workoutPrefs.ts, as a switch or a choice, the same on Settings and in the popup.
// `local` marks a value set for this workout only.
import type { PrefRow } from "../core/workoutPrefs";
import AppSelect from "./AppSelect.vue";

defineProps<{ row: PrefRow; value: unknown; local?: boolean }>();
const emit = defineEmits<{ set: [v: unknown] }>();
</script>

<template>
  <div v-if="row.options" class="li"><div class="grow"><div class="t">{{ row.label }}<span v-if="local" class="mchip pr-chip">this workout</span></div><div v-if="row.hint" class="s">{{ row.hint }}</div></div>
    <AppSelect :model-value="value" :options="row.options" :title="row.label" style="width:auto" @update:model-value="(v) => emit('set', v)" /></div>
  <label v-else class="tgl"><div class="grow"><div class="t">{{ row.label }}<span v-if="local" class="mchip pr-chip">this workout</span></div><div v-if="row.hint" class="s">{{ row.hint }}</div></div>
    <span class="tg"><input type="checkbox" :checked="!!value" @change="emit('set', ($event.target as HTMLInputElement).checked)" /></span></label>
</template>

<style scoped>
.pr-chip { margin-inline-start: 6px; }
</style>
