<script setup lang="ts">
// The ready-made routines, by group, each with the muscles it works on the left like the routine cards.
// One list for both ways in: the Routines page's "Start from a template" and the new routine's "Use a template".
import { computed } from "vue";
import { useTemplates } from "../api/queries";
import Icon from "./Icon.vue";
import MuscleFig from "./MuscleFig.vue";

const emit = defineEmits<{ pick: [slug: string] }>();
const templates = useTemplates();
const groups = computed(() => { const m = new Map<string, any[]>(); for (const t of templates.data.value ?? []) m.set(t.group, [...(m.get(t.group) ?? []), t]); return [...m]; });
</script>

<template>
  <template v-for="[grp, ts] in groups" :key="grp">
    <div class="sh"><h2>{{ grp }}</h2><span class="tiny">{{ ts.length }} {{ ts.length === 1 ? "routine" : "routines" }}</span></div>
    <div class="opt-list">
      <button v-for="t in ts" :key="t.slug" class="optb wbody" @click="emit('pick', t.slug)">
        <MuscleFig :muscles="t.muscles" :helpers="t.helpers" />
        <div class="grow" style="align-self:center"><div class="t">{{ t.name }}</div><div class="s">{{ t.exercises }} exercises</div><div class="s">{{ t.description }}</div></div>
        <Icon name="plus" style="align-self:center" />
      </button>
    </div>
  </template>
</template>
