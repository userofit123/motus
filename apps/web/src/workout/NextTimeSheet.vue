<script lang="ts">
import type { NextChange } from "@motus/shared";
/** one set (or a run of sets in a row reading the same, `label` "1-6") whose numbers change, as text ("-" when empty):
 * what the routine planned before this workout, what was done today in its place, and where next time starts it.
 * `label` is the set's badge (1, 3L, W, D), `trend` the weight against today's (else the plan's) */
export interface NextSet { key: number; lastKey?: number; label: string; kind: string; planned: string; did: string; next: string; trend: "up" | "down" | null }
/** a routine exercise whose numbers change next time (or that has a Progression change, or sets left unticked with
 * numbers typed in); `index` is its place in the workout, for "Go to exercise"; `note` says when the slot is new or
 * holds another exercise now ("Was: Bench press") */
export interface NextGroup { id: string; index: number; name: string; note?: string; sets: NextSet[]; change?: NextChange; unticked: boolean }
/** an exercise that stays as it is, with the routine's numbers in short ("3 × 20 kg × 10") */
export interface NextSame { id: string; name: string; fixed: boolean; sets: string }
</script>

<script setup lang="ts">
// "Next time", opened from the Finish screen: each exercise whose routine numbers change, set by set in three labelled
// columns, so it never reads as one number: what the routine planned before this workout, what you did, and next time
// (today's numbers, then Progression). A weight change gets its own row saying what changes and why in plain words
// (what you did against the plan); a Suggest one has its Apply switch, off to start with: nothing applies unasked.
// Sets left unticked with numbers typed are pointed out, with a way back to the exercise. The exercises that stay the same fold into one line at the bottom.
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
// the change in a line: "46 kg → 47.5 kg · reps start again at 8" (the reps done, never the range)
const changeText = (c: NextChange) => {
  const kg = `${fmt.value.wu_(c.fromKg)} → ${fmt.value.wu_(c.toKg)}`;
  return c.reps != null && c.fromReps != null && c.reps !== c.fromReps ? `${kg} · reps start again at ${c.reps}` : kg;
};
const changeTitle = (c: NextChange) => (c.direction === "up" ? "Heavier next time" : "Lighter next time");
const applyLabel = (c: NextChange, name: string) => `${c.direction === "up" ? "Raise" : "Lower"} the weight for ${name}`;
const badge = (k: string) => ({ w: k === "warmup", d: k === "drop", f: k === "failure" });
</script>

<template>
  <Sheet title="Next time" @close="emit('close')">
    <div v-if="!groups.length" class="banner note spb"><Icon name="check" />The routine stays the same</div>
    <div v-for="g in groups" :key="g.id" class="card spb nt-ex">
      <!-- the name has its own line (long ones wrap), the numbers sit under it -->
      <div class="nt-name">{{ g.name }}</div>
      <div v-if="g.note" class="nt-was"><Icon :name="g.note.startsWith('Was') ? 'swap' : 'plus'" :size="14" />{{ g.note }}</div>
      <table v-if="g.sets.length" class="sets nt-tbl">
        <thead><tr><th>Set</th><th>Planned</th><th>You did</th><th>Next time</th></tr></thead>
        <tbody>
          <tr v-for="x in g.sets" :key="x.key">
            <td><span class="sk" :class="badge(x.kind)">{{ x.label }}</span></td>
            <td class="nt-pl">{{ x.planned }}</td>
            <td class="nt-did">{{ x.did }}</td>
            <td class="nt-nx" :class="x.trend === 'up' ? 'pos' : x.trend === 'down' ? 'neg' : ''"><Icon v-if="x.trend" :name="x.trend === 'up' ? 'arrowUp' : 'arrowDown'" :size="12" />{{ x.next }}</td>
          </tr>
        </tbody>
      </table>
      <component :is="g.change?.mode === 'auto' ? 'div' : 'label'" v-if="g.change" class="tgl nt-chg">
        <span class="bi sg" :class="g.change.direction === 'up' ? 'pos' : 'neg'"><Icon :name="g.change.direction === 'up' ? 'arrowUp' : 'arrowDown'" :size="16" /></span>
        <div class="grow" style="min-width:0">
          <div class="t">{{ changeTitle(g.change) }}</div>
          <div class="s nt-kg">{{ changeText(g.change) }}</div>
          <div class="s">{{ g.change.reason }}</div>
        </div>
        <span v-if="g.change.mode === 'auto'" class="mchip" :class="g.change.direction === 'up' ? 'pos' : 'neg'">Automatic</span>
        <span v-else class="nt-ap"><span class="tiny">Apply</span><span class="tg"><input type="checkbox" :checked="accepted.includes(g.id)" :aria-label="applyLabel(g.change, g.name)" @change="toggle(g.id, ($event.target as HTMLInputElement).checked)" /></span></span>
      </component>
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
/* the set table's look (badges, strips), three value columns that may wrap on a phone; the change in next time's colour */
.nt-tbl { margin-top: var(--tdy); }
.nt-tbl td { font-size: var(--fs-sm); }
.nt-tbl .sk { cursor: default; }
.nt-pl { color: var(--tx2); }
.nt-nx { font-weight: 600; }
.nt-nx .ico { vertical-align: -1px; margin-inline-end: 2px; }
.nt-nx.pos { color: var(--pos); }
.nt-nx.neg { color: var(--neg); }
.mchip.pos { color: var(--pos); }
.mchip.neg { color: var(--neg); }
.nt-chg { margin-top: var(--tdy); border-top: 1px solid var(--ol); border-bottom: 0; align-items: flex-start; }
div.nt-chg { cursor: default; }
.nt-chg > .bi, .nt-chg > .mchip, .nt-chg > .nt-ap { align-self: center; }
.nt-chg .bi.pos { color: var(--pos); }
.nt-chg .bi.neg { color: var(--neg); }
.nt-chg .nt-kg { color: var(--tx); font-weight: 600; font-variant-numeric: tabular-nums; }
.nt-ap { display: inline-flex; align-items: center; gap: var(--tdy); flex: none; }
.nt-note { display: flex; align-items: center; gap: var(--tdy) var(--hg); flex-wrap: wrap; margin-top: var(--lpy); padding-top: var(--lpy); border-top: 1px solid var(--ol); font-size: var(--fs-sm); color: var(--tx2); }
.nt-note .ico { flex: none; color: var(--acc); }
</style>
