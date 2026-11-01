<script setup lang="ts">
// When a routine (or an activity) is planned: on certain weekdays, every N days, or once, with an optional reminder.
// Opened without a routine (from Home or the calendar), it first asks what to plan.
import { computed, ref } from "vue";
import { useRoutines, useActivityTypes } from "../api/queries";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { toastError } from "../core/toast";
import { localYmd } from "../core/format";
import { askNotificationPermission } from "../workout/native";
import Sheet from "./Sheet.vue";

const props = defineProps<{ schedule: any }>();
const emit = defineEmits<{ close: [] }>();
const s = props.schedule;
const pick = !s.id && !s.routineId && !s.activityType;
const routines = useRoutines();
const types = useActivityTypes();
const what = ref<string>(s.routineId ? "r:" + s.routineId : s.activityType ? "a:" + s.activityType : "");
const options = computed(() => [
  ...(routines.data.value ?? []).map((r: any) => ({ v: "r:" + r.id, l: r.name })),
  ...(types.data.value ?? []).map((t: any) => ({ v: "a:" + t.slug, l: t.name })),
]);
const f = ref({ rule: s.rule ?? "weekly", days: [...(s.days ?? (s.startDate ? [new Date(s.startDate + "T12:00:00").getDay()] : []))] as number[], intervalDays: s.intervalDays ?? 2, startDate: s.startDate ?? localYmd(new Date()), endDate: s.endDate ?? "",
  timeOfDay: s.timeOfDay ?? "18:00", remind: s.remindMin != null, remindMin: s.remindMin ?? 30 });
const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const toggle = (d: number) => { const i = f.value.days.indexOf(d); if (i >= 0) f.value.days.splice(i, 1); else f.value.days.push(d); };
async function save() {
  try {
    const [k, v] = [what.value.slice(0, 1), what.value.slice(2)];
    const body = { routineId: k === "r" ? v : null, activityType: k === "a" ? v : null, rule: f.value.rule, days: f.value.days, intervalDays: f.value.intervalDays, startDate: f.value.startDate,
      endDate: f.value.endDate || null, timeOfDay: f.value.timeOfDay || null, remindMin: f.value.remind ? f.value.remindMin : null };
    if (s.id) await api.put(`/schedules/${s.id}`, body); else await api.post("/schedules", body);
    if (f.value.remind) askNotificationPermission();
    invalidate(["schedules", "calendar", "home"]);
    emit("close");
  } catch (e) { toastError(e); }
}
</script>

<template>
  <Sheet :title="pick ? 'Plan a workout' : 'Schedule'" @close="emit('close')">
    <div v-if="pick" class="fld"><label>What</label>
      <select v-model="what"><option value="" disabled>Choose a routine or an activity</option>
        <optgroup v-if="routines.data.value?.length" label="Routines"><option v-for="o in options.filter((x) => x.v.startsWith('r:'))" :key="o.v" :value="o.v">{{ o.l }}</option></optgroup>
        <optgroup label="Activities"><option v-for="o in options.filter((x) => x.v.startsWith('a:'))" :key="o.v" :value="o.v">{{ o.l }}</option></optgroup>
      </select></div>
    <div class="fld"><div class="seg block"><button :class="{ on: f.rule === 'weekly' }" @click="f.rule = 'weekly'">Weekdays</button><button :class="{ on: f.rule === 'interval' }" @click="f.rule = 'interval'">Every N days</button><button :class="{ on: f.rule === 'once' }" @click="f.rule = 'once'">Once</button></div></div>
    <div v-if="f.rule === 'weekly'" class="fld"><label>On</label><div class="row" style="gap:6px"><button v-for="(d, i) in DAYS" :key="i" class="fchip" :class="{ on: f.days.includes(i) }" style="width:40px;justify-content:center" @click="toggle(i)">{{ d }}</button></div></div>
    <div v-if="f.rule === 'interval'" class="fld"><label>Every</label><div class="row"><input v-model.number="f.intervalDays" type="number" min="1" max="60" style="width:90px" /><span>days</span></div></div>
    <div class="frow"><div class="fld"><label>{{ f.rule === "once" ? "On" : "Starting" }}</label><input v-model="f.startDate" type="date" /></div><div v-if="f.rule !== 'once'" class="fld"><label>Until (optional)</label><input v-model="f.endDate" type="date" /></div></div>
    <div class="fld"><label>Time (optional)</label><input v-model="f.timeOfDay" type="time" /></div>
    <label class="tgl"><div class="grow"><div class="t">Remind me</div><div class="s">A notification before it starts</div></div><span class="tg"><input v-model="f.remind" type="checkbox" /></span></label>
    <div v-if="f.remind" class="fld" style="margin-top:10px"><label>How long before</label><select v-model.number="f.remindMin"><option :value="0">At the time</option><option :value="15">15 minutes</option><option :value="30">30 minutes</option><option :value="60">1 hour</option><option :value="120">2 hours</option></select></div>
    <template #foot><button class="btn o" @click="emit('close')">Cancel</button><button class="btn" :disabled="!what" @click="save">{{ pick ? "Plan" : "Save" }}</button></template>
  </Sheet>
</template>
