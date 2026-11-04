<script setup lang="ts">
// Choosing exercises: search (names and aliases), filter by muscle and equipment, recently used first; one or many.
import { computed, ref } from "vue";
import { GROUPS, EQUIPMENT } from "@motus/shared";
import { useExercises, useSettings } from "../api/queries";
import { mediaUrl } from "../api/client";
import Sheet from "./Sheet.vue";
import Icon from "./Icon.vue";
import ExerciseEditor from "./ExerciseEditor.vue";
import FilterPanel from "./FilterPanel.vue";
import FilterRow from "./FilterRow.vue";
import { exerciseSheet } from "../core/ui";

const props = defineProps<{ title?: string; multi?: boolean; exclude?: string[]; suggest?: any[] }>();
const emit = defineEmits<{ close: []; pick: [ids: string[]] }>();
const all = useExercises();
const settings = useSettings();
// gym profiles (optional feature): only what the active gym has, unless "All equipment" is chosen
const gym = computed(() => (settings.value.features.gyms ? settings.value.gyms.find((g) => g.id === settings.value.activeGym) : null) ?? null);
const anyEquip = ref(false);
const q = ref(""), group = ref(""), equip = ref(""), picked = ref<string[]>([]), creating = ref(false);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ");
const list = computed(() => {
  const words = norm(q.value).split(" ").filter(Boolean);
  const g = PICK_GROUPS.find((x) => x.id === group.value);
  return (all.data.value ?? []).filter((e) => !e.hidden && !props.exclude?.includes(e.id)
    && (!g || e.primaryMuscles.some((m) => g.muscles.includes(m)))
    && (!equip.value || e.equipment === equip.value)
    && (!gym.value || anyEquip.value || !e.equipment || gym.value.equipment.includes(e.equipment))
    && words.every((w) => norm(e.name + " " + e.aliases.join(" ")).includes(w)))
    .sort((a, b) => Number(b.favourite) - Number(a.favourite) || (b.timesDone ?? 0) - (a.timesDone ?? 0) || (b.lastDoneAt ?? "").localeCompare(a.lastDoneAt ?? "") || a.name.localeCompare(b.name))
    .slice(0, 150);
});
// shorter, friendlier names for the catalog's equipment
const EQ_NAME: Record<string, string> = { "body only": "Bodyweight", "e-z curl bar": "EZ bar", kettlebells: "Kettlebell", "medicine ball": "Medicine ball", "exercise ball": "Exercise ball", "foam roll": "Foam roller" };
const eqName = (e: string) => EQ_NAME[e] ?? e[0]!.toUpperCase() + e.slice(1);
// the muscle groups, with biceps and triceps on their own after Arms: people often pick an exercise for just one
const PICK_GROUPS = GROUPS.flatMap((g) => g.id === "arms" ? [g, { id: "biceps", name: "Biceps", muscles: ["biceps"] }, { id: "triceps", name: "Triceps", muscles: ["triceps"] }] : [g]);
const GROUP_OPTS = PICK_GROUPS.map((g) => ({ value: g.id, label: g.name }));
const EQUIP_OPTS = EQUIPMENT.map((e) => ({ value: e, label: eqName(e) }));
const showSuggest = computed(() => !!props.suggest?.length && !q.value && !filtered.value);
const filtered = computed(() => !!group.value || !!equip.value || (!!gym.value && anyEquip.value));
function clear() { group.value = ""; equip.value = ""; anyEquip.value = false; }
function tap(id: string) {
  if (!props.multi) { emit("pick", [id]); return; }
  const i = picked.value.indexOf(id);
  if (i >= 0) picked.value.splice(i, 1); else picked.value.push(id);
}
</script>

<template>
  <Sheet :title="title ?? 'Add exercises'" size="wide" @close="emit('close')">
    <div class="search hgap"><Icon name="search" :size="18" /><input v-model="q" placeholder="Search exercises" autofocus /></div>
    <FilterPanel :count="showSuggest ? 'Works the same muscles' : `${list.length === 150 ? '150+' : list.length} exercises`" :active="filtered" @clear="clear">
      <FilterRow v-model="group" label="Muscle group" all="All" :options="GROUP_OPTS" />
      <FilterRow v-if="!gym" v-model="equip" label="Equipment" all="Any" :options="EQUIP_OPTS" />
      <!-- with a gym profile the row starts with what that gym has, then "Any" -->
      <FilterRow v-else label="Equipment">
        <button class="fchip" :class="{ on: !anyEquip && !equip }" @click="anyEquip = false; equip = ''">At {{ gym.name }}</button><button class="fchip" :class="{ on: anyEquip && !equip }" @click="anyEquip = true; equip = ''">Any</button>
        <button v-for="o in EQUIP_OPTS" :key="o.value" class="fchip" :class="{ on: equip === o.value }" @click="equip = equip === o.value ? '' : o.value">{{ o.label }}</button>
      </FilterRow>
    </FilterPanel>
    <div class="list">
      <div v-for="e in (showSuggest ? suggest : list)" :key="e.id" class="li click" @click="tap(e.id)">
        <div class="thumb"><img v-if="e.images?.[0]" :src="mediaUrl(e.images[0])" alt="" loading="lazy" /><Icon v-else name="dumbbell" /></div>
        <div class="grow"><div class="t">{{ e.name }}</div><div class="s"><span style="text-transform:capitalize">{{ e.primaryMuscles.join(", ") }}</span>{{ e.equipment ? " · " + eqName(e.equipment) : "" }}{{ e.timesDone ? ` · done ${e.timesDone}×` : "" }}</div></div>
        <button class="ib sm plain" aria-label="About this exercise" @click.stop="exerciseSheet = e.id"><Icon name="info" :size="18" /></button>
        <span v-if="multi" class="tick" :class="{ on: picked.includes(e.id) }"><Icon v-if="picked.includes(e.id)" name="check" :size="18" /></span>
      </div>
      <div v-if="!list.length" class="empty"><b>No match</b><button class="btn tonal" @click="creating = true">Create "{{ q }}"</button></div>
    </div>
    <template #foot>
      <button class="qb" @click="creating = true"><Icon name="plus" :size="16" />New exercise</button>
      <div class="grow" />
      <button v-if="multi" class="btn" :disabled="!picked.length" @click="emit('pick', picked)">Add {{ picked.length || "" }}</button>
    </template>
    <ExerciseEditor v-if="creating" :name="q" @close="creating = false" @saved="(id) => (multi ? picked.push(id) : emit('pick', [id]))" />
  </Sheet>
</template>

