<script setup lang="ts">
// A program's start date: workouts count towards it from that day, in its order. No date: it starts with its first workout.
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
    <p class="tiny hgap">{{ date ? "Workouts count towards the program from this date, in its order. Earlier ones stay in your history." : "The program starts on the day you do its first workout. Earlier workouts stay in your history." }}</p>
    <div class="fld"><label>Starts</label><WhenPicker v-model="date" title="Starts" none="No date" /></div>
    <template #foot><button class="btn o" @click="emit('close')">Cancel</button><button class="btn" @click="save">Save</button></template>
  </Sheet>
</template>
