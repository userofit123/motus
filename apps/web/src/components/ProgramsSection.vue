<script setup lang="ts">
// Programs (optional feature): weeks of routines done in order, with deload weeks. Shows where you are and what's next.
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { useRoutines } from "../api/queries";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { confirm } from "../core/ask";
import { toastError } from "../core/toast";
import { localYmd } from "../core/format";
import Icon from "./Icon.vue";
import Menu from "./Menu.vue";
import Sheet from "./Sheet.vue";

const router = useRouter();
const programs = useQuery({ queryKey: ["routines", "programs"], queryFn: () => api.get("/programs") });
const routines = useRoutines();
const edit = ref<any>(null);
const nameOf = (id: string) => routines.data.value?.find((r) => r.id === id)?.name ?? "?";
function blank() { edit.value = { name: "", description: "", startDate: localYmd(new Date()), deloadPct: 40, weeks: [{ days: [], deload: false }] }; }
function editP(p: any) { edit.value = JSON.parse(JSON.stringify({ ...p, startDate: p.startDate })); }
async function save() {
  try {
    const e = edit.value;
    if (e.id) await api.put(`/programs/${e.id}`, e); else await api.post("/programs", e);
    invalidate(["routines", "home"]); edit.value = null;
  } catch (err) { toastError(err); }
}
async function del(p: any) { if (await confirm(`Delete ${p.name}?`, { text: "Its routines and workouts stay.", ok: "Delete", danger: true })) { await api.del(`/programs/${p.id}`); invalidate(["routines", "home"]); } }
const start = (p: any) => router.push(`/routines/${p.state.next.routineId}/start?program=${p.id}${p.state.next.deload ? `&deload=${p.deloadPct}` : ""}`);
const copyWeek = (i: number) => { const w = edit.value.weeks[i]; edit.value.weeks.splice(i + 1, 0, { days: [...w.days], deload: false }); };
</script>

<template>
  <section>
    <div class="sh"><h2>Programs</h2><button class="lnk" @click="blank">New program</button></div>
    <div v-if="!programs.data.value?.length" class="card tiny">A program puts routines in order over weeks (e.g. A, B, A then B, A, B) with deload weeks. Motus then tells you what's next.</div>
    <div class="grid gauto">
      <div v-for="p in programs.data.value ?? []" :key="p.id" class="card">
        <div class="row"><b class="grow">{{ p.name }}</b><Menu :items="[{ label: 'Edit', icon: 'edit', run: () => editP(p) }, { label: p.active ? 'Pause' : 'Resume', icon: 'pause', run: async () => { await api.put(`/programs/${p.id}`, { active: !p.active }); invalidate(['routines']); } }, { label: 'Delete', icon: 'trash', danger: true, run: () => del(p) }]" /></div>
        <div class="tiny">{{ p.weeks.length }} weeks · {{ p.state.done }} of {{ p.state.total }} workouts done{{ p.active ? "" : " · paused" }}</div>
        <div class="pbar" style="margin:10px 0"><i :style="{ width: (p.state.total ? p.state.done / p.state.total : 0) * 100 + '%' }" /></div>
        <div v-if="!p.active" class="tiny">Paused. Resume it from ⋮ to carry on where you left off.</div>
        <div v-else-if="p.state.next" class="row"><div class="grow"><div style="font-weight:600">Next: {{ p.state.next.name }}</div><div class="tiny">Week {{ p.state.next.week }}, day {{ p.state.next.day }}{{ p.state.next.deload ? ` · deload (−${p.deloadPct}%)` : "" }}</div></div><button class="btn o s" @click="start(p)"><Icon name="play" :size="14" />Start</button></div>
        <div v-else class="tiny pos">Program complete</div>
      </div>
    </div>
    <Sheet v-if="edit" :title="edit.id ? 'Edit program' : 'New program'" size="wide" @close="edit = null">
      <div class="frow"><div class="fld"><label>Name</label><input v-model="edit.name" placeholder="e.g. 8-week push/pull/legs" /></div><div class="fld"><label>Starts</label><input v-model="edit.startDate" type="date" /></div><div class="fld"><label>Deload: lighter by (%)</label><input v-model.number="edit.deloadPct" type="number" min="0" max="90" /></div></div>
      <div v-for="(w, i) in edit.weeks" :key="i" class="card tight" style="margin-bottom:10px">
        <div class="row" style="margin-bottom:6px"><b class="grow">Week {{ i + 1 }}</b><label class="row tiny" style="gap:6px"><span class="tg"><input v-model="w.deload" type="checkbox" /></span>Deload</label><button class="qb" @click="copyWeek(i)">Copy</button><button class="qb danger" @click="edit.weeks.splice(i, 1)">Remove</button></div>
        <div class="chips" style="margin-bottom:6px"><span v-for="(d, j) in w.days" :key="j" class="fchip on" @click="w.days.splice(j, 1)">{{ j + 1 }}. {{ nameOf(d) }} ×</span><span v-if="!w.days.length" class="tiny">Add routines in the order you'll do them:</span></div>
        <div class="chips"><button v-for="r in routines.data.value ?? []" :key="r.id" class="fchip" @click="w.days.push(r.id)">+ {{ r.name }}</button></div>
      </div>
      <button class="qb acc" @click="edit.weeks.push({ days: [...(edit.weeks.at(-1)?.days ?? [])], deload: false })"><Icon name="plus" :size="16" />Add a week</button>
      <template #foot><button class="btn o" @click="edit = null">Cancel</button><button class="btn" @click="save">Save</button></template>
    </Sheet>
  </section>
</template>
