<script setup lang="ts">
// One Home suggestion, the same row in the Suggested block and in its "All" sheet: the figure, what to do and why.
// A routine opens its page and its calendar button plans it; a muscle (or a gap in your routines) opens the exercises for
// it and its + starts a new routine. The cross dismisses it, and with it that routine and those muscles, for a week.
import { muscleName, type HomeSuggestion } from "@motus/shared";
import { useRouter } from "vue-router";
import Icon from "../Icon.vue";
import MuscleFig from "../MuscleFig.vue";

const props = defineProps<{ x: HomeSuggestion }>();
const emit = defineEmits<{ plan: [routineId: string]; hide: [x: HomeSuggestion]; go: [] }>();
const router = useRouter();
const open = () => {
  emit("go");
  router.push(props.x.routineId ? `/routines/${props.x.routineId}` : `/exercises?muscle=${encodeURIComponent(props.x.muscle ?? "")}`);
};
const newRoutine = () => { emit("go"); router.push("/routines/new/edit"); };
</script>

<template>
  <div class="li click">
    <button class="cover" :aria-label="x.routineId ? `Open ${x.title}` : `Exercises for ${muscleName(x.muscle ?? '').toLowerCase()}`" @click="open" />
    <MuscleFig sm :routine="x.routineId ?? undefined" :muscles="x.routineId ? undefined : x.muscles ?? (x.muscle ? [x.muscle] : undefined)" />
    <div class="grow"><div class="t">{{ x.title }}</div><div class="s">{{ x.reason }}</div></div>
    <button v-if="x.routineId" class="ib sm over" aria-label="Plan" title="Plan" @click="emit('plan', x.routineId)"><Icon name="calendar" :size="18" /></button>
    <button v-else-if="x.muscle" class="ib sm over" aria-label="New routine" title="New routine" @click="newRoutine"><Icon name="plus" :size="18" /></button>
    <button class="ib sm plain over" aria-label="Not now" title="Not now: hide for a week" @click="emit('hide', x)"><Icon name="close" :size="16" /></button>
  </div>
</template>
