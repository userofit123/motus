<script setup lang="ts">
// The program form (new or edit), shared by the Programs section and a program's page.
import { ref } from "vue";
import type { Program } from "@motus/shared";
import { useRoutines } from "../api/queries";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { toast, toastError } from "../core/toast";
import { localYmd } from "../core/format";
import Icon from "./Icon.vue";
import Sheet from "./Sheet.vue";
import WhenPicker from "./WhenPicker.vue";
import AppSelect from "./AppSelect.vue";
import Menu from "./Menu.vue";

const props = defineProps<{ program?: Program | null }>();
const emit = defineEmits<{ close: []; saved: [id: string] }>();
const routines = useRoutines();
const nameOf = (id: string) => routines.data.value?.find((r) => r.id === id)?.name ?? "?";
const e = ref<any>(props.program
  ? JSON.parse(JSON.stringify({ id: props.program.id, name: props.program.name, description: props.program.description, startDate: props.program.startDate, deloadPct: props.program.deloadPct, weeks: props.program.weeks }))
  : { name: "", description: "", startDate: localYmd(new Date()), deloadPct: 40, weeks: [{ days: [], deload: false }] });
// Adds a copy of the week right after it, in this same program (not a new program).
const duplicateWeek = (i: number) => { const w = e.value.weeks[i]; e.value.weeks.splice(i + 1, 0, { days: [...w.days], deload: false }); };
async function save() {
  try {
    const x = e.value;
    const id = x.id ? (await api.put(`/programs/${x.id}`, x), x.id) : (await api.post("/programs", x)).id;
    invalidate(["routines", "home"]); toast("Program saved"); emit("saved", id); emit("close");
  } catch (err) { toastError(err); }
}
</script>

<template>
  <Sheet :title="e.id ? 'Edit program' : 'New program'" size="wide" @close="emit('close')">
    <div class="fld"><label>Name</label><input v-model="e.name" placeholder="e.g. 8-week push/pull/legs" /></div>
    <div class="fld"><label>Description</label><input v-model="e.description" placeholder="Optional" /></div>
    <div class="fld"><label>Starts</label><WhenPicker v-model="e.startDate" title="Starts" /></div>
    <div class="fld"><label>Deload weeks lighter by (%)</label><input v-model.number="e.deloadPct" type="number" min="0" max="90" /></div>
    <p class="tiny hint">A deload week is a lighter week to let your body recover. In the weeks you mark as deload, working weights start {{ e.deloadPct || 0 }}% lower; warm-ups and reps stay the same.</p>
    <div class="flbl">Weeks</div>
    <p class="tiny hint">The routines to do each week, in order. Motus counts your workouts in this order, so a missed day never throws the plan off.</p>
    <div v-for="(w, i) in e.weeks" :key="i" class="card tight wk">
      <div class="row hgap"><b class="grow">Week {{ i + 1 }}</b><label class="row tiny" style="gap:6px"><span class="tg"><input v-model="w.deload" type="checkbox" /></span>Deload</label>
        <Menu :items="[{ label: 'Duplicate this week', icon: 'copy', run: () => duplicateWeek(i) }, { label: 'Remove this week', icon: 'trash', danger: true, sep: true, hidden: e.weeks.length < 2, run: () => e.weeks.splice(i, 1) }]" /></div>
      <!-- the week's workouts in order, each removable; routines are added from a dropdown under them -->
      <div v-if="w.days.length" class="pdays">
        <div v-for="(d, j) in w.days" :key="j" class="pday"><span class="pdn">{{ j + 1 }}</span><span class="grow ellipsis">{{ nameOf(d) }}</span><button type="button" class="ib sm plain" :aria-label="`Remove ${nameOf(d)}`" @click="w.days.splice(j, 1)"><Icon name="close" :size="14" /></button></div>
      </div>
      <div v-else class="tiny">No workouts: a rest week.</div>
      <AppSelect :model-value="''" :options="(routines.data.value ?? []).filter((r) => !r.archived).map((r) => ({ value: r.id, label: r.name }))" :placeholder="w.days.length ? 'Add another workout…' : 'Add a workout…'" title="Add a workout" @update:model-value="(v: string) => v && w.days.push(v)" />
    </div>
    <button class="qb acc" @click="e.weeks.push({ days: [...(e.weeks.at(-1)?.days ?? [])], deload: false })"><Icon name="plus" :size="16" />Add a week</button>
    <template #foot><button class="btn o" @click="emit('close')">Cancel</button><button class="btn" @click="save">Save</button></template>
  </Sheet>
</template>

<style scoped>
/* explanations sit under the fields they belong to, the field's own bottom gap pulled in */
.hint { margin: -6px 0 14px; }
/* the week's parts (header, workouts, add) are spaced by one gap, so nothing leaves extra space at the bottom */
.wk { display: flex; flex-direction: column; gap: var(--hg); margin-bottom: var(--hg); }
.wk .row.hgap { margin: 0; }
.pdays { display: flex; flex-direction: column; gap: 4px; }
.pday { display: flex; align-items: center; gap: 10px; padding: 2px 2px 2px 6px; border-radius: var(--r-sm); background: var(--s2); font-size: 13.5px; }
.pdn { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; flex: none; font-size: 11.5px; font-weight: 600; background: var(--s1); color: var(--tx2); }
/* .tg is the settings-list switch row, which draws a line above itself; here it's a bare switch beside a label */
.wk .tg { border: 0; padding: 0; flex: none; }
</style>
