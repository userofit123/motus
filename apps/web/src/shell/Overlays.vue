<script setup lang="ts">
// Panels any screen can open: Start, an exercise, a note, a reminder (new, or one in full), an activity, body weight, Appearance, the schedule editor, a routine's History, a program's start date, what an exercise is tracked by.
import { exerciseSheet, noteSheet, reminderSheet, reminderView, activitySheet, bodySheet, dailySheet, startOpen, scheduleSheet, historySheet, programStartSheet, trackSheet } from "../core/ui";
import ScheduleEditor from "../components/ScheduleEditor.vue";
import RoutineHistory from "./RoutineHistory.vue";
import ProgramStartSheet from "./ProgramStartSheet.vue";
import TrackSheet from "./TrackSheet.vue";
import Sheet from "../components/Sheet.vue";
import ExerciseView from "../components/ExerciseView.vue";
import StartSheet from "./StartSheet.vue";
import NoteSheet from "./NoteSheet.vue";
import ReminderSheet from "./ReminderSheet.vue";
import ReminderView from "./ReminderView.vue";
import ActivitySheet from "./ActivitySheet.vue";
import BodySheet from "./BodySheet.vue";
import DailySheet from "./DailySheet.vue";
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
  <ReminderView v-if="reminderView" :o="reminderView" @close="reminderView = null" />
  <ScheduleEditor v-if="scheduleSheet" :schedule="scheduleSheet" @close="scheduleSheet = null" />
  <RoutineHistory v-if="historySheet" :id="historySheet" @close="historySheet = null" />
  <ProgramStartSheet v-if="programStartSheet" :o="programStartSheet" @close="programStartSheet = null" />
  <TrackSheet v-if="trackSheet" :o="trackSheet" @close="trackSheet = null" />
  <ActivitySheet v-if="activitySheet" :o="activitySheet" @close="activitySheet = null" />
  <BodySheet v-if="bodySheet" @close="bodySheet = false" />
  <DailySheet v-if="dailySheet" @close="dailySheet = false" />
  <AppearancePanel />
  <CommandPalette v-if="settings.features.palette" />
</template>
