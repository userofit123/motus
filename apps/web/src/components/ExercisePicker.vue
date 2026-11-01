<script setup lang="ts">
// Choosing exercises: search (names and aliases), filter by muscle and equipment, recently used first; one or many.
import { computed, ref } from "vue";
import { GROUPS, EQUIPMENT } from "@motus/shared";
import { useExercises, useSettings } from "../api/queries";
import { mediaUrl } from "../api/client";
import Sheet from "./Sheet.vue";
import Icon from "./Icon.vue";
import ExerciseEditor from "./ExerciseEditor.vue";
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
  const g = GROUPS.find((x) => x.id === group.value);
  return (all.data.value ?? []).filter((e) => !e.hidden && !props.exclude?.includes(e.id)
    && (!g || e.primaryMuscles.some((m) => g.muscles.includes(m)))
    && (!equip.value || e.equipment === equip.value)
    && (!gym.value || anyEquip.value || !e.equipment || gym.value.equipment.includes(e.equipment))
    && words.every((w) => norm(e.name + " " + e.aliases.join(" ")).includes(w)))
    .sort((a, b) => Number(b.favourite) - Number(a.favourite) || (b.timesDone ?? 0) - (a.timesDone ?? 0) || (b.lastDoneAt ?? "").localeCompare(a.lastDoneAt ?? "") || a.name.localeCompare(b.name))
    .slice(0, 150);
});
function tap(id: string) {
  if (!props.multi) { emit("pick", [id]); return; }
  const i = picked.value.indexOf(id);
  if (i >= 0) picked.value.splice(i, 1); else picked.value.push(id);
}
</script>

<template>
  <Sheet :title="title ?? 'Add exercises'" size="wide" @close="emit('close')">
    <div class="search" style="margin-bottom:10px"><Icon name="search" :size="18" /><input v-model="q" placeholder="Search exercises" autofocus /></div>
    <div class="chips" style="margin-bottom:6px"><button class="fchip" :class="{ on: !group }" @click="group = ''">All</button><button v-for="g in GROUPS" :key="g.id" class="fchip" :class="{ on: group === g.id }" @click="group = group === g.id ? '' : g.id">{{ g.name }}</button></div>
    <div v-if="gym" class="chips" style="margin-bottom:6px"><button class="fchip" :class="{ on: !anyEquip }" @click="anyEquip = false">At {{ gym.name }}</button><button class="fchip" :class="{ on: anyEquip }" @click="anyEquip = true">All equipment</button></div>
    <div class="chips" style="margin-bottom:10px"><button v-for="eq in EQUIPMENT.slice(0, 8)" :key="eq" class="fchip" :class="{ on: equip === eq }" style="text-transform:capitalize" @click="equip = equip === eq ? '' : eq">{{ eq }}</button></div>
    <div v-if="suggest?.length && !q" style="margin-bottom:8px"><div class="tiny" style="margin-bottom:4px">Works the same muscles</div></div>
    <div class="list">
      <div v-for="e in (suggest?.length && !q && !group && !equip ? suggest : list)" :key="e.id" class="li click" @click="tap(e.id)">
        <div class="thumb"><img v-if="e.images?.[0]" :src="mediaUrl(e.images[0])" alt="" loading="lazy" /><Icon v-else name="dumbbell" /></div>
        <div class="grow"><div class="t">{{ e.name }}</div><div class="s" style="text-transform:capitalize">{{ e.primaryMuscles.join(", ") }}{{ e.equipment ? " · " + e.equipment : "" }}{{ e.timesDone ? ` · done ${e.timesDone}×` : "" }}</div></div>
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
