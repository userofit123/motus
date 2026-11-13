<script setup lang="ts">
// Picking a routine from the folders they live in, as on the Routines page: pinned first, then each folder, then the
// rest. Folding a folder here folds it there too (same remembered list), so both read the same way.
import { computed, ref } from "vue";
import { routineTime, type RoutineSummary } from "@motus/shared";
import { useRoutines, useFolders } from "../api/queries";
import { ago } from "../core/format";
import { readJson, writeJson } from "../core/prefs";
import Icon from "./Icon.vue";
import SearchField from "./SearchField.vue";
import Collapse from "./Collapse.vue";

const emit = defineEmits<{ pick: [r: RoutineSummary] }>();
const routines = useRoutines();
const folders = useFolders();
const q = ref("");
const all = computed(() => (routines.data.value ?? []).filter((r) => !r.archived));
const list = computed(() => all.value.filter((r) => r.name.toLowerCase().includes(q.value.toLowerCase())));
const groups = computed(() => {
  const fs = (folders.data.value ?? []) as any[];
  const out: { id: string | null; name: string; items: RoutineSummary[] }[] = [];
  const pinned = list.value.filter((r) => r.pinned);
  if (pinned.length) out.push({ id: "pinned", name: "Pinned", items: pinned });
  // empty folders are left out: there is nothing to pick in them
  for (const f of fs) { const items = list.value.filter((r) => r.folderId === f.id && !r.pinned); if (items.length) out.push({ id: f.id, name: f.name, items }); }
  const rest = list.value.filter((r) => (!r.folderId || !fs.some((f) => f.id === r.folderId)) && !r.pinned);
  if (rest.length) out.push({ id: null, name: out.length ? "Other" : "", items: rest });
  return out;
});
const folded = ref<string[]>(readJson<string[]>("motusFolded", []));
const fkey = (g: { id: string | null }) => g.id ?? "other";
const isFolded = (g: { id: string | null }) => folded.value.includes(fkey(g));
function fold(g: { id: string | null }) { const k = fkey(g); folded.value = isFolded(g) ? folded.value.filter((x) => x !== k) : [...folded.value, k]; writeJson("motusFolded", folded.value); }
</script>

<template>
  <div>
    <SearchField v-if="all.length > 6" v-model="q" class="hgap" placeholder="Search routines" />
    <div v-if="routines.data.value && !list.length" class="empty">{{ q ? "No routine matches that" : "No routines yet" }}</div>
    <section v-for="g in groups" :key="g.id ?? 'none'">
      <div v-if="g.name" class="sh fh">
        <button class="fh-b" :aria-expanded="!isFolded(g)" @click="fold(g)">
          <span class="fi"><Icon :name="g.id === 'pinned' ? 'pin' : g.id ? 'folder' : 'routines'" :size="15" /></span>
          <h2>{{ g.name }}</h2><span class="sep" aria-hidden="true">·</span><span class="fn">{{ g.items.length }}</span>
          <Icon name="down" :size="16" class="fc" :class="{ shut: isFolded(g) }" />
        </button>
      </div>
      <Collapse :open="!isFolded(g) || !!q"><div class="list">
        <div v-for="r in g.items" :key="r.id" class="li click" @click="emit('pick', r)">
          <span class="dot" :style="r.color ? { background: r.color } : undefined" />
          <div class="grow"><div class="t">{{ r.name }}</div><div class="s">{{ r.exerciseCount }} exercises · {{ routineTime(r.estimateS, r.usual) }} · {{ r.lastDoneAt ? `last done ${ago(r.lastDoneAt)}` : "not done yet" }}</div></div>
          <Icon name="play" :size="16" class="go" />
        </div>
      </div></Collapse>
    </section>
  </div>
</template>

<style scoped>
/* the folder headers, as on the Routines page */
.sh.fh { justify-content: flex-start; gap: 4px; }
section:first-of-type .sh.fh { margin-top: 0; }
.fh-b { display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; color: var(--tx); cursor: pointer; padding: 4px 8px 4px 0; border-radius: var(--r-sm); min-width: 0; }
.fh-b h2 { margin: 0; }
.fi { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; background: var(--s2); color: var(--acc); flex: none; }
.fn { color: var(--tx2); font-size: 13px; font-weight: 500; }
.fc { color: var(--tx2); transition: transform .2s; }
.fc.shut { transform: rotate(-90deg); }
html.he .fc.shut { transform: rotate(90deg); }
.go { color: var(--acc); flex: none; }
</style>
