<script setup lang="ts">
// One Routine check row opened (M-291): what the check looks at, its numbers per muscle or exercise, the target with
// why and for which goal, what to change, and the research. Laid out as the lessons' sheet (LearnSheet): an intro,
// then a card with the numbers (per muscle as bars against the target band, as the lessons' example; per exercise as
// rows, each value green when it meets the target and red when it doesn't, as the check's own rows), then sections of
// rows (icon, what, why; a source's full reference under what it found).
import { computed } from "vue";
import type { Check } from "@motus/shared";
import Sheet from "./Sheet.vue";
import Icon from "./Icon.vue";
import BarChart from "./BarChart.vue";

// goal: the goal's name; goalNote: why the targets are for it (this program's goal, the program the routine is in, none)
const props = defineProps<{ check: Check; goal: string; goalNote?: string }>();
const emit = defineEmits<{ close: [] }>();
const tone = (ok: boolean | null) => (ok === true ? "pos" : ok === false ? "neg" : undefined);
const bars = computed(() => props.check.items.map((i) => ({ label: i.label, value: i.value, tip: `${i.label}: ${i.text}`, color: i.ok === false ? "var(--neg)" : i.ok ? "var(--pos)" : undefined })));
</script>

<template>
  <Sheet :title="check.title" @close="emit('close')">
    <p class="tiny ls-intro">{{ check.what }}</p>
    <div class="card">
      <div class="lbl hgap">{{ check.itemsLabel }}</div>
      <BarChart v-if="check.bars" :bars="bars" horizontal :band="check.band" />
      <div v-else class="list">
        <div v-for="(i, k) in check.items" :key="k" class="li">
          <div class="grow"><div class="t">{{ i.label }}</div><div v-if="i.note" class="s">{{ i.note }}</div></div>
          <b class="r" :class="tone(i.ok)">{{ i.text }}</b>
        </div>
      </div>
    </div>
    <div class="sh"><h2>The target</h2></div>
    <div class="card flush">
      <div class="li"><Icon name="target" :size="18" class="muted" /><div class="grow"><div class="t">{{ check.target }}</div><div class="s">{{ check.why }}</div></div></div>
      <div class="li"><Icon name="goals" :size="18" class="muted" /><div class="grow"><div class="t">{{ goal }}</div><div v-if="goalNote" class="s">{{ goalNote }}</div></div></div>
    </div>
    <div class="sh"><h2>What to change</h2></div>
    <div class="card flush">
      <div v-for="(t, k) in check.tips" :key="k" class="li"><Icon :name="check.share >= 1 ? 'check' : 'edit'" :size="18" :class="check.share >= 1 ? 'pos' : 'muted'" /><div class="grow"><div class="t">{{ t }}</div></div></div>
    </div>
    <div class="sh"><h2>Where the target comes from</h2></div>
    <div class="card flush">
      <div v-for="r in check.sources" :key="r.t" class="li"><Icon name="note" :size="18" class="muted" />
        <div class="grow"><div class="t">{{ r.t }}</div><div class="s">{{ r.s }}</div><div class="s ls-ref">{{ r.ref }}</div></div></div>
    </div>
  </Sheet>
</template>

<style scoped>
.ls-intro { margin: 0 0 var(--spg); line-height: 1.5; }
/* the reference set apart from the finding above it, smaller as a citation is (LearnSheet's) */
.li .s.ls-ref { margin-top: var(--tdy); font-size: var(--fs-xs); line-height: 1.4; }
</style>
