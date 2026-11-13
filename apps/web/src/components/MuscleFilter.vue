<script lang="ts">
import { ref } from "vue";
import { GROUPS } from "@motus/shared";

export interface MuscleGroup { id: string; name: string; muscles: string[] }
/** The muscles a filter value stands for: a group's muscles, or one muscle picked on the body. */
export function musclesOf(v: string, groups: MuscleGroup[] = GROUPS): string[] {
  if (!v) return [];
  return groups.find((g) => g.id === v)?.muscles ?? [v];
}
// shown or hidden for the whole session, on every exercise list alike
const open = ref(false);
</script>

<script setup lang="ts">
// The "Muscle group" row of an exercise list's filters, with the body behind a small toggle in its label line:
// tap a muscle to show only exercises that work it as a main muscle, tap it again to clear. Groups and muscles share one
// value, so a group chip lights its muscles on the body, and a muscle picked on the body that is no chip of its own
// (lats, calves) gets a chip right after its group's, to show what is set and to clear it like any other.
import { computed } from "vue";
import { groupOf, muscleName } from "@motus/shared";
import FilterRow from "./FilterRow.vue";
import BodyMap from "./BodyMap.vue";
import Icon from "./Icon.vue";

const props = defineProps<{ modelValue: string; groups: MuscleGroup[] }>();
const emit = defineEmits<{ "update:modelValue": [v: string] }>();
const chosen = computed(() => musclesOf(props.modelValue, props.groups));
const options = computed(() => {
  const opts = props.groups.map((g) => ({ value: g.id, label: g.name }));
  const v = props.modelValue;
  if (!v || props.groups.some((g) => g.id === v)) return opts;
  // after the last chip inside the muscle's own group (Arms, Biceps, Triceps, then Forearms)
  const home = GROUPS.find((g) => g.id === groupOf(v))?.muscles ?? [];
  const at = props.groups.reduce((i, g, j) => (g.muscles.every((m) => home.includes(m)) ? j : i), opts.length - 1);
  opts.splice(at + 1, 0, { value: v, label: muscleName(v) });
  return opts;
});
const caption = computed(() => {
  const v = props.modelValue;
  return !v ? "Tap a muscle" : props.groups.find((g) => g.id === v)?.name ?? muscleName(v);
});
const tap = (m: string) => emit("update:modelValue", props.modelValue === m ? "" : m);
</script>

<template>
  <FilterRow :model-value="modelValue" label="Muscle group" all="All" :options="options" @update:model-value="(v) => emit('update:modelValue', v)">
    <template #aside>
      <button class="qb" :aria-expanded="open" @click="open = !open">{{ open ? "Hide body" : "Show body" }}<Icon :name="open ? 'up' : 'down'" :size="14" /></button>
    </template>
    <template #top>
      <div v-if="open" class="mfig">
        <BodyMap pickable :values="{}" :highlight="chosen" :height="150" @pick="tap" />
        <span class="tiny" :class="{ on: !!modelValue }">{{ caption }}</span>
      </div>
    </template>
  </FilterRow>
</template>

<style scoped>
/* a card of its own inside the shaded filter panel, like the chips (on --s1), the body centred */
.mfig { display: flex; flex-direction: column; align-items: center; gap: var(--tdy); margin-bottom: 10px; /* the panel's gap between rows */ padding: var(--cpy) var(--cpx); border-radius: var(--r-md); background: var(--s1); }
.mfig .on { color: var(--tx); font-weight: 600; }
</style>
