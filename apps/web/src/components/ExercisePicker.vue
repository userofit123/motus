<script setup lang="ts">
// Choosing exercises: search (names and aliases), filter by muscle (chips or the body) and equipment, and behind the filter button by category
// and (with left and right sets on) sides; recently used first; one or many.
import { computed, ref, watch, onMounted, onBeforeUnmount } from "vue";
import { GROUPS, EQUIPMENT, CATEGORIES, categoryName, type Exercise } from "@motus/shared";
import { useExercises, useExercise, useSettings } from "../api/queries";
import { mediaUrl } from "../api/client";
import Sheet from "./Sheet.vue";
import Icon from "./Icon.vue";
import SearchField from "./SearchField.vue";
import MuscleFig from "./MuscleFig.vue";
import ExerciseEditor from "./ExerciseEditor.vue";
import FilterPanel from "./FilterPanel.vue";
import FilterRow from "./FilterRow.vue";
import MuscleFilter, { musclesOf } from "./MuscleFilter.vue";
import ExerciseView from "./ExerciseView.vue";

const props = defineProps<{ title?: string; multi?: boolean; exclude?: string[]; suggest?: Exercise[] }>();
const emit = defineEmits<{ close: []; pick: [ids: string[]] }>();
const all = useExercises();
const settings = useSettings();
// gym profiles (optional feature): only what the active gym has, unless "All equipment" is chosen
const gym = computed(() => (settings.value.features.gyms ? settings.value.gyms.find((g) => g.id === settings.value.activeGym) : null) ?? null);
const anyEquip = ref(false);
const q = ref(""), group = ref(""), equip = ref(""), cat = ref(""), sides = ref(""), picked = ref<string[]>([]), creating = ref(false);
// one side at a time is an optional feature (Settings → Features): without it the sides filter is gone and ignored
const sidesOn = computed(() => !!settings.value.features.unilateral);
const side = computed(() => (sidesOn.value ? sides.value : ""));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ");
const list = computed(() => {
  const words = norm(q.value).split(" ").filter(Boolean);
  const ms = musclesOf(group.value, PICK_GROUPS);
  return (all.data.value ?? []).filter((e) => !e.hidden && !props.exclude?.includes(e.id)
    && (!ms.length || e.primaryMuscles.some((m) => ms.includes(m)))
    && (!equip.value || e.equipment === equip.value)
    && (!cat.value || e.category === cat.value)
    && (!side.value || !!e.unilateral === (side.value === "one"))
    && (!gym.value || anyEquip.value || !e.equipment || gym.value.equipment.includes(e.equipment))
    && words.every((w) => norm(e.name + " " + e.aliases.join(" ")).includes(w)))
    .sort((a, b) => Number(b.favourite) - Number(a.favourite) || (b.timesDone ?? 0) - (a.timesDone ?? 0) || (b.lastDoneAt ?? "").localeCompare(a.lastDoneAt ?? "") || a.name.localeCompare(b.name))
    .slice(0, 150);
});
// shorter, friendlier names for the catalog's equipment
const EQ_NAME: Record<string, string> = { "body only": "Bodyweight", "e-z curl bar": "EZ bar", kettlebells: "Kettlebell", "medicine ball": "Medicine ball", "exercise ball": "Exercise ball", "foam roll": "Foam roller" };
const CAT_OPTS = CATEGORIES.map((c) => ({ value: c, label: categoryName(c) }));
const SIDES_OPTS = [{ value: "one", label: "One side at a time" }, { value: "both", label: "Both together" }];
const eqName = (e: string) => EQ_NAME[e] ?? e[0]!.toUpperCase() + e.slice(1);
// the muscle groups, with biceps and triceps on their own after Arms: people often pick an exercise for just one
const PICK_GROUPS = GROUPS.flatMap((g) => g.id === "arms" ? [g, { id: "biceps", name: "Biceps", muscles: ["biceps"] }, { id: "triceps", name: "Triceps", muscles: ["triceps"] }] : [g]);
const EQUIP_OPTS = EQUIPMENT.map((e) => ({ value: e, label: eqName(e) }));
const showSuggest = computed(() => !!props.suggest?.length && !q.value && !filtered.value);
// category and sides wait behind the filter button so the list keeps its room with the keyboard up; setting one opens
// them, and they can be folded away again with the badge still counting what's set
const moreOpen = ref(false);
const moreCount = computed(() => Number(!!cat.value) + Number(!!side.value));
watch(moreCount, (n) => { if (n) moreOpen.value = true; });
const filtered = computed(() => !!group.value || !!equip.value || !!moreCount.value || (!!gym.value && anyEquip.value));
function clear() { group.value = ""; equip.value = ""; cat.value = ""; sides.value = ""; anyEquip.value = false; moreOpen.value = false; }
function tap(id: string) {
  if (!props.multi) { emit("pick", [id]); return; }
  const i = picked.value.indexOf(id);
  if (i >= 0) picked.value.splice(i, 1); else picked.value.push(id);
}
// The info button opens a preview that steps through exactly the list on screen (its search, filters and order),
// taken when it opens so that starring an exercise there doesn't reshuffle what's next; pick or untick from there too.
const shown = computed<Exercise[]>(() => (showSuggest.value ? props.suggest! : list.value));
const pv = ref<{ ids: string[]; i: number } | null>(null);
const pvId = computed(() => (pv.value ? pv.value.ids[pv.value.i]! : ""));
// the live name, so renaming it from the preview's ⋮ Edit shows at once
const pvEx = useExercise(pvId);
const pvName = computed(() => pvEx.data.value?.name ?? (all.data.value ?? []).find((e) => e.id === pvId.value)?.name ?? "");
const pvSheet = ref<InstanceType<typeof Sheet> | null>(null);
const dir = ref("nx");
function preview(id: string) {
  const ids = shown.value.map((e) => e.id);
  pv.value = { ids, i: Math.max(0, ids.indexOf(id)) };
}
function step(d: number) {
  const p = pv.value, i = p ? p.i + d : -1;
  if (!p || i < 0 || i >= p.ids.length) return;
  dir.value = d > 0 ? "nx" : "pv"; p.i = i;
}
function choose(id: string) { if (props.multi) tap(id); else { pv.value = null; emit("pick", [id]); } }
// a computer: the arrow keys; the phone: a sideways swipe on the preview (not on its tabs, chips or charts, which
// scroll or react to touch themselves, nor the screen edges, which belong to the phone's own Back gesture)
const key = (e: KeyboardEvent) => {
  if (!pv.value || !pvSheet.value?.onTop() || (e.key !== "ArrowLeft" && e.key !== "ArrowRight") || (e.target as HTMLElement).closest("input,textarea,select,[contenteditable]")) return;
  e.preventDefault(); step(e.key === "ArrowRight" ? 1 : -1);
};
onMounted(() => addEventListener("keydown", key));
onBeforeUnmount(() => removeEventListener("keydown", key));
// the sticky search's real height (it grows with the text size and density), so a pick can scroll the filters to just under it
const bar = ref<HTMLElement>();
const barH = ref(0);
const sizer = new ResizeObserver(([e]) => (barH.value = (e!.target as HTMLElement).offsetHeight));
onMounted(() => bar.value && sizer.observe(bar.value));
onBeforeUnmount(() => sizer.disconnect());
let x0 = 0, y0 = 0, t0 = 0, ok = false;
function ts(e: TouchEvent) {
  const t = e.touches[0]!; x0 = t.clientX; y0 = t.clientY; t0 = Date.now();
  ok = e.touches.length === 1 && x0 > 24 && x0 < innerWidth - 24
    && !(e.target as HTMLElement).closest("input, textarea, select, .hscroll, .chips, .seg, .tabs, .chart, .mnu, [data-noswipe]");
}
function te(e: TouchEvent) {
  if (!ok || !pvSheet.value?.onTop()) return;
  const t = e.changedTouches[0]!, dx = t.clientX - x0, dy = t.clientY - y0;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.3 && Date.now() - t0 < 900) step(dx < 0 ? 1 : -1); // a natural thumb swipe drifts a little
}
</script>

