<script setup lang="ts">
// One reminder, everywhere reminders are shown: a bell, what to remember, a quiet line with what it's about and when
// it comes up, and its buttons in a row under the text (Done first, the others plain).
import { computed } from "vue";
import { useFmt } from "../core/format";
import Icon from "./Icon.vue";

const props = defineProps<{ reminder: any; when?: boolean; where?: string | null; actions?: { label: string; run: () => void; primary?: boolean }[] }>();
const fmt = useFmt();
const r = computed(() => props.reminder);
const whenText = computed(() => {
  const x = r.value;
  return x.trigger === "next" ? "Next time" : x.trigger === "every" ? "Every time" : x.trigger === "after_n" ? `After ${x.triggerN} sessions` : x.trigger === "date" ? `From ${fmt.value.date(x.triggerDate)}` : "";
});
const actionText = computed(() => {
  const a = r.value.action;
  if (!a) return null;
  // "Ready for more weight" from the Finish screen: the exact numbers, kept in kg and shown in the person's unit
  if (a.setWeightKg != null) return `${fmt.value.wu_(a.setWeightKg)}${a.setReps != null ? ` × ${a.setReps}` : ""}`;
  return [a.weightKg ? `${a.weightKg > 0 ? "+" : "−"}${fmt.value.wu_(Math.abs(a.weightKg))}` : null, a.reps ? `${a.reps > 0 ? "+" : "−"}${Math.abs(a.reps)} reps` : null, a.restS ? `rest ${fmt.value.clock(a.restS)}` : null].filter(Boolean).join(", ") || null;
});
const meta = computed(() => [props.where, props.when ? whenText.value : null, actionText.value].filter(Boolean) as string[]);
</script>

<template>
  <div class="ritem">
    <Icon name="bell" :size="18" class="ic" />
    <div class="b">
      <div class="tx">{{ r.body }}</div>
      <div v-if="meta.length" class="m"><template v-for="(x, i) in meta" :key="i"><span v-if="i" class="sep">·</span><span>{{ x }}</span></template></div>
      <div v-if="actions?.length" class="acts">
        <button v-for="a in actions" :key="a.label" type="button" class="qb" :class="{ acc: a.primary }" @click="a.run()">{{ a.label }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ritem { display: flex; align-items: flex-start; gap: 10px; text-align: start; padding: calc(var(--cpy) - 4px) calc(var(--cpx) - 3px); border-radius: var(--r-sm); background: color-mix(in srgb, var(--acc) 13%, transparent); font-size: 13.5px; color: var(--tx); }
.ic { color: var(--acc); flex: none; margin-top: 1px; }
.b { flex: 1; min-width: 0; }
.tx { font-weight: 600; white-space: pre-wrap; overflow-wrap: anywhere; }
.m { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-top: 3px; font-size: var(--fs-xs); color: var(--tx2); }
/* buttons sit under the text, the first one's label lined up with it */
.acts { display: flex; flex-wrap: wrap; gap: 2px; margin: 4px 0 -4px -8px; }
.acts .qb { padding: 5px 8px; }
</style>
