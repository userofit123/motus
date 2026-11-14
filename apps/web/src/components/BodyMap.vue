<script setup lang="ts">
// A calm body (front and back) with each muscle coloured by how much it was worked:
// red for the main muscles, yellow for those that helped, blue for those that did a little.
// values: muscle name (as in the exercise library) → weighted sets (main muscle 1, helper 0.5, see muscleSets()).
// highlight/secondary: one exercise's main and helper muscles instead of amounts.
// pickable: each muscle is a button that emits pick (the muscle filter above exercise lists), with a wider invisible tap ring; off, the figure only shows.
// pressed: with pickable, the muscles whose button is on (a tap clears them); lit muscles are not always pressed.
// inspect: the amounts keep their colours, but muscles and legend entries are buttons (pick, pickTier with that
// band's muscles) so a page can point one out; focus: the muscles pointed out, ringed while the rest fade.
import { computed } from "vue";
import { muscleName } from "@motus/shared";
import { SILHOUETTE, HEAD, FRONT, BACK } from "./bodyShapes";

const props = defineProps<{ values: Record<string, number>; max?: number; height?: number; highlight?: string[]; secondary?: string[]; legend?: boolean; pickable?: boolean; pressed?: string[]; inspect?: boolean; focus?: string[]; focusTier?: number }>();
const emit = defineEmits<{ pick: [muscle: string]; pickTier: [tier: number, muscles: string[]] }>();
const MIRROR = "translate(100 0) scale(-1 1)";
const VIEWS = [{ name: "Front", shapes: Object.entries(FRONT) }, { name: "Back", shapes: Object.entries(BACK) }];

const top = computed(() => props.max ?? Math.max(1, ...Object.values(props.values)));
/** 1 main, 2 helped, 3 a little, 0 not worked. Shares of the busiest muscle: half a set per helper set puts helpers in the middle band. */
function tier(m: string): 0 | 1 | 2 | 3 {
  if (props.highlight) return props.highlight.includes(m) ? 1 : props.secondary?.includes(m) ? 2 : 0;
  const v = props.values[m] ?? 0;
  if (v <= 0) return 0;
  const share = v / top.value;
  return share >= 0.6 ? 1 : share >= 0.25 ? 2 : 3;
}
const TIER_NAME = ["", "Main muscle", "Helper", "Small part"];
const label = (m: string) => {
  // as a filter the name is all it needs; "Main" would only echo whether it is picked
  if (props.pickable) return muscleName(m);
  const v = props.values[m];
  return `${m[0]!.toUpperCase()}${m.slice(1)}${tier(m) ? ` · ${TIER_NAME[tier(m)]}` : ""}${v ? ` · ${Math.round(v * 10) / 10} sets` : ""}`;
};
const used = computed(() => new Set(VIEWS.flatMap((v) => v.shapes.map(([m]) => tier(m))).filter(Boolean)));
const btn = computed(() => props.pickable || props.inspect);
const tierMuscles = (t: number) => [...new Set(VIEWS.flatMap((v) => v.shapes.map(([m]) => m)))].filter((m) => tier(m) === t);
</script>

<template>
  <div class="bodymap" :class="{ pick: pickable, insp: inspect, focused: !!focus?.length }" :style="{ '--bmh': (height ?? 200) + 'px' }">
    <div class="figs">
      <svg v-for="v in VIEWS" :key="v.name" viewBox="10 3 80 194" role="img" :aria-label="v.name">
        <g class="sil"><path :d="SILHOUETTE" /><path :d="SILHOUETTE" :transform="MIRROR" /><ellipse v-bind="HEAD" /></g>
        <!-- as a filter, a wide invisible ring round each muscle under the muscles themselves, so a small one (biceps, calves) is
             easy to hit on a phone: a tap on a muscle's own fill picks it, a tap in the gap picks the nearest one -->
        <g v-if="pickable" aria-hidden="true">
          <template v-for="[m, d] in v.shapes" :key="m"><path class="hit" :d="d" @click="emit('pick', m)" /><path class="hit" :d="d" :transform="MIRROR" @click="emit('pick', m)" /></template>
        </g>
        <!-- the level is an attribute, not a class: patching the class of SVG elements inside these lists crashes Vue (3.5) -->
        <g v-for="[m, d] in v.shapes" :key="m" :data-t="tier(m)" :data-f="focus?.includes(m) ? 1 : undefined" :role="btn ? 'button' : undefined" :tabindex="btn ? 0 : undefined"
          :aria-pressed="pickable ? !!pressed?.includes(m) : inspect ? !!focus?.includes(m) : undefined" :aria-label="btn ? label(m) : undefined"
          @click="btn && emit('pick', m)" @keydown.enter.space.prevent="btn && emit('pick', m)">
          <path class="m" :d="d"><title>{{ label(m) }}</title></path>
          <path class="m" :d="d" :transform="MIRROR"><title>{{ label(m) }}</title></path>
        </g>
      </svg>
    </div>
    <div v-if="legend && used.size" class="bmlegend">
      <template v-for="t in [1, 2, 3].filter((x) => used.has(x as any))" :key="t">
        <button v-if="inspect" type="button" :class="{ on: focusTier === t }" :aria-pressed="focusTier === t" @click="emit('pickTier', t, tierMuscles(t))"><i :class="'t' + t" />{{ TIER_NAME[t] }}</button>
        <span v-else><i :class="'t' + t" />{{ TIER_NAME[t] }}</span>
      </template>
    </div>
  </div>
</template>
