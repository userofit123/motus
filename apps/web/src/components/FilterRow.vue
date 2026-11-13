<script setup lang="ts">
// One labelled row of chips inside a FilterPanel. With `all`, the first chip clears the row and tapping the picked chip again
// goes back to it; without, exactly one option is always on (a status or a sort). Scrolls sideways on phones.
// Slots: #aside, a picture for the chips: on desktop it stands left of the chips (a two-column grid beside it); on phones
// it is a full-width tile above them, the chips in three equal columns below, so the block reads as one.
import Icon from "./Icon.vue";

interface FilterOption { value: string; label: string; icon?: string; count?: number }
const props = defineProps<{ label: string; options?: FilterOption[]; all?: string; modelValue?: string }>();
const emit = defineEmits<{ "update:modelValue": [v: string] }>();
const pick = (v: string) => emit("update:modelValue", props.all != null && props.modelValue === v ? "" : v);
</script>

<template>
  <div>
    <div class="flbl">{{ label }}</div>
    <div :class="{ fside: !!$slots.aside }">
      <slot name="aside" />
      <div class="chips" :class="$slots.aside ? 'cgrid' : 'hscroll'">
        <button v-if="all != null" class="fchip" :class="{ on: !modelValue }" @click="emit('update:modelValue', '')">{{ all }}</button>
        <slot>
          <button v-for="o in options" :key="o.value" class="fchip" :class="{ on: modelValue === o.value }" @click="pick(o.value)">
            <Icon v-if="o.icon" :name="o.icon" :size="14" />{{ o.label }}<span v-if="o.count != null" class="n">{{ o.count }}</span>
          </button>
        </slot>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* chips run to the panel's edge while scrolling on phones; on wider screens they wrap */
.chips.hscroll { margin-inline: calc(-1 * var(--cpx)); padding-inline: var(--cpx); }
html:not(.phone) .chips.hscroll { margin-inline: 0; padding-inline: 0; }
/* the picture sits above the chips on phones (three equal columns, labels centred) and left of them on desktop (two columns as wide
   as the longest label, so the chips follow the density). On desktop the picture stretches to the grid's height, so a third
   chip row never makes it jump */
.fside { display: flex; flex-direction: column; gap: var(--lpy); }
.cgrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-content: center; }
.cgrid .fchip { justify-content: center; }
html:not(.phone) .fside { flex-direction: row; align-items: stretch; gap: var(--spg); }
html:not(.phone) .cgrid { grid-template-columns: repeat(2, max-content); }
.n { opacity: .65; font-variant-numeric: tabular-nums; margin-inline-start: 2px; }
</style>
