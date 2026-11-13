<script setup lang="ts">
// "Track by" for one exercise (core/track.ts): the person's own choice, saved for them only. The server keeps no choice
// when it is the exercise's own way, and converts the exercise's sets in every routine and those still to do in a
// workout going on; logged sets stay as they were done.
import { ref } from "vue";
import { trackingLabel, type Tracking } from "@motus/shared";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { savedToast, toastError } from "../core/toast";
import Sheet from "../components/Sheet.vue";
import TrackChoice from "../components/TrackChoice.vue";

const props = defineProps<{ o: { exerciseId: string; tracking: Tracking; then?: (before: Tracking, after: Tracking) => void } }>();
const emit = defineEmits<{ close: [] }>();
const t = ref<Tracking>(props.o.tracking);
async function save() {
  if (t.value === props.o.tracking) { emit("close"); return; }
  try {
    await api.put(`/exercises/${props.o.exerciseId}/prefs`, { tracking: t.value });
    props.o.then?.(props.o.tracking, t.value);
    invalidate(["exercises", "workouts", "routines", "stats", "goals", "home"]);
    savedToast(`Tracked by ${trackingLabel(t.value).toLowerCase()}`);
    emit("close");
  } catch (e) { toastError(e); }
}
</script>

<template>
  <Sheet title="Track by" @close="emit('close')">
    <p class="tiny hgap">For you, for this exercise. Its sets in your routines and those still to do in the workout you're doing change with it; sets you logged stay as they are.</p>
    <TrackChoice v-model="t" />
    <template #foot><button class="btn o" @click="emit('close')">Cancel</button><button class="btn" @click="save">Save</button></template>
  </Sheet>
</template>
