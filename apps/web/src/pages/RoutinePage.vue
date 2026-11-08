<script setup lang="ts">
// One routine: what's in it, its notes and reminders, its schedule, and every time it was done.
import { goBack } from "../core/leave";
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { duration, muscleName, muscleSets, musclesWorked } from "@motus/shared";
import { useRoutine, useRoutines, useNotes, useReminders, useSchedules, useChange, useSettings, loaded } from "../api/queries";
import { api, mediaUrl } from "../api/client";
import { invalidate } from "../api/live";
import { useFmt, ago } from "../core/format";
import { noteSheet, reminderSheet, exerciseSheet } from "../core/ui";
import { confirm, prompt } from "../core/ask";
import { toast, toastError } from "../core/toast";
import { saveFile } from "../core/saveFile";
import Icon from "../components/Icon.vue";
import MuscleFig from "../components/MuscleFig.vue";
import Menu from "../components/Menu.vue";
import NoteItem from "../components/NoteItem.vue";
import ReminderItem from "../components/ReminderItem.vue";
import LineChart from "../components/LineChart.vue";
import BodyMap from "../components/BodyMap.vue";
import ScheduleEditor from "../components/ScheduleEditor.vue";
import Sheet from "../components/Sheet.vue";

const route = useRoute(), router = useRouter();
const id = computed(() => String(route.params.id));
const r = useRoutine(id);
const summaries = useRoutines();
const sum = computed(() => summaries.data.value?.find((x) => x.id === id.value));
const notes = useNotes("routine", id);
const rems = useReminders(computed(() => ({ status: "pending" })));
const schedules = useSchedules();
const fmt = useFmt();
const settings = useSettings();
const history = useQuery({ queryKey: computed(() => ["workouts", "routine", id.value]), queryFn: () => api.get(`/routines/${id.value}/workouts`) });
const versions = useQuery({ queryKey: computed(() => ["routines", "versions", id.value]), queryFn: () => api.get(`/routines/${id.value}/versions`) });
const tab = ref("plan");
const editSchedule = ref<any>(null);
const showVersions = ref(false);
const routine = computed<any>(() => r.data.value);
const myRems = computed(() => (rems.data.value ?? []).filter((m: any) => (m.targetType === "routine" && m.targetId === id.value) || (m.targetType === "exercise" && routine.value?.exercises.some((e: any) => e.exerciseId === m.targetId) && (!m.scopeRoutineId || m.scopeRoutineId === id.value))));
const mySchedules = computed(() => (schedules.data.value ?? []).filter((s: any) => s.routineId === id.value));
const muscles = computed(() => muscleSets((routine.value?.exercises ?? []).map((e: any) => ({ primary: e.exercise?.primaryMuscles ?? [], secondary: e.exercise?.secondaryMuscles ?? [], sets: e.sets.length }))));
const worked = computed(() => musclesWorked((routine.value?.exercises ?? []).map((e: any) => ({ primary: e.exercise?.primaryMuscles ?? [], secondary: e.exercise?.secondaryMuscles ?? [] }))));
const setLine = (e: any) => {
  const w = e.sets.filter((s: any) => s.kind !== "warmup");
  const reps = w.map((s: any) => (s.repsMax ? `${s.reps}-${s.repsMax}` : s.durationS ? fmt.value.clock(s.durationS) : s.reps ?? "-"));
  const same = reps.every((x: any) => x === reps[0]);
  return `${w.length} × ${same ? reps[0] : reps.join(", ")}${w[0]?.weightKg ? " @ " + fmt.value.wu_(w[0].weightKg) : ""}`;
};
const restLine = (e: any) => [e.restS != null ? `${fmt.value.clock(e.restS)} between sets` : "", e.restAfterS != null ? `${fmt.value.clock(e.restAfterS)} after` : ""].filter(Boolean).join(" · ");
// notes and reminders for one exercise of this routine (they show under it during the workout)
const exItems = (e: any) => [
  { label: "Add a note", hint: "Shown with this exercise in your workouts", icon: "note", run: () => (noteSheet.value = { targets: [{ type: "routine_exercise", id: e.id, label: `${e.exercise.name} in ${routine.value.name}` }, { type: "exercise", id: e.exerciseId, label: `${e.exercise.name}, every time` }] }) },
  { label: "Remind me next time", hint: "Pops up when you reach this exercise", icon: "bell", run: () => (reminderSheet.value = { targetType: "exercise", targetId: e.exerciseId, label: e.exercise.name, scopeRoutineId: id.value, routineName: routine.value.name, routineFirst: true }) },
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const schedLine = (s: any) => ((s.rule === "interval" && s.intervalDays === 1) || (s.rule === "weekly" && s.days.length === 7) ? "Every day" : s.rule === "weekly" ? s.days.map((d: number) => DAYS[d]).join(", ") : s.rule === "interval" ? `Every ${s.intervalDays} days` : fmt.value.date(s.startDate)) + (s.timeOfDay ? ` at ${s.timeOfDay}` : "");
const delSched = useChange(async (sid: string) => { await api.del(`/schedules/${sid}`); toast("Schedule removed"); }, ["schedules", "calendar", "home"]);
const delNote = useChange(async (nid: string) => { await api.del(`/notes/${nid}`); toast("Note deleted"); }, ["notes"]);
const remSet = useChange(async (mid: string, status: string) => { await api.put(`/reminders/${mid}`, { status }); toast(status === "done" ? "Reminder done" : "Reminder dismissed"); }, ["reminders", "routines"]);
// a note on one of the routine's exercises says which; notes on the routine itself need no label
const noteWhere = (n: any) => (n.targetType === "routine_exercise" ? routine.value?.exercises.find((e: any) => e.id === n.targetId)?.exercise?.name ?? null : null);
async function restore(v: any) {
  if (!(await confirm("Restore this version?", { text: "The current version is kept in the history too.", ok: "Restore" }))) return;
  await api.post(`/routines/${id.value}/versions/${v.id}/restore`); invalidate(["routines"]); showVersions.value = false; toast("Restored");
}
async function del() {
  if (!(await confirm(`Delete ${routine.value.name}?`, { text: "Its past workouts stay in your history.", ok: "Delete", danger: true }))) return;
  await api.del(`/routines/${id.value}`); invalidate(["routines", "home"]); toast("Routine deleted"); router.push("/routines");
}
const menu = computed(() => [
  { label: "Edit", icon: "edit", run: () => router.push(`/routines/${id.value}/edit`) },
  { label: "Duplicate", icon: "copy", run: async () => { const x = await api.post(`/routines/${id.value}/duplicate`); invalidate(["routines"]); toast("Routine duplicated"); router.push(`/routines/${x.id}`); } },
  { label: "New routine based on this", icon: "layers", run: async () => { const n = await prompt("Name the new routine", { value: routine.value.name + " v2", ok: "Create", text: "A copy you can change; this one stays as it is." }); if (n) { const x = await api.post("/routines", { fromRoutineId: id.value, name: n }); invalidate(["routines"]); toast(`${n} created`); router.push(`/routines/${x.id}/edit`); } } },
  { label: "Add a note", icon: "note", run: () => (noteSheet.value = { targets: [{ type: "routine", id: id.value, label: routine.value.name }] }) },
  { label: "Remind me next time", icon: "bell", run: () => (reminderSheet.value = { targetType: "routine", targetId: id.value, label: routine.value.name }) },
  { label: "Schedule", icon: "calendar", run: () => (editSchedule.value = { routineId: id.value }) },
  { label: "Earlier versions", icon: "history", run: () => (showVersions.value = true) },
  { label: "Send a copy to…", icon: "share", hidden: !settings.value.features.sharing, run: async () => { const u = await prompt("Send a copy to", { placeholder: "Their username on this server" }); if (u) { try { await api.post("/share/routine", { routineId: id.value, username: u }); toast(`Sent to ${u}`); } catch (e) { toastError(e); } } } },
  { label: "Export", icon: "download", run: () => { const b = new Blob([JSON.stringify({ motusRoutine: 1, ...routine.value }, null, 2)], { type: "application/json" }); saveFile(b, `${routine.value.name}.motusroutine`).catch(toastError); } },
  { label: "Delete", icon: "trash", danger: true, sep: true, run: del },
]);
// show the page once its data is in, all at once
await loaded(r, summaries, notes, rems, schedules, history, versions);
</script>

<template>
  <div v-if="routine" class="page">
    <button class="back" @click="goBack(router, '/routines')"><Icon name="left" :size="16" /><span>Routines</span></button>
    <div class="ph">
      <div><h1>{{ routine.name }}</h1><div class="sub">{{ routine.exercises.length }} exercises · ~{{ duration(sum?.estimateS ?? 0, true) }} · {{ sum?.lastDoneAt ? `last done ${ago(sum.lastDoneAt)}` : "not done yet" }}</div></div>
      <div class="acts"><Menu :items="menu" /><button class="btn keep" @click="router.push(`/routines/${id}/start`)"><Icon name="play" :size="16" />Start</button></div>
    </div>
    <p v-if="routine.description" class="muted" style="margin:calc(var(--hg) * -0.5) 0 var(--spg);max-width:680px">{{ routine.description }}</p>
    <div v-if="myRems.length" class="stack spb">
      <ReminderItem v-for="m in myRems" :key="m.id" :reminder="m" :where="m.targetType === 'exercise' ? m.targetName : null" when :actions="[{ label: 'Done', primary: true, run: () => remSet.run(m.id, 'done') }, { label: 'Dismiss', run: () => remSet.run(m.id, 'dismissed') }]" />
    </div>

    <div class="tabs"><button v-for="[k, l] in [['plan', 'Plan'], ['history', `History · ${sum?.timesDone ?? 0}`], ['notes', `Notes · ${notes.data.value?.length ?? 0}`]]" :key="k" :class="{ on: tab === k }" @click="tab = k as string">{{ l }}</button></div>

    <Transition name="sw" mode="out-in">
    <div v-if="tab === 'plan'" class="grid" style="grid-template-columns:minmax(0,1fr) 300px;align-items:start">
      <div class="card">
        <div v-if="!routine.exercises.length" class="empty"><b>No exercises yet</b><button class="btn tonal" @click="router.push(`/routines/${id}/edit`)">Add exercises</button></div>
        <div class="list">
          <div v-for="(e, i) in routine.exercises" :key="e.id" class="li click" @click="exerciseSheet = e.exerciseId">
            <MuscleFig sm :muscles="e.exercise?.primaryMuscles" :helpers="e.exercise?.secondaryMuscles" />
            <span class="tiny" style="width:18px">{{ i + 1 }}</span>
            <div class="thumb"><img v-if="e.exercise?.images?.[0]" :src="mediaUrl(e.exercise.images[0])" alt="" loading="lazy" /><Icon v-else name="dumbbell" /></div>
            <div class="grow"><div class="t">{{ e.exercise?.name }}<span v-if="e.superset" class="mchip" style="margin-inline-start:6px">Superset {{ e.superset }}</span></div><div class="s">{{ setLine(e) }}<template v-if="restLine(e)"> · {{ restLine(e) }}</template></div>
              <div v-if="e.note" class="s" style="font-style:italic">{{ e.note }}</div></div>
            <span @click.stop><Menu :items="exItems(e)" label="Exercise options" /></span>
          </div>
        </div>
      </div>
      <div class="stack">
        <div class="card"><BodyMap :values="muscles" :highlight="worked.primary" :secondary="worked.secondary" :height="190" legend /><div class="chips" style="margin-top:8px;justify-content:center"><span v-for="m in [...worked.primary, ...worked.secondary]" :key="m" class="mchip">{{ muscleName(m) }}</span></div></div>
        <div class="card">
          <div class="row hgap"><b class="grow">Schedule</b><button class="qb acc" style="padding:4px 6px" @click="editSchedule = { routineId: id }"><Icon name="plus" :size="16" /></button></div>
          <div v-if="!mySchedules.length" class="tiny">Not scheduled. Add days to see it in Up next and the calendar, with a reminder.</div>
          <div v-for="s in mySchedules" :key="s.id" class="li" style="min-height:0;padding:calc(var(--lpy) - 2px) 0"><Icon name="calendar" :size="16" class="muted" /><span class="grow">{{ schedLine(s) }}</span>
            <Menu :items="[{ label: 'Edit', icon: 'edit', run: () => (editSchedule = s) }, { label: 'Remove', icon: 'trash', danger: true, run: () => delSched.run(s.id) }]" /></div>
        </div>
      </div>
    </div>

    <div v-else-if="tab === 'history'">
      <div v-if="(history.data.value?.length ?? 0) > 1" class="grid g2 spb">
        <div class="card"><div class="lbl hgap">Duration (min)</div><LineChart :points="history.data.value.map((w: any) => ({ x: new Date(w.startedAt).getTime(), y: Math.round(w.durationS / 60), id: w.id }))" :height="160" @pick="(wid) => router.push(`/workouts/${wid}`)" /></div>
        <div class="card"><div class="lbl hgap">Volume ({{ fmt.wu }})</div><LineChart :points="history.data.value.map((w: any) => ({ x: new Date(w.startedAt).getTime(), y: fmt.fromKg(w.volumeKg), id: w.id }))" :height="160" :fmt="(v) => fmt.num(v, 0)" @pick="(wid) => router.push(`/workouts/${wid}`)" /></div>
      </div>
      <div class="card">
        <div v-if="!history.data.value?.length" class="empty"><b>Not done yet</b>Each time you do this routine, it's listed here.</div>
        <div class="list"><div v-for="w in history.data.value" :key="w.id" class="li click" @click="router.push(`/workouts/${w.id}`)">
          <div class="grow"><div class="t">{{ fmt.date(w.startedAt, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) }}</div><div class="s">{{ fmt.dur(w.durationS, true) }} · {{ fmt.vol(w.volumeKg) }}{{ w.skipped ? ` · ${w.skipped} skipped` : "" }}</div></div><Icon name="right" class="muted" /></div></div>
      </div>
    </div>

    <div v-else class="card">
      <div class="row hgap"><button class="btn tonal s" @click="noteSheet = { targets: [{ type: 'routine', id, label: routine.name }] }"><Icon name="plus" :size="16" />Note</button></div>
      <div v-if="!notes.data.value?.length" class="empty"><b>No notes yet</b>Write how it went, or what to change next time.</div>
      <div v-if="notes.data.value?.length" class="list">
        <NoteItem v-for="n in notes.data.value" :key="n.id" :note="n" flat date :where="noteWhere(n)"
          :menu="[{ label: 'Edit', icon: 'edit', run: () => (noteSheet = { targets: [{ type: n.targetType, id: n.targetId, label: routine.name }], edit: n }) }, { label: 'Delete', icon: 'trash', danger: true, run: () => delNote.run(n.id) }]" />
      </div>
    </div>

    </Transition>
    <ScheduleEditor v-if="editSchedule" :schedule="editSchedule" @close="editSchedule = null" />
    <Sheet v-if="showVersions" title="Earlier versions" @close="showVersions = false">
      <div v-if="!versions.data.value?.length" class="tiny">Each time you save changes, the version before is kept here.</div>
      <div class="list"><div v-for="v in versions.data.value" :key="v.id" class="li"><div class="grow"><div class="t">{{ fmt.date(v.createdAt, { day: "numeric", month: "short", year: "numeric" }) }} {{ fmt.time(v.createdAt) }}</div><div class="s">{{ v.name }} · {{ v.exercises }} exercises</div></div><button class="btn o s" @click="restore(v)">Restore</button></div></div>
    </Sheet>
  </div>
</template>

<style scoped>
@media (max-width: 860px) { .grid[style*="300px"] { grid-template-columns: 1fr !important; } }
</style>
