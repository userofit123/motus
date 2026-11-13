<script setup lang="ts">
// One labelled row of chips inside a FilterPanel. With `all`, the first chip clears the row and tapping the picked chip again
// goes back to it; without, exactly one option is always on (a status or a sort). Scrolls sideways on phones.
// Slots: #aside, a picture to the left of the chips (the muscle filter's body); the chips then stand in a grid beside it
// instead of one scrolling line, so the two read as one block.
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
/* the picture keeps its own width and the chips stand in two equal columns, centred beside it: on phones they share the
   rest of the row; wider, the columns keep a chip's width and the picture and chips stay one block centred in the panel,
   rather than chips spread thin across a wide card */
.fside { display: flex; align-items: center; gap: var(--lpy); }
.cgrid { flex: 1; min-width: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-content: center; }
html:not(.phone) .fside { justify-content: center; gap: var(--spg); }
html:not(.phone) .cgrid { flex: none; grid-template-columns: repeat(2, 136px); }
.cgrid .fchip { justify-content: center; padding-inline: var(--tdy); }
.n { opacity: .65; font-variant-numeric: tabular-nums; margin-inline-start: 2px; }
</style>
