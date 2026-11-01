<script setup lang="ts">
// All routines (requirement 13), in folders, pinned first; start, preview, edit, duplicate, base a new one on it, archive.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { duration, muscleName, type RoutineSummary } from "@motus/shared";
import { useRoutines, useFolders, useChange, useTemplates } from "../api/queries";
import { api } from "../api/client";
import { ago } from "../core/format";
import { confirm, prompt, choose } from "../core/ask";
import { toast } from "../core/toast";
import { invalidate } from "../api/live";
import Icon from "../components/Icon.vue";
import Menu from "../components/Menu.vue";
import Sheet from "../components/Sheet.vue";
import ProgramsSection from "../components/ProgramsSection.vue";
import { useSettings } from "../api/queries";

const router = useRouter();
const settings = useSettings();
const showArchived = ref(false);
const routines = useRoutines();
const archived = useRoutines(true);
const folders = useFolders();
const templates = useTemplates();
const q = ref("");
const fromTemplate = ref(false);
const list = computed(() => (showArchived.value ? archived.data.value ?? [] : (routines.data.value ?? []).filter((r) => !r.archived)).filter((r) => r.name.toLowerCase().includes(q.value.toLowerCase())));
const groups = computed(() => {
  const fs = (folders.data.value ?? []) as any[];
  const out: { id: string | null; name: string; items: RoutineSummary[] }[] = [];
  const pinned = list.value.filter((r) => r.pinned);
  if (pinned.length && !showArchived.value) out.push({ id: "pinned", name: "Pinned", items: pinned });
  for (const f of fs) { const items = list.value.filter((r) => r.folderId === f.id && (!r.pinned || showArchived.value)); if (items.length || !q.value) out.push({ id: f.id, name: f.name, items }); }
  const rest = list.value.filter((r) => (!r.folderId || !fs.some((f) => f.id === r.folderId)) && (!r.pinned || showArchived.value));
  if (rest.length) out.push({ id: null, name: fs.length || pinned.length ? "Other" : "", items: rest });
  return out;
});
const upd = useChange((id: string, b: any) => api.put(`/routines/${id}`, b), ["routines"]);
const dup = useChange((id: string) => api.post(`/routines/${id}/duplicate`), ["routines"]);
async function del(r: RoutineSummary) {
  if (!(await confirm(`Delete ${r.name}?`, { text: "Its past workouts stay in your history.", ok: "Delete", danger: true }))) return;
  await api.del(`/routines/${r.id}`);
  invalidate(["routines", "home"]);
  toast("Routine deleted", { action: { label: "Undo", run: async () => { await api.post(`/routines/${r.id}/restore`); invalidate(["routines", "home"]); } } });
}
async function newFolder() {
  const name = await prompt("New folder", { placeholder: "e.g. Push / Pull / Legs" });
  if (name) { await api.post("/folders", { name }); invalidate(["routines"]); }
}
async function moveTo(r: RoutineSummary) {
  const fs = (folders.data.value ?? []) as any[];
  const v = await choose(`Move ${r.name} to`, [...fs.map((f) => ({ label: f.name, value: f.id })), { label: "No folder", value: "" }, { label: "New folder…", value: "__new" }]);
  if (v == null) return;
  let fid: string | null = v || null;
  if (v === "__new") { const name = await prompt("New folder"); if (!name) return; fid = (await api.post("/folders", { name })).id; }
  await upd.run(r.id, { folderId: fid });
}
async function renameFolder(f: { id: string; name: string }) { const n = await prompt("Rename folder", { value: f.name }); if (n) { await api.put(`/folders/${f.id}`, { name: n }); invalidate(["routines"]); } }
async function delFolder(f: { id: string; name: string }) { if (await confirm(`Delete the folder ${f.name}?`, { text: "Its routines stay, without a folder.", ok: "Delete", danger: true })) { await api.del(`/folders/${f.id}`); invalidate(["routines"]); } }
async function useTemplate(slug: string) {
  const r = await api.post("/routines", { template: slug });
  invalidate(["routines"]);
  fromTemplate.value = false;
  router.push(`/routines/${r.id}`);
}
const items = (r: RoutineSummary) => [
  { label: "Start", icon: "play", run: () => router.push(`/routines/${r.id}/start`) },
  { label: "Edit", icon: "edit", run: () => router.push(`/routines/${r.id}/edit`) },
  { label: "Duplicate", icon: "copy", run: () => dup.run(r.id) },
  { label: "New routine based on this", icon: "layers", run: async () => { const n = await prompt("Name the new routine", { value: r.name + " v2" }); if (n) { const x = await api.post("/routines", { fromRoutineId: r.id, name: n }); invalidate(["routines"]); router.push(`/routines/${x.id}/edit`); } } },
  { label: r.pinned ? "Unpin" : "Pin to top", icon: "pin", run: () => upd.run(r.id, { pinned: !r.pinned }) },
  { label: "Move to folder", icon: "folder", run: () => moveTo(r) },
  { label: r.archived ? "Restore from archive" : "Archive", icon: "archive", run: () => upd.run(r.id, { archived: !r.archived }) },
  { label: "Delete", icon: "trash", danger: true, sep: true, run: () => del(r) },
];
const tgroups = computed(() => { const m = new Map<string, any[]>(); for (const t of templates.data.value ?? []) m.set(t.group, [...(m.get(t.group) ?? []), t]); return [...m]; });
</script>

