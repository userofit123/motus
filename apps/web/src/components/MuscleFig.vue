<script setup lang="ts">
// The little body on the left of every routine, template, program-day and exercise card (CLAUDE.md rule), drawn like the
// Routines list's routine cards. Give it muscles straight away (an exercise, a template), or routine ids and it reads their
// muscles from the routines list it shares with every other screen (a program day, Up next, a suggestion).
// Main muscles are the main ones of any exercise; helpers only count where nothing works them as a main muscle.
import { computed } from "vue";
import { musclesWorked } from "@motus/shared";
import { useRoutines } from "../api/queries";
import BodyMap from "./BodyMap.vue";

const props = defineProps<{ muscles?: string[]; helpers?: string[]; routine?: string | string[] | null; sm?: boolean }>();
const routines = useRoutines();
const worked = computed(() => {
  const ids = props.routine == null ? [] : Array.isArray(props.routine) ? props.routine : [props.routine];
  const rs = (routines.data.value ?? []).filter((r) => ids.includes(r.id)).map((r) => ({ primary: r.muscles, secondary: r.helpers ?? [] }));
  return musclesWorked([{ primary: props.muscles ?? [], secondary: props.helpers ?? [] }, ...rs]);
});
</script>

<template>
  <BodyMap v-if="worked.primary.length || worked.secondary.length" class="rbody" :class="{ sm }" :values="{}" :highlight="worked.primary" :secondary="worked.secondary" />
</template>
