<script setup lang="ts">
// One routine exercise's planned sets, read-only: the routine editor's set grid (same columns, same set labels) with the
// numbers shown as values instead of inputs, so opening a routine shows exactly what each set asks for.
import { computed } from "vue";
import { usesWeight, usesReps, usesDuration, usesDistance, clampStartReps, fromM } from "@motus/shared";
import { useSettings } from "../api/queries";
import { useFmt, setLabel } from "../core/format";
import Icon from "./Icon.vue";

const props = defineProps<{ ex: any }>();
const s = useSettings();
const fmt = useFmt();
const t = computed(() => props.ex.exercise?.tracking ?? "weight_reps");
const show = computed(() => ({ w: usesWeight(t.value), r: usesReps(t.value), d: usesDuration(t.value), dist: usesDistance(t.value), rpe: !!s.value.features.rpe }));
const cols = computed(() => ({ gridTemplateColumns: `36px repeat(${Object.values(show.value).filter(Boolean).length}, minmax(0, 1fr))` }));
const reps = (x: any) => (x.repsMax ? `${x.reps ?? "?"}-${x.repsMax}` : x.reps ?? null);
const dist = (m: number | null) => (m == null ? null : fmt.value.num(fromM(m, fmt.value.du), 2));
</script>

<template>
  <div class="psets">
    <div class="sgrid shead" :style="cols"><span>Set</span>
      <span v-if="show.w">{{ fmt.wu }}</span><span v-if="show.r">Reps</span><span v-if="show.d">Time</span><span v-if="show.dist">{{ fmt.du }}</span><span v-if="show.rpe">RPE</span></div>
    <div class="slist">
      <div v-for="(x, j) in ex.sets" :key="x.id ?? j" class="sitem" :class="{ drop: x.kind === 'drop' }">
        <div class="sgrid" :style="cols">
          <span class="sk" :class="{ w: x.kind === 'warmup', d: x.kind === 'drop', f: x.kind === 'failure' }">{{ setLabel(ex.sets, j) }}</span>
          <span v-if="show.w" class="pv" :class="{ none: x.weightKg == null }">{{ x.weightKg != null ? fmt.w(x.weightKg) : "-" }}</span>
          <span v-if="show.r" class="pv" :class="{ none: reps(x) == null }">{{ reps(x) ?? "-" }}<small v-if="clampStartReps(x) != null">starts at {{ clampStartReps(x) }}</small></span>
          <span v-if="show.d" class="pv" :class="{ none: !x.durationS }">{{ x.durationS ? fmt.clock(x.durationS) : "-" }}</span>
          <span v-if="show.dist" class="pv" :class="{ none: x.distanceM == null }">{{ dist(x.distanceM) ?? "-" }}</span>
          <span v-if="show.rpe" class="pv" :class="{ none: x.rpe == null }">{{ x.rpe ?? "-" }}</span>
        </div>
        <div v-if="x.restS != null" class="sgrid rrow" :style="cols">
          <span class="sk r" title="Its own rest after this set">R</span>
          <span class="rpill"><Icon name="timer" :size="14" />{{ x.restS === 0 ? "No rest" : `${fmt.clock(x.restS)} rest` }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* the editor's input boxes, as plain values: same place, size and weight, no field around them */
.pv { display: flex; flex-direction: column; align-items: center; text-align: center; font-variant-numeric: tabular-nums; font-size: 16px; font-weight: 600; color: var(--tx); padding: 6px 4px; border-radius: 10px; background: color-mix(in srgb, var(--s2) 55%, transparent); }
.pv.none { color: var(--tx2); font-weight: 500; }
.pv small { font-size: 11px; font-weight: 500; color: var(--tx2); }
.sk.r { background: var(--accc); color: var(--onc); }
</style>
