<script setup lang="ts">
// The exercise library: search, filter by muscle group and equipment, your own exercises, favourites and most used first.
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { GROUPS, EQUIPMENT, muscleName, groupOf } from "@motus/shared";
import { useExercises } from "../api/queries";
import { mediaUrl } from "../api/client";
import { ago } from "../core/format";
import Icon from "../components/Icon.vue";
import ExerciseEditor from "../components/ExerciseEditor.vue";
import Sheet from "../components/Sheet.vue";

const router = useRouter(), route = useRoute();
const all = useExercises();
// ?muscle=biceps (from a Home suggestion) opens on that muscle's group
const q = ref(""), group = ref(route.query.muscle ? groupOf(String(route.query.muscle)) : ""), equip = ref(""), only = ref<"" | "mine" | "done" | "fav">(""), sort = ref<"used" | "name" | "recent">("used");
const creating = ref(false);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ");
const list = computed(() => {
  const words = norm(q.value).split(" ").filter(Boolean);
  const g = GROUPS.find((x) => x.id === group.value);
  return (all.data.value ?? []).filter((e) => (!g || e.primaryMuscles.some((m) => g.muscles.includes(m))) && (!equip.value || e.equipment === equip.value)
    && (only.value !== "mine" || e.ownerId) && (only.value !== "done" || (e.timesDone ?? 0) > 0) && (only.value !== "fav" || e.favourite)
    && words.every((w) => norm(e.name + " " + e.aliases.join(" ")).includes(w)))
    .sort((a, b) => sort.value === "name" ? a.name.localeCompare(b.name) : sort.value === "recent" ? (b.lastDoneAt ?? "").localeCompare(a.lastDoneAt ?? "") || a.name.localeCompare(b.name)
      : Number(b.favourite) - Number(a.favourite) || (b.timesDone ?? 0) - (a.timesDone ?? 0) || a.name.localeCompare(b.name));
});
const shown = ref(60);
// muscle groups stay one tap away; everything else lives behind Filters so the page stays calm
const filtersOpen = ref(false);
const filterCount = computed(() => Number(!!equip.value) + Number(!!only.value) + Number(sort.value !== "used"));
const clearFilters = () => { equip.value = ""; only.value = ""; sort.value = "used"; };
</script>

<template>
  <div class="page">
    <div class="ph"><div><h1>Exercises</h1><div class="sub">{{ all.data.value?.length ?? 0 }} in the library</div></div>
      <div class="acts"><button class="btn keep" @click="creating = true"><Icon name="plus" :size="18" />New exercise</button></div></div>
    <div class="row" style="margin-bottom:10px">
      <div class="search grow" style="max-width:480px"><Icon name="search" :size="18" /><input v-model="q" placeholder="Search exercises" @input="shown = 60" /></div>
      <button class="ib" aria-label="Filters" title="Filters" @click="filtersOpen = true"><Icon name="filter" /><span v-if="filterCount" class="badge">{{ filterCount }}</span></button>
    </div>
    <div class="chips hscroll" style="margin-bottom:16px">
      <button class="fchip" :class="{ on: !group }" @click="group = ''">All</button>
      <button v-for="g in GROUPS" :key="g.id" class="fchip" :class="{ on: group === g.id }" @click="group = group === g.id ? '' : g.id">{{ g.name }}</button>
    </div>
    <Sheet v-if="filtersOpen" title="Filters" @close="filtersOpen = false">
      <div class="fld"><label>Show</label><div class="seg block"><button v-for="[k, l] in [['', 'All'], ['fav', 'Favourites'], ['done', 'Done before'], ['mine', 'My own']]" :key="k" :class="{ on: only === k }" @click="only = k as any">{{ l }}</button></div></div>
      <div class="fld"><label>Sort</label><div class="seg block"><button v-for="[k, l] in [['used', 'Most used'], ['recent', 'Recent'], ['name', 'A–Z']]" :key="k" :class="{ on: sort === k }" @click="sort = k as any">{{ l }}</button></div></div>
      <div class="fld"><label>Equipment</label><div class="chips"><button class="fchip" :class="{ on: !equip }" @click="equip = ''">Any</button><button v-for="eq in EQUIPMENT" :key="eq" class="fchip" :class="{ on: equip === eq }" style="text-transform:capitalize" @click="equip = equip === eq ? '' : eq">{{ eq }}</button></div></div>
      <template #foot><button class="btn o" :disabled="!filterCount" @click="clearFilters">Clear</button><button class="btn" @click="filtersOpen = false">Show {{ list.length }}</button></template>
    </Sheet>
    <div class="grid gauto">
      <div v-for="e in list.slice(0, shown)" :key="e.id" class="card click tight row" @click="router.push(`/exercises/${e.id}`)">
        <div class="thumb lg"><img v-if="e.images?.[0]" :src="mediaUrl(e.images[0])" alt="" loading="lazy" /><Icon v-else name="dumbbell" /></div>
        <div class="grow">
          <div style="font-weight:600;line-height:1.3">{{ e.name }} <Icon v-if="e.favourite" name="star" :size="13" style="display:inline;color:var(--acc);vertical-align:-1px" /></div>
          <div class="tiny" style="margin-top:3px">{{ e.primaryMuscles.map(muscleName).join(", ") }}{{ e.equipment ? " · " + e.equipment : "" }}</div>
          <div class="tiny">{{ e.timesDone ? `${e.timesDone}× · ${ago(e.lastDoneAt)}` : e.ownerId ? "Yours" : "" }}</div>
        </div>
      </div>
    </div>
    <div v-if="list.length > shown" class="center" style="margin-top:16px"><button class="btn o" @click="shown += 90">Show more ({{ list.length - shown }})</button></div>
    <div v-if="all.data.value && !list.length" class="card empty"><b>No exercises match</b><button class="btn tonal" @click="creating = true">Create "{{ q || "a new one" }}"</button></div>
    <ExerciseEditor v-if="creating" :name="q" @close="creating = false" @saved="(id) => router.push(`/exercises/${id}`)" />
  </div>
</template>
