<script setup lang="ts">
// Panels any screen can open: Start, an exercise, a note, a reminder, an activity, body weight, Appearance.
import { exerciseSheet, noteSheet, reminderSheet, activitySheet, bodySheet, startOpen } from "../core/ui";
import Sheet from "../components/Sheet.vue";
import ExerciseView from "../components/ExerciseView.vue";
import StartSheet from "./StartSheet.vue";
import NoteSheet from "./NoteSheet.vue";
import ReminderSheet from "./ReminderSheet.vue";
import ActivitySheet from "./ActivitySheet.vue";
import BodySheet from "./BodySheet.vue";
import AppearancePanel from "./AppearancePanel.vue";
import { useExercise } from "../api/queries";
import { computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useSettings } from "../api/queries";
import { maybeAutoBackup } from "../core/backup";
import { toast } from "../core/toast";
import { schedulePlanned } from "../native/plannedNotifications";
import CommandPalette from "./CommandPalette.vue";

const ex = useExercise(computed(() => exerciseSheet.value ?? ""));
// N starts a workout from anywhere on a computer
const key = (e: KeyboardEvent) => { if (e.key === "n" && !e.metaKey && !e.ctrlKey && !(e.target as HTMLElement).closest("input,textarea,select,[contenteditable]")) startOpen.value = true; };
onMounted(() => addEventListener("keydown", key));
// an automatic backup when one is due (Settings → Backup)
const settings = useSettings();
let checked = false;
watch(settings, (s) => {
  if (checked || !s) return; checked = true;
  schedulePlanned(s.notifications.scheduled);
  setTimeout(() => maybeAutoBackup(s.backup, false, (run) => toast("A backup is due", { action: { label: "Download", run }, ms: 12000 })), 4000);
});
onBeforeUnmount(() => removeEventListener("keydown", key));
</script>

<template>
  <StartSheet v-if="startOpen" @close="startOpen = false" />
  <Sheet v-if="exerciseSheet" :title="ex.data.value?.name ?? 'Exercise'" size="wide" @close="exerciseSheet = null"><ExerciseView :id="exerciseSheet" in-sheet /></Sheet>
  <NoteSheet v-if="noteSheet" :o="noteSheet" @close="noteSheet = null" />
  <ReminderSheet v-if="reminderSheet" :o="reminderSheet" @close="reminderSheet = null" />
  <ActivitySheet v-if="activitySheet" :o="activitySheet" @close="activitySheet = null" />
  <BodySheet v-if="bodySheet" @close="bodySheet = false" />
  <AppearancePanel />
  <CommandPalette v-if="settings.features.palette" />
</template>