<template>
  <Sheet :title="title ?? 'Add exercises'" size="wide" @close="emit('close')">
    <div ref="bar" class="row hgap pksearch">
      <SearchField v-model="q" class="grow" placeholder="Search exercises" autofocus />
      <button class="ib" aria-label="Filters" title="Filters" :aria-expanded="moreOpen" @click="moreOpen = !moreOpen"><Icon name="filter" /><span v-if="moreCount" class="badge">{{ moreCount }}</span></button>
    </div>
    <FilterPanel :style="barH ? { '--pkbar': `${barH}px` } : undefined" :count="showSuggest ? 'Works the same muscles' : `${list.length === 150 ? '150+' : list.length} exercises`" :active="filtered" @clear="clear">
      <MuscleFilter v-model="group" :groups="PICK_GROUPS" place="picker" :search="q" />
      <FilterRow v-if="!gym" v-model="equip" label="Equipment" all="Any" :options="EQUIP_OPTS" />
      <!-- with a gym profile the row starts with what that gym has, then "Any" -->
      <FilterRow v-else label="Equipment">
        <button class="fchip" :class="{ on: !anyEquip && !equip }" @click="anyEquip = false; equip = ''">At {{ gym.name }}</button><button class="fchip" :class="{ on: anyEquip && !equip }" @click="anyEquip = true; equip = ''">Any</button>
        <button v-for="o in EQUIP_OPTS" :key="o.value" class="fchip" :class="{ on: equip === o.value }" @click="equip = equip === o.value ? '' : o.value">{{ o.label }}</button>
      </FilterRow>
      <template v-if="moreOpen">
        <FilterRow v-model="cat" label="Category" all="Any" :options="CAT_OPTS" />
        <FilterRow v-if="sidesOn" v-model="sides" label="Sides" all="Any" :options="SIDES_OPTS" />
      </template>
    </FilterPanel>
    <div class="list">
      <div v-for="e in (showSuggest ? suggest : list)" :key="e.id" class="li click" @click="tap(e.id)">
        <MuscleFig sm :muscles="e.primaryMuscles" :helpers="e.secondaryMuscles" />
        <div class="thumb"><img v-if="e.images?.[0]" :src="mediaUrl(e.images[0])" alt="" loading="lazy" /><Icon v-else name="dumbbell" /></div>
        <div class="grow"><div class="t">{{ e.name }}</div><div class="s"><span style="text-transform:capitalize">{{ e.primaryMuscles.join(", ") }}</span>{{ e.equipment ? " · " + eqName(e.equipment) : "" }}{{ e.timesDone ? ` · done ${e.timesDone}×` : "" }}</div></div>
        <button class="ib sm plain" aria-label="About this exercise" @click.stop="preview(e.id)"><Icon name="info" :size="18" /></button>
        <span v-if="multi" class="tick" :class="{ on: picked.includes(e.id) }"><Icon v-if="picked.includes(e.id)" name="check" :size="18" /></span>
      </div>
      <div v-if="!list.length" class="empty"><b>No match</b><button class="btn tonal" @click="creating = true">Create "{{ q }}"</button></div>
    </div>
    <template #foot>
      <button class="qb" @click="creating = true"><Icon name="plus" :size="16" />New exercise</button>
      <div class="grow" />
      <button v-if="multi" class="btn" :disabled="!picked.length" @click="emit('pick', picked)">Add {{ picked.length || "" }}</button>
    </template>
    <Sheet v-if="pv" ref="pvSheet" :title="pvName" size="wide" @close="pv = null">
      <div class="pvx" @touchstart.passive="ts" @touchend.passive="te">
        <Transition :name="dir" mode="out-in"><ExerciseView :key="pvId" :id="pvId" in-sheet /></Transition>
      </div>
      <template #foot>
        <template v-if="pv!.ids.length > 1">
          <button class="ib sm plain" aria-label="Previous exercise" :disabled="pv!.i === 0" @click="step(-1)"><Icon name="left" :size="18" /></button>
          <span class="tiny pvn">{{ pv!.i + 1 }} of {{ pv!.ids.length }}</span>
          <button class="ib sm plain" aria-label="Next exercise" :disabled="pv!.i === pv!.ids.length - 1" @click="step(1)"><Icon name="right" :size="18" /></button>
        </template>
        <div class="grow" />
        <button v-if="multi" class="btn" :class="{ tonal: picked.includes(pvId) }" @click="choose(pvId)"><Icon v-if="picked.includes(pvId)" name="check" :size="16" />{{ picked.includes(pvId) ? "Selected" : "Select" }}</button>
        <button v-else class="btn" @click="choose(pvId)">Choose</button>
      </template>
    </Sheet>
    <ExerciseEditor v-if="creating" :name="q" @close="creating = false" @saved="(id) => (multi ? picked.push(id) : emit('pick', [id]))" />
  </Sheet>
</template>


<style scoped>
/* the search stays on top while the filters and the list scroll under it (-4px cancels the sheet body's top padding),
   on the sheet's own background */
.pksearch { position: sticky; top: -4px; z-index: 1; background: var(--bg); padding-block: 4px; margin-bottom: var(--hg); }
/* a pick on the phone's big body scrolls the count line up so the filter card ends exactly under that search: the bar's
   measured height (its -4px and the body's 4px top padding cancel out) plus the 2px between the card and the count line
   (FilterPanel .ffoot) */
:deep(.ffoot) { scroll-margin-top: calc(var(--pkbar, 56px) + 2px); }
/* the whole preview takes the swipe, even below short content */
.pvx { min-height: 100%; overflow-x: hidden; }
/* open like a picked filter chip */
.ib[aria-expanded="true"] { background: var(--accc); color: var(--onc); border-color: transparent; }
.pvn { align-self: center; min-width: 6ch; text-align: center; font-variant-numeric: tabular-nums; }
</style>
