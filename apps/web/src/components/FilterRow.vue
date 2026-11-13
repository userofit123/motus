<script setup lang="ts">
// One labelled row of chips inside a FilterPanel. With `all`, the first chip clears the row and tapping the picked chip again
// goes back to it; without, exactly one option is always on (a status or a sort). Scrolls sideways on phones.
// Slots: #aside, a picture for the chips: on desktop it stands left of the chips (a two-column grid beside it); on phones
// it is a full-width tile above them, the chips in the same sideways row as every other filter row.
// fold (with v-model:open): the label becomes a fold button that hides the picture (never the chips), as the Routines
// folder headers fold their folders; for a picture too big to keep on a phone screen with the list. `open` is the user's own
// choice (the chevron shows it); `shown`, when given, is whether the picture is in view right now (a search can hide it).
import { onMounted, ref, watch } from "vue";
import Icon from "./Icon.vue";
import Collapse from "./Collapse.vue";
import { isPhone } from "../core/device";

interface FilterOption { value: string; label: string; icon?: string; count?: number }
const props = defineProps<{ label: string; options?: FilterOption[]; all?: string; modelValue?: string; fold?: boolean; open?: boolean; shown?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [v: string]; "update:open": [v: boolean] }>();
const pick = (v: string) => emit("update:modelValue", props.all != null && props.modelValue === v ? "" : v);
// the picked chip can sit past the edge of a sideways row (folded on a phone the row is all that says what is set), so
// it is brought into view sideways only: scrollIntoView would also move the page or the sheet up and down
const row = ref<HTMLElement>();
function reveal(smooth: boolean) {
  const el = row.value, chip = el?.querySelector<HTMLElement>(".fchip.on");
  if (!el || !chip || el.scrollWidth <= el.clientWidth) return;
  const box = el.getBoundingClientRect(), r = chip.getBoundingClientRect(), cs = getComputedStyle(el);
  const pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0;
  const dx = r.left < box.left + pl ? r.left - box.left - pl : r.right > box.right - pr ? r.right - box.right + pr : 0;
  if (dx) el.scrollBy({ left: dx, behavior: smooth && !matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto" });
}
onMounted(() => reveal(false));
watch(() => props.modelValue, () => reveal(true), { flush: "post" });
</script>

<template>
  <div>
    <button v-if="fold" type="button" class="flbl ffold" :aria-expanded="!!open" @click="emit('update:open', !open)">
      <span>{{ label }}</span><Icon name="down" :size="16" class="fc" :class="{ shut: !open }" />
    </button>
    <div v-else class="flbl">{{ label }}</div>
    <div :class="{ fside: !!$slots.aside, folds: fold }">
      <Collapse v-if="fold && $slots.aside" :open="shown ?? !!open"><div class="fasd"><slot name="aside" /></div></Collapse>
      <slot v-else name="aside" />
      <div ref="row" class="chips" :class="$slots.aside && !isPhone ? 'cgrid' : 'hscroll'">
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
/* the picture sits above the chips on phones and left of them on desktop (two equal columns as wide as the longest label,
   so the chips follow the density). On desktop the picture stretches to the grid's height, so a third chip row never makes it jump */
.fside { display: flex; flex-direction: column; gap: var(--lpy); }
/* folding, the gap goes inside the fold so it shuts with the picture */
.fside.folds { gap: 0; }
.fasd { padding-bottom: var(--lpy); }
html:not(.phone) .fside { flex-direction: row; align-items: stretch; gap: var(--spg); }
.cgrid { display: grid; grid-template-columns: repeat(2, 1fr); align-content: center; }
.cgrid .fchip { justify-content: center; }
/* the label as a fold button: the label's own type (from .flbl), full width with the chevron at the end (the Routines folder
   header's .fc), tall enough to tap; the extra height is taken back outside so the gap to what follows stays the plain label's */
.ffold { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 6px; border: 0; background: none; cursor: pointer; padding: 8px 0; margin-block: -8px calc(6px - 8px); min-height: 32px; text-align: start; border-radius: var(--r-sm); }
.n { opacity: .65; font-variant-numeric: tabular-nums; margin-inline-start: 2px; }
</style>
