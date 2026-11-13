<script lang="ts">
import { GROUPS } from "@motus/shared";

export interface MuscleGroup { id: string; name: string; muscles: string[] }
/** The muscles a filter value stands for: a group's muscles, or one muscle picked on the body. */
export function musclesOf(v: string, groups: MuscleGroup[] = GROUPS): string[] {
  if (!v) return [];
  return groups.find((g) => g.id === v)?.muscles ?? [v];
}
/** The filter value for one muscle: a group that is only this muscle (Core is the abdominals) stands for it, so picking it
 *  on the body lights that group's chip instead of adding a second chip that filters the same. */
export function valueOf(m: string, groups: MuscleGroup[] = GROUPS): string {
  return groups.find((g) => g.muscles.length === 1 && g.muscles[0] === m)?.id ?? m;
}
</script>

<script setup lang="ts">
// The "Muscle group" row of an exercise list's filters, with the body always shown above the chips:
// tap a muscle to show only exercises that work it as a main muscle, tap it again to clear. Groups and muscles share one
// value, so a group chip lights its muscles on the body, and a muscle picked on the body that is no chip of its own
// (lats, calves) gets a chip right after its group's, to show what is set and to clear it like any other.
import { computed } from "vue";
import { groupOf, muscleName } from "@motus/shared";
import FilterRow from "./FilterRow.vue";
import BodyMap from "./BodyMap.vue";

const props = defineProps<{ modelValue: string; groups: MuscleGroup[]; compact?: boolean }>();
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
// pressed only where a tap would clear: with a group chosen its muscles are lit, but tapping one narrows to it rather than
// clearing, so they are not "pressed" (a group of one muscle is that muscle, so it is)
const pressed = computed(() => chosen.value.filter((m) => valueOf(m, props.groups) === props.modelValue));
const tap = (m: string) => {
  const v = valueOf(m, props.groups);
  emit("update:modelValue", props.modelValue === v ? "" : v);
};
</script>

<template>
  <FilterRow :model-value="modelValue" label="Muscle group" all="All" :options="options" @update:model-value="(v) => emit('update:modelValue', v)">
    <template #top>
      <div class="mfig" :class="{ compact }">
        <BodyMap pickable :values="{}" :highlight="chosen" :pressed="pressed" :height="compact ? 110 : 150" @pick="tap" />
        <span class="tiny" :class="{ on: !!modelValue }">{{ caption }}</span>
      </div>
    </template>
  </FilterRow>
</template>

<style scoped>
/* a card of its own on the panel's --s2 shade, in the chips' --s1, the body centred in it; --lpy below it, the panel's own
   10px gap between rows at the usual density */
.mfig { display: flex; flex-direction: column; align-items: center; gap: var(--tdy); margin-bottom: var(--lpy); padding: var(--cpy) var(--cpx); border-radius: var(--r-md); background: var(--s1); }
/* on wider screens the card hugs a taller body at the row's left edge (where the label and chips start) instead of
   leaving a wide empty card around a small figure; phones keep it full width */
html:not(.phone) .mfig { width: fit-content; min-width: 240px; }
html:not(.phone) .mfig :deep(.figs) { height: 220px; }
/* compact (the phone picker sheet, where the list needs the room): a smaller body with the caption beside it */
.mfig.compact { flex-direction: row; justify-content: center; gap: var(--cpx); }
.mfig .on { color: var(--tx); font-weight: 600; }
</style>
