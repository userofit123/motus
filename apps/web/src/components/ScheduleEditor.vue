<script setup lang="ts">
// When a routine (or an activity) is planned: which day (When), whether and how it repeats (Repeats), an optional end,
// time and reminder, and one line saying what will happen. Nothing is saved until the Plan / Save button.
// Opened without a routine (from Home or the calendar), it first asks what to plan.
import { computed, ref, watch } from "vue";
import { scheduleSummary } from "@motus/shared";
import { useRoutines, useActivityTypes } from "../api/queries";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { toast, toastError } from "../core/toast";
import { localYmd, useFmt } from "../core/format";
import { askNotificationPermission } from "../workout/native";
import Sheet from "./Sheet.vue";
import AppSelect from "./AppSelect.vue";
import DatePicker from "./DatePicker.vue";
import TimePicker from "./TimePicker.vue";
import ChoiceTiles from "./ChoiceTiles.vue";
import WhenPicker from "./WhenPicker.vue";

const props = defineProps<{ schedule: any }>();
const emit = defineEmits<{ close: [] }>();
const s = props.schedule;
const fmt = useFmt();
const pick = !s.id && !s.routineId && !s.activityType;
const routines = useRoutines();
const types = useActivityTypes();
const what = ref<string>(s.routineId ? "r:" + s.routineId : s.activityType ? "a:" + s.activityType : "");
const options = computed(() => [
  ...(routines.data.value ?? []).map((r: any) => ({ value: "r:" + r.id, label: r.name, group: "Routines" })),
  ...(types.data.value ?? []).map((t: any) => ({ value: "a:" + t.slug, label: t.name, group: "Activities" })),
]);
const REMIND = [{ value: 0, label: "At the time" }, { value: 15, label: "15 minutes" }, { value: 30, label: "30 minutes" }, { value: 60, label: "1 hour" }, { value: 120, label: "2 hours" }];
const REPEATS = [{ value: "once", label: "Once" }, { value: "daily", label: "Every day" }, { value: "weekly", label: "Every week" }, { value: "monthly", label: "Every month" }, { value: "interval", label: "Every few days" }];
// Sunday is 0, as Date.getDay() counts
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, value) => ({ value, label }));
const dow = (d: string) => new Date(d + "T12:00:00").getDay();
// "Every day" is stored as every 1 day, so the engine and its calendar need no rule of their own; a plan that already
// falls on every day (every 1 day, or all seven weekdays) opens with "Every day" chosen.
const daily = (s.rule === "interval" && s.intervalDays === 1) || (s.rule === "weekly" && s.days?.length === 7);
const startDate: string = s.startDate ?? localYmd(new Date());
// a new plan starts as a one-off on its day (today unless the calendar gave one); an existing one opens as it is
const f = ref({ rule: daily ? "daily" : (s.rule ?? "once") as string, days: [...(s.days?.length ? s.days : [dow(startDate)])] as number[], intervalDays: s.intervalDays > 1 ? s.intervalDays : 2,
  startDate, endDate: s.endDate ?? "", timeOfDay: s.timeOfDay ?? "", remind: s.remindMin != null, remindMin: s.remindMin ?? 30 });
// "Every week" follows the chosen day: moving the start from a Monday to a Thursday moves a Monday-only plan with it
watch(() => f.value.startDate, (d, old) => { const x = f.value.days; if (x.length === 1 && x[0] === dow(old)) f.value.days = [dow(d)]; });
watch(() => f.value.rule, (r) => { if (r === "weekly" && !f.value.days.length) f.value.days = [dow(f.value.startDate)]; });
const repeats = computed(() => f.value.rule !== "once");
const ready = computed(() => !!what.value && (f.value.rule !== "weekly" || f.value.days.length > 0) && (f.value.rule !== "interval" || f.value.intervalDays >= 1));
const body = computed(() => {
  const d = f.value.rule === "daily";
  return { rule: d ? "interval" : f.value.rule, days: f.value.days, intervalDays: d ? 1 : f.value.intervalDays, startDate: f.value.startDate, endDate: repeats.value ? f.value.endDate || null : null, timeOfDay: f.value.timeOfDay || null };
});
const summary = computed(() => scheduleSummary(body.value as any, fmt.value.day));
async function save() {
  try {
    const [k, v] = [what.value.slice(0, 1), what.value.slice(2)];
    const remind = f.value.remind && !!f.value.timeOfDay;
    const b = { ...body.value, routineId: k === "r" ? v : null, activityType: k === "a" ? v : null, remindMin: remind ? f.value.remindMin : null };
    if (s.id) await api.put(`/schedules/${s.id}`, b); else await api.post("/schedules", b);
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
    <div class="fld"><label>{{ repeats ? "Starting" : "When" }}</label><WhenPicker v-model="f.startDate" :title="repeats ? 'Starting' : 'When'" /></div>
    <div class="fld"><label>Repeats</label><ChoiceTiles v-model="f.rule" :options="REPEATS" compact label="Repeats" /></div>
    <div v-if="f.rule === 'weekly'" class="fld"><label>On</label><ChoiceTiles v-model="f.days" :options="DAYS" multiple compact :cols="7" label="On" /></div>
    <div v-if="f.rule === 'interval'" class="fld"><label>Every</label><div class="row"><input v-model.number="f.intervalDays" type="number" min="1" max="60" style="width:90px" /><span>days</span></div></div>
    <div v-if="repeats" class="fld"><label>Until (optional)</label><DatePicker v-model="f.endDate" :min="f.startDate" clearable placeholder="No end" title="Until" /></div>
    <div class="fld"><label>Time (optional)</label><TimePicker v-model="f.timeOfDay" clearable placeholder="No time" /></div>
    <!-- a reminder counts back from the time, so it's offered only once there is one -->
    <label v-if="f.timeOfDay" class="tgl"><div class="grow"><div class="t">Remind me</div><div class="s">A notification before it starts</div></div><span class="tg"><input v-model="f.remind" type="checkbox" /></span></label>
    <div v-if="f.timeOfDay && f.remind" class="fld"><label>How long before</label><AppSelect v-model="f.remindMin" :options="REMIND" title="How long before" /></div>
    <p class="tiny" aria-live="polite">{{ summary }}</p>
    <template #foot><button class="btn o" @click="emit('close')">Cancel</button><button class="btn" :disabled="!ready" @click="save">{{ pick ? "Plan" : "Save" }}</button></template>
  </Sheet>
</template>
