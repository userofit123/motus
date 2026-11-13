<script lang="ts">
import { reactive } from "vue";
// Search, muscle group (or one muscle picked on the body), filters, sort and how far the list is opened. Kept for the session only; the exercise pickers have their own.
export const exercisesView = reactive({ q: "", group: "", equip: "", cat: "", sides: "", only: "" as "" | "mine" | "done" | "fav", sort: "used" as "used" | "name" | "recent", shown: 60 });
</script>

<script setup lang="ts">
// The exercise library: search, filter by muscle group (chips or the body), equipment, category and (with left and right sets on) sides,
// your own exercises, favourites and most used first.
import { computed, ref, toRefs } from "vue";
import { useRoute, useRouter } from "vue-router";
import { GROUPS, EQUIPMENT, CATEGORIES, muscleName, categoryName } from "@motus/shared";
import { useExercises, useSettings, loaded } from "../api/queries";
import { mediaUrl } from "../api/client";
import { ago } from "../core/format";
import Icon from "../components/Icon.vue";
import SearchField from "../components/SearchField.vue";
import MuscleFig from "../components/MuscleFig.vue";
import ExerciseEditor from "../components/ExerciseEditor.vue";
import Sheet from "../components/Sheet.vue";
import AppSelect from "../components/AppSelect.vue";
import FilterPanel from "../components/FilterPanel.vue";
import MuscleFilter, { musclesOf, valueOf } from "../components/MuscleFilter.vue";

const router = useRouter(), route = useRoute();
const all = useExercises();
const settings = useSettings();
// ?muscle=biceps (from a Home suggestion) opens on that muscle itself, as if picked on the body
// the filters live outside the component (below) so they survive opening an exercise and coming back, or visiting another tab
const view = exercisesView;
if (route.query.muscle) { Object.assign(view, { group: valueOf(String(route.query.muscle)), shown: 60 }); }
const { q, group, equip, cat, sides, only, sort, shown } = toRefs(view);
// one side at a time is an optional feature (Settings → Features): without it the sides filter is gone and ignored
const sidesOn = computed(() => !!settings.value?.features?.unilateral);
const side = computed(() => (sidesOn.value ? sides.value : ""));
const creating = ref(false);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ");
const list = computed(() => {
  const words = norm(q.value).split(" ").filter(Boolean);
  const ms = musclesOf(group.value);
  return (all.data.value ?? []).filter((e) => (!ms.length || e.primaryMuscles.some((m) => ms.includes(m))) && (!equip.value || e.equipment === equip.value) && (!cat.value || e.category === cat.value)
    && (!side.value || !!e.unilateral === (side.value === "one"))
    && (only.value !== "mine" || e.ownerId) && (only.value !== "done" || (e.timesDone ?? 0) > 0) && (only.value !== "fav" || e.favourite)
    && words.every((w) => norm(e.name + " " + e.aliases.join(" ")).includes(w)))
    .sort((a, b) => sort.value === "name" ? a.name.localeCompare(b.name) : sort.value === "recent" ? (b.lastDoneAt ?? "").localeCompare(a.lastDoneAt ?? "") || a.name.localeCompare(b.name)
      : Number(b.favourite) - Number(a.favourite) || (b.timesDone ?? 0) - (a.timesDone ?? 0) || a.name.localeCompare(b.name));
});
// muscle groups stay one tap away; everything else lives behind Filters so the page stays calm
const filtersOpen = ref(false);
const filterCount = computed(() => Number(!!equip.value) + Number(!!cat.value) + Number(!!side.value) + Number(!!only.value) + Number(sort.value !== "used"));
const clearFilters = () => { equip.value = ""; cat.value = ""; sides.value = ""; only.value = ""; sort.value = "used"; shown.value = 60; };
const SIDES_OPTS = [{ value: "", label: "Any" }, { value: "one", label: "One side at a time" }, { value: "both", label: "Both together" }];
// show the page once its data is in, all at once
await loaded(all);
</script>

