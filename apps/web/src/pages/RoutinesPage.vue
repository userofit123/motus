<script setup lang="ts">
// All routines (requirement 13), in folders, pinned first; start, preview, edit, duplicate, base a new one on it, archive.
// With programs switched on, they get a tab of their own next to the routines.
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { routineTime, muscleName, type RoutineSummary } from "@motus/shared";
import MuscleFig from "../components/MuscleFig.vue";
import { useRoutines, useFolders, usePrograms, loaded } from "../api/queries";
import { api } from "../api/client";
import { ago } from "../core/format";
import { readJson, writeJson } from "../core/prefs";
import { confirm, prompt } from "../core/ask";
import { toast } from "../core/toast";
import { invalidate } from "../api/live";
import Icon from "../components/Icon.vue";
import Menu from "../components/Menu.vue";
import Collapse from "../components/Collapse.vue";
import Sheet from "../components/Sheet.vue";
import ProgramsSection from "../components/ProgramsSection.vue";
import TemplateList from "../components/TemplateList.vue";
import { useSettings } from "../api/queries";
import { useRoutineMenu } from "../core/routineMenu";

const route = useRoute(), router = useRouter();
const settings = useSettings();
const tab = ref(route.query.tab === "programs" ? "programs" : "routines");
watch(tab, (t) => router.replace({ query: t === "programs" ? { tab: t } : {} }));
// Programs switched off: no tabs, and a remembered ?tab=programs falls back to the routines
const onPrograms = computed(() => settings.value.features.programs && tab.value === "programs");
const programsRef = ref<InstanceType<typeof ProgramsSection> | null>(null);
const programs = usePrograms();
const showArchived = ref(false);
const routines = useRoutines();
const archived = useRoutines(true);
const folders = useFolders();
const q = ref("");
const fromTemplate = ref(route.query.template === "1"); // Home's first-run card opens the templates straight away
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
// folded folders are remembered on this device (a search shows everything)
const folded = ref<string[]>(readJson<string[]>("motusFolded", []));
const fkey = (g: { id: string | null }) => g.id ?? "other";
const isFolded = (g: { id: string | null }) => folded.value.includes(fkey(g));
function fold(g: { id: string | null }) { const k = fkey(g); folded.value = isFolded(g) ? folded.value.filter((x) => x !== k) : [...folded.value, k]; writeJson("motusFolded", folded.value); }
async function newFolder() {
  const name = await prompt("New folder", { placeholder: "e.g. Push / Pull / Legs" });
  if (name) { await api.post("/folders", { name }); invalidate(["routines"]); toast("Folder created"); }
}
async function renameFolder(f: { id: string; name: string }) { const n = await prompt("Rename folder", { value: f.name }); if (n) { await api.put(`/folders/${f.id}`, { name: n }); invalidate(["routines"]); toast("Folder renamed"); } }
async function delFolder(f: { id: string; name: string }) { if (await confirm(`Delete the folder ${f.name}?`, { text: "Its routines stay, without a folder.", ok: "Delete", danger: true })) { await api.del(`/folders/${f.id}`); invalidate(["routines"]); toast("Folder deleted"); } }
async function useTemplate(slug: string) {
  const r = await api.post("/routines", { template: slug });
  invalidate(["routines"]);
  fromTemplate.value = false;
  toast("Routine created");
  router.push(`/routines/${r.id}`);
}
const menuFor = useRoutineMenu();
const items = (r: RoutineSummary) => menuFor(r);
// show the page once its data is in, all at once
// the programs below are read here too, so they arrive with the routines rather than after them
await loaded(routines, folders, ...(settings.value.features.programs ? [programs] : []));
</script>

<template>
  <div class="page">
    <div class="ph">
      <div><h1>Routines</h1><div class="sub">{{ onPrograms ? `${programs.data.value?.length ?? 0} program${programs.data.value?.length === 1 ? "" : "s"}` : `${routines.data.value?.filter((r) => !r.archived).length ?? 0} routines` }}</div></div>
      <div class="acts">
        <template v-if="onPrograms"><button class="btn keep" @click="programsRef?.create()"><Icon name="plus" :size="18" />New program</button></template>
        <template v-else>
          <Menu :items="[{ label: 'New folder', icon: 'folder', run: newFolder }, { label: 'From a template', icon: 'layers', run: () => (fromTemplate = true) }, { label: showArchived ? 'Hide archived' : 'Show archived', icon: 'archive', run: () => (showArchived = !showArchived) }]" />
          <button class="btn keep" @click="router.push('/routines/new/edit')"><Icon name="plus" :size="18" />New routine</button>
        </template>
      </div>
    </div>
    <div v-if="settings.features.programs" class="tabs"><button :class="{ on: !onPrograms }" @click="tab = 'routines'">Routines</button><button :class="{ on: onPrograms }" @click="tab = 'programs'">Programs</button></div>
