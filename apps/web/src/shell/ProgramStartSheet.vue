<script setup lang="ts">
// A program's start date: workouts count towards it from that day, in its order.
import { ref } from "vue";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { toast, toastError } from "../core/toast";
import Sheet from "../components/Sheet.vue";
import DatePicker from "../components/DatePicker.vue";

const props = defineProps<{ o: { id: string; startDate: string } }>();
const emit = defineEmits<{ close: [] }>();
const date = ref(props.o.startDate);
async function save() {
  try { await api.put(`/programs/${props.o.id}`, { startDate: date.value }); invalidate(["routines", "home"]); toast("Start date changed"); emit("close"); } catch (e) { toastError(e); }
}
</script>

<template>
  <Sheet title="Change start date" @close="emit('close')">
    <p class="tiny hgap">Workouts count towards the program from this date, in its order. Earlier ones stay in your history.</p>
    <div class="fld"><label>Starts</label><DatePicker v-model="date" title="Starts" /></div>
    <template #foot><button class="btn o" @click="emit('close')">Cancel</button><button class="btn" @click="save">Save</button></template>
  </Sheet>
</template>