<template>
  <div class="page">
    <div class="ph"><div><h1>Exercises</h1><div class="sub">{{ all.data.value?.length ?? 0 }} in the library</div></div>
      <div class="acts"><button class="btn keep" @click="creating = true"><Icon name="plus" :size="18" />New exercise</button></div></div>
    <div class="row hgap">
      <SearchField v-model="q" class="grow" placeholder="Search exercises" @input="shown = 60" />
      <button class="ib" aria-label="Filters" title="Filters" @click="filtersOpen = true"><Icon name="filter" /><span v-if="filterCount" class="badge">{{ filterCount }}</span></button>
    </div>
    <FilterPanel :count="`${list.length} exercise${list.length === 1 ? '' : 's'}`" :active="!!group || !!filterCount" @clear="group = ''; clearFilters()">
      <MuscleFilter v-model="group" :groups="GROUPS" place="page" :searching="!!q" />
    </FilterPanel>
    <Sheet v-if="filtersOpen" title="Filters" @close="filtersOpen = false">
      <div class="fld"><label>Show</label><div class="seg block"><button v-for="[k, l] in [['', 'All'], ['fav', 'Favourites'], ['done', 'Done before'], ['mine', 'My own']]" :key="k" :class="{ on: only === k }" @click="only = k as any">{{ l }}</button></div></div>
      <div class="fld"><label>Sort</label><div class="seg block"><button v-for="[k, l] in [['used', 'Most used'], ['recent', 'Recent'], ['name', 'A-Z']]" :key="k" :class="{ on: sort === k }" @click="sort = k as any">{{ l }}</button></div></div>
      <div class="fld"><label>Equipment</label><AppSelect v-model="equip" :options="[{ value: '', label: 'Any' }, ...EQUIPMENT.map((q) => ({ value: q, label: q.replace(/\b\w/g, (c) => c.toUpperCase()) }))]" title="Equipment" /></div>
      <div class="fld"><label>Category</label><AppSelect v-model="cat" :options="[{ value: '', label: 'Any' }, ...CATEGORIES.map((c) => ({ value: c, label: categoryName(c) }))]" title="Category" /></div>
      <div v-if="sidesOn" class="fld"><label>Sides</label><AppSelect v-model="sides" :options="SIDES_OPTS" title="Sides" /></div>
      <template #foot><button class="btn o" :disabled="!filterCount" @click="clearFilters">Clear</button><button class="btn" @click="filtersOpen = false">Show {{ list.length }}</button></template>
    </Sheet>
    <div class="grid gauto">
      <div v-for="e in list.slice(0, shown)" :key="e.id" class="card click tight row" @click="router.push(`/exercises/${e.id}`)">
        <MuscleFig sm :muscles="e.primaryMuscles" :helpers="e.secondaryMuscles" />
        <div class="thumb lg"><img v-if="e.images?.[0]" :src="mediaUrl(e.images[0])" alt="" loading="lazy" /><Icon v-else name="dumbbell" /></div>
        <div class="grow">
          <div style="font-weight:600;line-height:1.3">{{ e.name }} <Icon v-if="e.favourite" name="star" :size="13" style="display:inline;color:var(--acc);vertical-align:-1px" /></div>
          <div class="tiny" style="margin-top:3px">{{ e.primaryMuscles.map(muscleName).join(", ") }}{{ e.equipment ? " · " + e.equipment : "" }}</div>
          <div class="tiny">{{ e.timesDone ? `${e.timesDone}× · ${ago(e.lastDoneAt)}` : e.ownerId ? "Yours" : "" }}</div>
        </div>
      </div>
    </div>
    <div v-if="list.length > shown" class="center spt"><button class="btn o" @click="shown += 90">Show more ({{ list.length - shown }})</button></div>
    <div v-if="all.data.value && !list.length" class="card empty"><b>No exercises match</b><button class="btn tonal" @click="creating = true">Create "{{ q || "a new one" }}"</button></div>
    <ExerciseEditor v-if="creating" :name="q" @close="creating = false" @saved="(id) => router.push(`/exercises/${id}`)" />
  </div>
</template>

<style scoped>
/* a pick on the phone's big body scrolls the count line up to just under the phone's top bar */
:deep(.ffoot) { scroll-margin-top: calc(var(--st) + var(--hg)); }
</style>
