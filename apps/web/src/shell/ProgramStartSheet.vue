<script setup lang="ts">
// A program's start date: workouts count towards it from that day, in its order. No date: it starts with its next first workout.
import { ref } from "vue";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { toast, toastError } from "../core/toast";
import Sheet from "../components/Sheet.vue";
import WhenPicker from "../components/WhenPicker.vue";

const props = defineProps<{ o: { id: string; startDate: string | null } }>();
const emit = defineEmits<{ close: [] }>();
const date = ref(props.o.startDate ?? "");
async function save() {
  try { await api.put(`/programs/${props.o.id}`, { startDate: date.value || null }); invalidate(["routines", "home"]); toast(date.value ? "Start date changed" : "Start date removed"); emit("close"); } catch (e) { toastError(e); }
}
</script>

<template>
  <Sheet title="Change start date" @close="emit('close')">
    <!-- taking a date away makes it wait for its next first workout (the server's counts_from); with no date before, nothing changes -->
    <p class="tiny hgap">{{ date ? "Workouts count towards the program from this date, in its order. Workouts done before stay in your history but no longer count towards this program."
      : o.startDate ? "The program starts the next time you do its first workout. Workouts done before stay in your history but no longer count towards this program."
      : "The program starts with its first workout." }}</p>
    <div class="fld"><label>Starts</label><WhenPicker v-model="date" title="Starts" none="No date" /></div>
    <template #foot><button class="btn o" @click="emit('close')">Cancel</button><button class="btn" @click="save">Save</button></template>
  </Sheet>
</template>
