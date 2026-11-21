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

// icon: what tapping a row does (play: start it, as the Start sheet; plus: add it, as a program's Add routines).
// marked/markLabel: routines already in what they're picked for, said in a small label after the name (a program's
// routines: picking one again still adds it, so the tap keeps its icon). The label sits on the name's line, which has
// room to spare, so a marked row is no taller than the others.
// title: the heading of the routines when they have no folder headers (no pinned, no folders), for a sheet where they
// follow other blocks; with folders, the folder headers are the headings, so no second heading stacks on top. It sits
// above the search, as the heading of everything below it, and folds under its own key: the same routines have no
// header on the Routines page or the Start sheet, so a fold shared with those could hide them there for good.
// picked: for choosing several in an order (Combine routines): a picked row shows its place, "#1", and a check
const props = withDefaults(defineProps<{ icon?: string; marked?: string[]; markLabel?: string; title?: string; picked?: string[] }>(), { icon: "play", marked: () => [], markLabel: "", title: "", picked: () => [] });
const place = (r: RoutineSummary) => props.picked.indexOf(r.id) + 1;
const isMarked = (r: RoutineSummary) => props.marked.includes(r.id);
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
// decided on all routines, not the searched ones, so the heading stays put while typing
const titled = computed(() => {
  const ids = new Set(((folders.data.value ?? []) as any[]).map((f) => f.id));
  return !!props.title && all.value.length > 0 && !all.value.some((r) => r.pinned || (r.folderId && ids.has(r.folderId)));
});
const head = { id: "titled", name: props.title };
const folded = ref<string[]>(readJson<string[]>("motusFolded", []));
const fkey = (g: { id: string | null }) => g.id ?? "other";
// only a group with a header can be folded: a fold saved by another screen (where the group had a header) never hides
// a headerless group here, which would have no way to unfold
const isFolded = (g: { id: string | null; name: string }) => !!g.name && folded.value.includes(fkey(g));
function fold(g: { id: string | null; name: string }) { const k = fkey(g); folded.value = isFolded(g) ? folded.value.filter((x) => x !== k) : [...folded.value, k]; writeJson("motusFolded", folded.value); }
const open = (g: { id: string | null; name: string }) => !(titled.value ? isFolded(head) : isFolded(g)) || !!q.value;
</script>

<template>
  <div>
    <div v-if="titled" class="sh fh first">
      <button class="fh-b" :aria-expanded="!isFolded(head)" @click="fold(head)">
        <span class="fi"><Icon name="routines" :size="15" /></span>
        <h2>{{ head.name }}</h2><span class="sep" aria-hidden="true">·</span><span class="fn">{{ list.length }}</span>
        <Icon name="down" :size="16" class="fc" :class="{ shut: isFolded(head) }" />
      </button>
    </div>
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
      <Collapse :open="open(g)"><div class="list">
        <div v-for="r in g.items" :key="r.id" class="li click" @click="emit('pick', r)">
          <span class="dot" :style="r.color ? { background: r.color } : undefined" />
          <div class="grow"><div class="t">{{ r.name }}<span v-if="isMarked(r)" class="tiny acc mk">{{ markLabel }}</span><span v-if="place(r)" class="tiny acc mk">#{{ place(r) }}</span></div><div class="s">{{ r.exerciseCount }} exercises · {{ routineTime(r.estimateS, r.usual) }} · {{ r.lastDoneAt ? `last done ${ago(r.lastDoneAt)}` : "not done yet" }}</div></div>
          <Icon :name="place(r) ? 'check' : icon" :size="16" class="go" />
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
.go { color: var(--acc); flex: none; }
/* "In this program", after the name with a word's space; kept whole so it moves to the next line as one piece */
.mk { margin-inline-start: .4em; font-weight: 500; white-space: nowrap; }
</style>
