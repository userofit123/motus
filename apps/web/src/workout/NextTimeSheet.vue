<script lang="ts">
import type { NextChange } from "@motus/shared";
/** one set whose numbers change: the routine's before this workout and next time's, as text ("-" when empty) */
export interface NextSet { key: number; label: string; from: string; to: string; trend: "up" | "down" | null }
/** a routine exercise whose numbers change next time (or that has a Progression change, or sets left unticked with
 * numbers typed in); `index` is its place in the workout, for "Go to exercise"; `note` says when the slot is new or
 * holds another exercise now ("Was: Bench press") */
export interface NextGroup { id: string; index: number; name: string; note?: string; sets: NextSet[]; change?: NextChange; unticked: boolean }
/** an exercise that stays as it is, with the routine's numbers in short ("3 × 20 kg × 10") */
export interface NextSame { id: string; name: string; fixed: boolean; sets: string }
</script>

<script setup lang="ts">
// "Next time", opened from the Finish screen: each exercise whose routine numbers change, set by set, the routine before
// this workout against next time (today's numbers, then Progression). An Automatic change says why; a Suggest change
// has its Apply switch, off to start with: nothing applies unasked. Sets left unticked with numbers typed are pointed
// out, with a way back to the exercise. The exercises that stay the same fold into one line at the bottom.
import { computed, ref } from "vue";
import { useWorkout } from "./useWorkout";
import Sheet from "../components/Sheet.vue";
import Icon from "../components/Icon.vue";

const props = defineProps<{ groups: NextGroup[]; unchanged: NextSame[] }>();
const accepted = defineModel<string[]>({ required: true });
const emit = defineEmits<{ close: []; open: [index: number] }>();
const fmt = useWorkout().fmt;
const showSame = ref(false);
const sameText = computed(() => `${props.unchanged.length} exercise${props.unchanged.length === 1 ? "" : "s"} unchanged`);
function toggle(id: string, on: boolean) { accepted.value = on ? [...accepted.value, id] : accepted.value.filter((x) => x !== id); }
// the set the change is about, before and after: "20 kg × 12 → 22.5 kg × 8" (the reps done, never the range)
const numbers = (kg: number, reps: number | null) => `${fmt.value.wu_(kg)}${reps != null ? ` × ${reps}` : ""}`;
const changeText = (c: NextChange) => `${numbers(c.fromKg, c.fromReps)} → ${numbers(c.toKg, c.reps)}`;
const applyLabel = (c: NextChange, name: string) => `${c.direction === "up" ? "Raise" : "Lower"} the weight for ${name}`;
</script>

<template>
  <Sheet title="Next time" @close="emit('close')">
    <div v-if="!groups.length" class="banner note spb"><Icon name="check" />The routine stays the same</div>
    <div v-for="g in groups" :key="g.id" class="card spb nt-ex">
      <!-- the name has its own line (long ones wrap), the numbers sit under it -->
      <div class="nt-name">{{ g.name }}</div>
      <div v-if="g.note" class="nt-was"><Icon :name="g.note.startsWith('Was') ? 'swap' : 'plus'" :size="14" />{{ g.note }}</div>
      <div v-if="g.sets.length" class="nt-sets">
        <div v-for="x in g.sets" :key="x.key" class="nt-set">
          <span class="nt-lbl">{{ x.label }}</span>
          <span class="nt-val"><span class="nt-from">{{ x.from }}</span><Icon name="right" :size="14" class="nt-arr" /><span class="nt-to" :class="x.trend === 'up' ? 'pos' : x.trend === 'down' ? 'neg' : ''">{{ x.to }}</span></span>
        </div>
      </div>
      <div v-if="g.change?.mode === 'auto'" class="nt-auto">
        <span class="mchip" :class="g.change.direction === 'up' ? 'pos' : 'neg'"><Icon :name="g.change.direction === 'up' ? 'arrowUp' : 'arrowDown'" :size="12" />Automatic</span>
        <span class="tiny">{{ g.change.reason }}</span>
      </div>
      <label v-else-if="g.change" class="tgl nt-apply">
        <span class="bi sg"><Icon :name="g.change.direction === 'up' ? 'arrowUp' : 'arrowDown'" :size="16" /></span>
        <div class="grow" style="min-width:0">
          <div class="t">Apply</div>
          <div class="s">{{ g.change.reason }} · {{ changeText(g.change) }}</div>
        </div>
        <span class="tg"><input type="checkbox" :checked="accepted.includes(g.id)" :aria-label="applyLabel(g.change, g.name)" @change="toggle(g.id, ($event.target as HTMLInputElement).checked)" /></span>
      </label>
      <div v-if="g.unticked" class="nt-note">
        <Icon name="info" :size="16" />
        <span class="grow">Sets you didn't tick won't be saved</span>
        <button class="lnk inl" @click="emit('open', g.index)">Go to exercise</button>
      </div>
    </div>
    <div v-if="unchanged.length" class="card nt-same">
      <div class="li click" role="button" tabindex="0" :aria-expanded="showSame" @click="showSame = !showSame" @keydown.enter="showSame = !showSame">
        <Icon name="check" :size="18" class="muted" />
        <div class="grow t">{{ sameText }}</div>
        <Icon :name="showSame ? 'up' : 'down'" :size="16" class="muted" />
      </div>
      <template v-if="showSame">
        <div v-for="x in unchanged" :key="x.id" class="li">
          <Icon name="dumbbell" :size="18" class="muted" />
          <div class="grow" style="min-width:0"><div class="t ellipsis">{{ x.name }}</div><div class="s ellipsis">{{ x.sets }}</div></div>
          <span v-if="x.fixed" class="mchip"><Icon name="lock" :size="12" />Fixed numbers</span>
        </div>
      </template>
    </div>
    <template #foot><button class="btn" @click="emit('close')">Done</button></template>
  </Sheet>
</template>

<style scoped>
/* every line in the card keeps the .li rows' inline inset, so all left edges line up with the list below */
.nt-ex > * { padding-inline: 4px; }
.nt-was { display: flex; align-items: center; gap: var(--tdy); margin-top: var(--tdy); font-size: var(--fs-sm); color: var(--tx2); }
.nt-was .ico { flex: none; }
.nt-name { font-weight: 600; font-size: var(--fs-lg); overflow-wrap: anywhere; }
.nt-sets { display: flex; flex-direction: column; gap: var(--tdy); margin-top: var(--tdy); }
.nt-set { display: grid; grid-template-columns: 4.5em 1fr; align-items: baseline; font-variant-numeric: tabular-nums; }
.nt-lbl { font-size: var(--fs-sm); color: var(--tx2); }
.nt-val { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--tdy); min-width: 0; }
.nt-from { color: var(--tx2); }
.nt-arr { color: var(--tx2); }
.nt-to { font-weight: 600; }
.nt-to.pos { color: var(--pos); }
.nt-to.neg { color: var(--neg); }
.nt-auto { display: flex; flex-wrap: wrap; align-items: center; gap: var(--tdy); margin-top: var(--lpy); }
.mchip { display: inline-flex; align-items: center; gap: var(--tdy); }
.mchip.pos { color: var(--pos); }
.mchip.neg { color: var(--neg); }
.nt-apply { margin-top: var(--tdy); border-top: 1px solid var(--ol); border-bottom: 0; }
.nt-note { display: flex; align-items: center; gap: var(--tdy) var(--hg); flex-wrap: wrap; margin-top: var(--lpy); padding-top: var(--lpy); border-top: 1px solid var(--ol); font-size: var(--fs-sm); color: var(--tx2); }
.nt-note .ico { flex: none; color: var(--acc); }
</style>