<Transition name="sw" mode="out-in">
    <div v-if="onPrograms" key="programs"><ProgramsSection ref="programsRef" /></div>
    <div v-else key="routines">
    <div v-if="(routines.data.value?.length ?? 0) > 6" class="search hgap"><Icon name="search" :size="18" /><input v-model="q" placeholder="Search routines" /></div>
    <div v-if="showArchived" class="banner note"><Icon name="archive" />Showing archived routines<button class="qb acc" style="margin-inline-start:auto;padding:0 6px" @click="showArchived = false">Done</button></div>

    <div v-if="routines.data.value && !list.length && !showArchived" class="card empty">
      <Icon name="routines" :size="34" /><b>No routines yet</b>A routine is a saved plan: exercises, sets, reps, weights and rest times.
      <div class="row" style="justify-content:center;margin-top:14px"><button class="btn" @click="router.push('/routines/new/edit')">Create one</button><button class="btn tonal" @click="fromTemplate = true">Start from a template</button></div>
    </div>

    <section v-for="g in groups" :key="g.id ?? 'none'">
      <div v-if="g.name" class="sh fh">
        <button class="fh-b" :aria-expanded="!isFolded(g)" @click="fold(g)">
          <span class="fi"><Icon :name="g.id === 'pinned' ? 'pin' : g.id ? 'folder' : 'routines'" :size="15" /></span>
          <h2>{{ g.name }}</h2><span class="sep" aria-hidden="true">·</span><span class="fn">{{ g.items.length }}</span>
          <Icon name="down" :size="16" class="fc" :class="{ shut: isFolded(g) }" />
        </button>
        <Menu v-if="g.id && g.id !== 'pinned'" :items="[{ label: 'Rename', icon: 'edit', run: () => renameFolder(g as any) }, { label: 'Delete folder', icon: 'trash', danger: true, run: () => delFolder(g as any) }]" /></div>
      <Collapse :open="!isFolded(g) || !!q">
      <div v-if="!g.items.length" class="tiny hgap">Empty. Move a routine here from its ⋮ menu.</div>
      <div class="grid gauto rgrid">
        <div v-for="r in g.items" :key="r.id" class="card click rcard" :class="{ wbody: r.muscles.length }" @click="router.push(`/routines/${r.id}`)">
          <!-- the muscles this routine works, at a glance, down the whole left side; the routine's colour is the dot by the name -->
          <MuscleFig :muscles="r.muscles" :helpers="r.helpers" />
          <div class="rmain">
            <div class="row" style="align-items:flex-start">
              <div class="grow" style="min-width:0"><div class="row" style="gap:8px"><span class="dot" :style="{ background: r.color ?? undefined }" /><span class="ellipsis" style="font-weight:600;font-size:15.5px">{{ r.name }}</span></div><div class="tiny" style="margin-top:2px">{{ r.exerciseCount }} exercises · {{ routineTime(r.estimateS, r.usual) }}</div></div>
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
      </div>
      </Collapse>
    </section>
    </div>
</Transition>

    <Sheet v-if="fromTemplate" title="Start from a template" size="wide" @close="fromTemplate = false">
      <p class="tiny hgap">A copy is added to your routines, ready to change.</p>
      <TemplateList @pick="useTemplate" />
    </Sheet>
  </div>
</template>

<style scoped>
/* wide enough for the body plus the text beside it (the body itself: .wbody / .rbody in app.css) */
.rgrid { grid-template-columns: repeat(auto-fill, minmax(min(100%, 360px), 1fr)); }
.rmain { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.fh { justify-content: flex-start; gap: 4px; }
.fh-b { display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; color: var(--tx); cursor: pointer; padding: 4px 8px 4px 0; border-radius: var(--r-sm); min-width: 0; }
.fh-b h2 { margin: 0; }
.fi { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; background: var(--s2); color: var(--acc); flex: none; }
.fn { color: var(--tx2); font-size: 13px; font-weight: 500; }
.fc { color: var(--tx2); transition: transform .2s; }
.fc.shut { transform: rotate(-90deg); }
html.he .fc.shut { transform: rotate(90deg); }
</style>

