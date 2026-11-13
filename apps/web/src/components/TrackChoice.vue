<script setup lang="ts">
// What an exercise tracks, as its two choices: what each set is counted by, and the weight that goes with it (only the
// kinds that apply to that way of counting). Used by "Track by" and by the exercise editor.
import { computed } from "vue";
import { COUNTED_BY, trackingFrom, trackingParts, weightKindsFor, type CountedBy, type Tracking, type WeightKind } from "@motus/shared";
import ChoiceTiles from "./ChoiceTiles.vue";

const props = defineProps<{ modelValue: Tracking }>();
const emit = defineEmits<{ "update:modelValue": [t: Tracking] }>();
const parts = computed(() => trackingParts(props.modelValue));
const weights = computed(() => weightKindsFor(parts.value.counted));
const setCounted = (c: CountedBy) => emit("update:modelValue", trackingFrom(c, parts.value.weight));
const setWeight = (w: WeightKind) => emit("update:modelValue", trackingFrom(parts.value.counted, w));
</script>

<template>
  <div class="fld trk"><label>Counted by</label><ChoiceTiles :model-value="parts.counted" :options="COUNTED_BY" compact :cols="2" label="Counted by" @update:model-value="setCounted" /></div>
  <div class="fld"><label>Weight</label><ChoiceTiles :model-value="parts.weight" :options="weights" compact :cols="2" label="Weight" @update:model-value="setWeight" /></div>
</template>

<style scoped>
/* two even columns at every width; an odd last tile ("Reps + time") takes the whole row instead of half of it */
.trk :deep(.ct > button:last-child:nth-child(odd)) { grid-column: 1 / -1; }
</style>
