<script setup lang="ts">
// When a routine (or an activity) is planned: every day, on certain weekdays, every N days, or once, with an optional time and reminder.
// Opened without a routine (from Home or the calendar), it first asks what to plan.
import { computed, ref } from "vue";
import { useRoutines, useActivityTypes } from "../api/queries";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { toast, toastError } from "../core/toast";
import { localYmd } from "../core/format";
import { askNotificationPermission } from "../workout/native";
import Sheet from "./Sheet.vue";
import AppSelect from "./AppSelect.vue";
import DatePicker from "./DatePicker.vue";
import TimePicker from "./TimePicker.vue";
import ChoiceTiles from "./ChoiceTiles.vue";

const props = defineProps<{ schedule: any }>();
const emit = defineEmits<{ close: [] }>();
const s = props.schedule;
const pick = !s.id && !s.routineId && !s.activityType;
const routines = useRoutines();
const types = useActivityTypes();
const what = ref<string>(s.routineId ? "r:" + s.routineId : s.activityType ? "a:" + s.activityType : "");
const options = computed(() => [
  ...(routines.data.value ?? []).map((r: any) => ({ value: "r:" + r.id, label: r.name, group: "Routines" })),
  ...(types.data.value ?? []).map((t: any) => ({ value: "a:" + t.slug, label: t.name, group: "Activities" })),
]);
const REMIND = [{ value: 0, label: "At the time" }, { value: 15, label: "15 minutes" }, { value: 30, label: "30 minutes" }, { value: 60, label: "1 hour" }, { value: 120, label: "2 hours" }];
// "Every day" is stored as every 1 day, so the engine and its calendar need no rule of their own; a plan that already
// falls on every day (every 1 day, or all seven weekdays) opens with "Every day" chosen.
const daily = (s.rule === "interval" && s.intervalDays === 1) || (s.rule === "weekly" && s.days?.length === 7);
const f = ref({ rule: daily ? "daily" : s.rule ?? "weekly", days: [...(s.days ?? (s.startDate ? [new Date(s.startDate + "T12:00:00").getDay()] : []))] as number[], intervalDays: s.intervalDays > 1 ? s.intervalDays : 2, startDate: s.startDate ?? localYmd(new Date()), endDate: s.endDate ?? "",
  timeOfDay: s.timeOfDay ?? "", remind: s.remindMin != null, remindMin: s.remindMin ?? 30 });
// Sunday is 0, as Date.getDay() counts
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, value) => ({ value, label }));
async function save() {
  try {
    const [k, v] = [what.value.slice(0, 1), what.value.slice(2)];
    const daily = f.value.rule === "daily", remind = f.value.remind && !!f.value.timeOfDay;
    const body = { routineId: k === "r" ? v : null, activityType: k === "a" ? v : null, rule: daily ? "interval" : f.value.rule, days: f.value.days, intervalDays: daily ? 1 : f.value.intervalDays, startDate: f.value.startDate,
      endDate: f.value.endDate || null, timeOfDay: f.value.timeOfDay || null, remindMin: remind ? f.value.remindMin : null };
    if (s.id) await api.put(`/schedules/${s.id}`, body); else await api.post("/schedules", body);
    if (remind) askNotificationPermission();
    invalidate(["schedules", "calendar", "home"]);
    toast("Schedule saved");
    emit("close");
  } catch (e) { toastError(e); }
}
</script>

<template>
  <Sheet :title="pick ? 'Plan a workout' : 'Schedule'" @close="emit('close')">
    <div v-if="pick" class="fld"><label>What</label>
      <AppSelect v-model="what" :options="options" placeholder="Choose a routine or an activity" title="What to plan" /></div>
    <div class="fld"><label>Repeats</label><div class="seg block"><button :class="{ on: f.rule === 'daily' }" @click="f.rule = 'daily'">Every day</button><button :class="{ on: f.rule === 'weekly' }" @click="f.rule = 'weekly'">Weekdays</button><button :class="{ on: f.rule === 'interval' }" @click="f.rule = 'interval'">Every N days</button><button :class="{ on: f.rule === 'once' }" @click="f.rule = 'once'">Once</button></div></div>
    <div v-if="f.rule === 'weekly'" class="fld"><label>On</label><ChoiceTiles v-model="f.days" :options="DAYS" multiple compact :cols="7" label="On" /></div>
    <div v-if="f.rule === 'interval'" class="fld"><label>Every</label><div class="row"><input v-model.number="f.intervalDays" type="number" min="1" max="60" style="width:90px" /><span>days</span></div></div>
    <div class="frow"><div class="fld"><label>{{ f.rule === "once" ? "On" : "Starting" }}</label><DatePicker v-model="f.startDate" /></div><div v-if="f.rule !== 'once'" class="fld"><label>Until (optional)</label><DatePicker v-model="f.endDate" clearable placeholder="No end" /></div></div>
    <div class="fld"><label>Time (optional)</label><TimePicker v-model="f.timeOfDay" clearable placeholder="No time" /></div>
    <!-- a reminder counts back from the time, so it's offered only once there is one -->
    <label v-if="f.timeOfDay" class="tgl"><div class="grow"><div class="t">Remind me</div><div class="s">A notification before it starts</div></div><span class="tg"><input v-model="f.remind" type="checkbox" /></span></label>
    <div v-if="f.timeOfDay && f.remind" class="fld"><label>How long before</label><AppSelect v-model="f.remindMin" :options="REMIND" title="How long before" /></div>
    <template #foot><button class="btn o" @click="emit('close')">Cancel</button><button class="btn" :disabled="!what" @click="save">{{ pick ? "Plan" : "Save" }}</button></template>
  </Sheet>
</template>
