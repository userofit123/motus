<script setup lang="ts">
// A calm body (front and back) with each muscle coloured by how much it was worked:
// red for the main muscles, yellow for those that helped, blue for those that did a little.
// values: muscle name (as in the exercise library) → weighted sets (main muscle 1, helper 0.5, see muscleSets()).
// highlight/secondary: one exercise's main and helper muscles instead of amounts.
// pickable: each muscle is a button that emits pick (the muscle filter above exercise lists); off, the figure only shows.
import { computed } from "vue";
import { muscleName } from "@motus/shared";
import { SILHOUETTE, HEAD, FRONT, BACK } from "./bodyShapes";

const props = defineProps<{ values: Record<string, number>; max?: number; height?: number; highlight?: string[]; secondary?: string[]; legend?: boolean; pickable?: boolean }>();
const emit = defineEmits<{ pick: [muscle: string] }>();
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
const TIER_NAME = ["", "Main", "Helped", "A little"];
const label = (m: string) => {
  // as a filter the name is all it needs; "Main" would only echo whether it is picked
  if (props.pickable) return muscleName(m);
  const v = props.values[m];
  return `${m[0]!.toUpperCase()}${m.slice(1)}${tier(m) ? ` · ${TIER_NAME[tier(m)]}` : ""}${v ? ` · ${Math.round(v * 10) / 10} sets` : ""}`;
};
const used = computed(() => new Set(VIEWS.flatMap((v) => v.shapes.map(([m]) => tier(m))).filter(Boolean)));
</script>

<template>
  <div class="bodymap" :class="{ pick: pickable }" :style="{ '--bmh': (height ?? 200) + 'px' }">
    <div class="figs">
      <svg v-for="v in VIEWS" :key="v.name" viewBox="10 3 80 194" role="img" :aria-label="v.name">
        <g class="sil"><path :d="SILHOUETTE" /><path :d="SILHOUETTE" :transform="MIRROR" /><ellipse v-bind="HEAD" /></g>
        <!-- the level is an attribute, not a class: patching the class of SVG elements inside these lists crashes Vue (3.5) -->
        <g v-for="[m, d] in v.shapes" :key="m" :data-t="tier(m)" :role="pickable ? 'button' : undefined" :tabindex="pickable ? 0 : undefined"
          :aria-pressed="pickable ? tier(m) === 1 : undefined" :aria-label="pickable ? label(m) : undefined"
          @click="pickable && emit('pick', m)" @keydown.enter.space.prevent="pickable && emit('pick', m)">
          <path class="m" :d="d"><title>{{ label(m) }}</title></path>
          <path class="m" :d="d" :transform="MIRROR"><title>{{ label(m) }}</title></path>
        </g>
      </svg>
    </div>
    <div v-if="legend && used.size" class="bmlegend">
      <span v-for="t in [1, 2, 3].filter((x) => used.has(x as any))" :key="t"><i :class="'t' + t" />{{ TIER_NAME[t] }}</span>
    </div>
  </div>
</template>