<template>
  <div class="page">
    <div class="ph">
      <div><h1>Routines</h1><div class="sub">{{ routines.data.value?.filter((r) => !r.archived).length ?? 0 }} routines</div></div>
      <div class="acts">
        <button class="btn keep" @click="router.push('/routines/new/edit')"><Icon name="plus" :size="18" />New routine</button>
        <Menu :items="[{ label: 'New folder', icon: 'folder', run: newFolder }, { label: 'From a template', icon: 'layers', run: () => (fromTemplate = true) }, { label: showArchived ? 'Hide archived' : 'Show archived', icon: 'archive', run: () => (showArchived = !showArchived) }]" />
      </div>
    </div>
    <div v-if="(routines.data.value?.length ?? 0) > 6" class="search" style="margin-bottom:6px;max-width:360px"><Icon name="search" :size="18" /><input v-model="q" placeholder="Search routines" /></div>
    <div v-if="showArchived" class="banner note"><Icon name="archive" />Showing archived routines<button class="qb acc" style="margin-inline-start:auto;padding:0 6px" @click="showArchived = false">Done</button></div>

    <div v-if="routines.data.value && !list.length && !showArchived" class="card empty">
      <Icon name="routines" :size="34" /><b>No routines yet</b>A routine is a saved plan: exercises, sets, reps, weights and rest times.
      <div class="row" style="justify-content:center;margin-top:14px"><button class="btn" @click="router.push('/routines/new/edit')">Create one</button><button class="btn tonal" @click="fromTemplate = true">Start from a template</button></div>
    </div>

    <section v-for="g in groups" :key="g.id ?? 'none'">
      <div v-if="g.name" class="sh"><h2><Icon v-if="g.id === 'pinned'" name="pin" :size="13" style="display:inline;vertical-align:-2px;margin-inline-end:4px" />{{ g.name }}</h2>
        <Menu v-if="g.id && g.id !== 'pinned'" :items="[{ label: 'Rename', icon: 'edit', run: () => renameFolder(g as any) }, { label: 'Delete folder', icon: 'trash', danger: true, run: () => delFolder(g as any) }]" /></div>
      <div v-if="!g.items.length" class="tiny" style="padding:4px 0 8px">Empty. Move a routine here from its ⋮ menu.</div>
      <div class="grid gauto">
        <div v-for="r in g.items" :key="r.id" class="card click rcard" @click="router.push(`/routines/${r.id}`)">
          <div class="row" style="align-items:flex-start">
            <span class="dot" :style="{ marginTop: '6px', background: r.color ?? undefined }" />
            <div class="grow"><div style="font-weight:600;font-size:15.5px">{{ r.name }}</div><div class="tiny" style="margin-top:2px">{{ r.exerciseCount }} exercises · ~{{ duration(r.estimateS, true) }}</div></div>
            <span @click.stop><Menu :items="items(r)" /></span>
          </div>
          <div class="tiny ellipsis" style="margin:10px 0 0">{{ r.exerciseNames.join(" · ") || "No exercises yet" }}</div>
          <div class="chips" style="margin-top:8px"><span v-for="m in r.muscles.slice(0, 4)" :key="m" class="mchip">{{ muscleName(m) }}</span></div>
          <div class="row" style="margin-top:auto;padding-top:12px">
            <span class="tiny grow">{{ r.lastDoneAt ? `Last done ${ago(r.lastDoneAt)} · ${r.timesDone}×` : "Not done yet" }}<template v-if="r.pendingReminders"> · <Icon name="bell" :size="12" style="display:inline;vertical-align:-1px" /> {{ r.pendingReminders }}</template></span>
            <button class="btn o s" @click.stop="router.push(`/routines/${r.id}/start`)"><Icon name="play" :size="14" />Start</button>
          </div>
        </div>
      </div>
    </section>

    <ProgramsSection v-if="settings.features.programs && !showArchived" />

    <Sheet v-if="fromTemplate" title="Start from a template" size="wide" @close="fromTemplate = false">
      <p class="tiny" style="margin-bottom:6px">A copy is added to your routines, ready to change.</p>
      <template v-for="[grp, ts] in tgroups" :key="grp"><h2>{{ grp }}</h2>
        <div class="list"><div v-for="t in ts" :key="t.slug" class="li click" @click="useTemplate(t.slug)"><div class="grow"><div class="t">{{ t.name }}</div><div class="s">{{ t.description }} · {{ t.exercises }} exercises</div></div><Icon name="plus" /></div></div>
      </template>
    </Sheet>
  </div>
</template>
