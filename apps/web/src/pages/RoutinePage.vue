<script setup lang="ts">
// One routine: what's in it, its notes and reminders, its schedule, and every time it was done.
import { goBack } from "../core/leave";
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { restDefaultsOf, progressionOf, progressionDefaultsOf, oneSideOf, usesWeight, usesReps, routineTime, muscleName, muscleSets, musclesWorked, scheduleSummary, sideRounds } from "@motus/shared";
import { useRoutine, useRoutines, useNotes, useReminders, useSchedules, useSettings, loaded } from "../api/queries";
import { api, mediaUrl } from "../api/client";
import { progParts as progPartsOf } from "../core/progression";
import { restSummary } from "../core/plannedRest";
import { isPhone } from "../core/device";
import { useFmt, ago, setSummary } from "../core/format";
import { noteSheet, reminderSheet, exerciseSheet, scheduleSheet } from "../core/ui";
import Icon from "../components/Icon.vue";
import MuscleFig from "../components/MuscleFig.vue";
import Menu from "../components/Menu.vue";
import NoteItem from "../components/NoteItem.vue";
import ReminderItem from "../components/ReminderItem.vue";
import LineChart from "../components/LineChart.vue";
import PlanSets from "../components/PlanSets.vue";
import BodyMap from "../components/BodyMap.vue";
import { useRoutineMenu } from "../core/routineMenu";
import { removeItem } from "../components/home/planActions";
import { useNoteMenu } from "../core/noteMenu";

const route = useRoute(), router = useRouter();
const id = computed(() => String(route.params.id));
const r = useRoutine(id);
const summaries = useRoutines();
const sum = computed(() => summaries.data.value?.find((x) => x.id === id.value));
const notes = useNotes("routine", id);
const rems = useReminders(computed(() => ({ status: "pending" })));
const schedules = useSchedules();
const fmt = useFmt();
const st = useSettings();
const history = useQuery({ queryKey: computed(() => ["workouts", "routine", id.value]), queryFn: () => api.get(`/routines/${id.value}/workouts`) });
const tab = ref("plan");
const routine = computed<any>(() => r.data.value);
const myRems = computed(() => (rems.data.value ?? []).filter((m: any) => (m.targetType === "routine" && m.targetId === id.value) || (m.targetType === "exercise" && routine.value?.exercises.some((e: any) => e.exerciseId === m.targetId) && (!m.scopeRoutineId || m.scopeRoutineId === id.value))));
const mySchedules = computed(() => (schedules.data.value ?? []).filter((s: any) => s.routineId === id.value));
const muscles = computed(() => muscleSets((routine.value?.exercises ?? []).map((e: any) => ({ primary: e.exercise?.primaryMuscles ?? [], secondary: e.exercise?.secondaryMuscles ?? [], sets: e.sets.length }))));
const worked = computed(() => musclesWorked((routine.value?.exercises ?? []).map((e: any) => ({ primary: e.exercise?.primaryMuscles ?? [], secondary: e.exercise?.secondaryMuscles ?? [] }))));
// under each exercise's name: the editor's header line (superset, then setSummary: "3 × 8-12 · 60 kg"), its parts as
// separate items so the row's gap spaces the dots
const subLine = (e: any) => [e.superset ? `Superset ${e.superset}` : "",
  ...setSummary(e.sets, e.exercise?.tracking ?? "weight_reps", fmt.value, !!st.value.features.unilateral).split(" · ")].filter(Boolean);
// a rest row only where its summary has something to say (any rest planned, per set type too)
const restOn = (e: any) => restSummary(e, fmt.value.clock, st.value.workout, hasSideRounds(e)).length > 0;
// the editor's own summary lines, one per section: rest, timer between reps, progression
const progLineOf = (e: any) => {
  const t = e.exercise?.tracking ?? "weight_reps";
  if (e.fixed || !usesWeight(t) || !usesReps(t)) return null;
  const p = progressionOf(e.progression, progressionDefaultsOf(st.value), { incrementKg: e.exercise?.incrementKg, oneSide: oneSideOf(e.sets, e.exercise) });
  return { mode: p.mode, parts: progPartsOf(p, e.progression, fmt.value.wu_, { assisted: t === "assisted" }) };
};
// once per exercise per render, not once per use in the template
const progLines = computed(() => new Map<string, ReturnType<typeof progLineOf>>((routine.value?.exercises ?? []).map((e: any) => [e.id, progLineOf(e)])));
const progLine = (e: any) => progLines.value.get(e.id)?.parts ?? null;
// no Progression row where it is off (checked by the mode, not the wording)
const progMode = (e: any) => progLines.value.get(e.id)?.mode ?? "off";
// the notes that show every time (as in the workout and its preview): the routine's at the top, each exercise's under it
const shown = (type: string, tid: string) => (notes.data.value ?? []).filter((n: any) => n.pinned && n.targetType === type && n.targetId === tid);
// a figure only where there are muscles to show; without one the card keeps its plain column (Routines list rule)
const hasMuscles = (e: any) => !!(e.exercise?.primaryMuscles?.length || e.exercise?.secondaryMuscles?.length);
// a left and right round (either order, see sideRounds in shared): no rest between its two sets
const hasSideRounds = (e: any) => !!st.value.features.unilateral && sideRounds(e.sets).some(Boolean);
// notes and reminders for one exercise of this routine (they show under it during the workout)
const exItems = (e: any) => [
  { label: "Add a note", hint: "Shown with this exercise in your workouts", icon: "note", run: () => (noteSheet.value = { targets: [{ type: "routine_exercise", id: e.id, label: `${e.exercise.name} in ${routine.value.name}` }, { type: "exercise", id: e.exerciseId, label: `${e.exercise.name}, every time` }] }) },
  { label: "Remind me next time", hint: "Pops up when you reach this exercise", icon: "bell", run: () => (reminderSheet.value = { targetType: "exercise", targetId: e.exerciseId, label: e.exercise.name, scopeRoutineId: id.value, routineName: routine.value.name, routineFirst: true }) },
];
// the same wording as the schedule popup's summary, without when it started
const schedLine = (s: any) => { const t = scheduleSummary(s, fmt.value.day, false); return t.charAt(0).toUpperCase() + t.slice(1); };
// removing one of its plans works as everywhere else (planActions): a repeating one asks first, a one-off one has Undo
const schedRemove = (s: any) => removeItem({ scheduleId: s.id, name: routine.value.name, repeats: s.rule !== "once" });
const noteMenu = useNoteMenu();
// a note on one of the routine's exercises says which; notes on the routine itself need no label
const noteWhere = (n: any) => (n.targetType === "routine_exercise" ? routine.value?.exercises.find((e: any) => e.id === n.targetId)?.exercise?.name ?? null : null);
const menuFor = useRoutineMenu();
const menu = computed(() => menuFor({ id: id.value, name: routine.value.name, pinned: !!routine.value.pinned, archived: !!routine.value.archived }, true));
// show the page once its data is in, all at once
await loaded(r, summaries, notes, rems, schedules, history);
</script>

<template>
  <div v-if="routine" class="page">
    <button class="back" @click="goBack(router, '/routines')"><Icon name="left" :size="16" /><span>Routines</span></button>
    <div class="ph">
      <div><h1>{{ routine.name }}</h1><div class="sub">{{ routine.exercises.length }} exercises · {{ routineTime(sum?.estimateS ?? 0, sum?.usual) }} · {{ sum?.lastDoneAt ? `last done ${ago(sum.lastDoneAt)}` : "not done yet" }}</div></div>
      <div class="acts"><Menu :items="menu" /><button class="btn keep" @click="router.push(`/routines/${id}/start`)"><Icon name="play" :size="16" />Start</button></div>
    </div>
    <p v-if="routine.description" class="muted desc">{{ routine.description }}</p>
    <!-- the notes that show every time and its reminders, as a workout's page shows them; not on the Notes tab, which lists the notes -->
    <div v-if="tab !== 'notes' && (shown('routine', id).length || myRems.length)" class="stack spb">
      <NoteItem v-for="n in shown('routine', id)" :key="n.id" :note="n" :menu="noteMenu(n, routine.name)" />
      <ReminderItem v-for="m in myRems" :key="m.id" :reminder="m" :where="m.targetType === 'exercise' ? m.targetName : null" :routine-name="routine.name" when />
    </div>

    <div class="tabs"><button v-for="[k, l] in [['plan', 'Plan'], ['history', `History · ${sum?.timesDone ?? 0}`], ['notes', `Notes · ${notes.data.value?.length ?? 0}`]]" :key="k" :class="{ on: tab === k }" @click="tab = k as string">{{ l }}</button></div>

    <Transition name="sw" mode="out-in">
    <div v-if="tab === 'plan'">
    <!-- above both columns, so the first card stays level with the side column's top -->
    <div class="grid" style="grid-template-columns:minmax(0,1fr) 300px;align-items:start">
      <div class="pexlist">
        <div v-if="!routine.exercises.length" class="card"><div class="empty"><b>No exercises yet</b><button class="btn tonal" @click="router.push(`/routines/${id}/edit`)">Add exercises</button></div></div>
        <!-- each exercise with its planned sets, as in the editor but read-only; the body on the left (Routines list card rule) -->
        <div v-for="e in routine.exercises" :key="e.id" class="card pex" :class="{ wbody: hasMuscles(e), sup: e.superset }">
          <!-- the small figure on phone so it doesn't make the header row 112px tall -->
          <MuscleFig :sm="isPhone" :muscles="e.exercise?.primaryMuscles" :helpers="e.exercise?.secondaryMuscles" />
          <div class="grow pexb">
            <div class="li click pexh" @click="exerciseSheet = e.exerciseId">
              <div class="thumb sm"><img v-if="e.exercise?.images?.[0]" :src="mediaUrl(e.exercise.images[0])" alt="" loading="lazy" /><Icon v-else name="dumbbell" :size="18" /></div>
              <div class="grow" style="min-width:0"><div class="t">{{ e.exercise?.name }}</div>
                <div class="tiny row pexs"><template v-for="(x, i) in subLine(e)" :key="i"><span v-if="i" class="sep">·</span><span>{{ x }}</span></template></div>
                <span v-if="e.fixed" class="exchips"><span class="mchip">Fixed numbers</span></span></div>
              <span @click.stop><Menu :items="exItems(e)" label="Exercise options" /></span>
            </div>
            <PlanSets :ex="e" />
            <!-- the editor's sections in its order (rests, timer between reps, progression, note), read-only: the same headers,
                 the values as plain tiles that open nothing -->
            <div v-if="restOn(e)" class="sect">
              <div class="sect-h"><span class="si"><Icon name="timer" :size="16" /></span><span class="grow"><b>Rest after each set</b><span class="tiny pgl"><template v-for="(x, k) in restSummary(e, fmt.clock, st?.workout, hasSideRounds(e))" :key="k"><span v-if="k" class="sep">&nbsp;· </span><span>{{ x }}</span></template></span></span></div>
            </div>
            <div v-if="e.repRestS" class="sect">
              <div class="sect-h"><span class="si"><Icon name="clock" :size="16" /></span><span class="grow"><b>Timer between reps</b><span class="tiny">Every {{ e.repRestS }}s</span></span></div>
            </div>
            <div v-if="progMode(e) !== 'off'" class="sect">
              <div class="sect-h"><span class="si"><Icon name="arrowUp" :size="16" /></span><span class="grow"><b>Progression</b><span class="tiny pgl"><template v-for="(x, k) in progLine(e)" :key="k"><span v-if="k" class="sep">&nbsp;· </span><span :class="{ dim: x.dim }">{{ x.text }}</span></template></span></span></div>
            </div>
            <!-- its note and the notes that show every time; no menu here: notes are edited on the Notes tab -->
            <div v-if="e.note || shown('routine_exercise', e.id).length" class="sect">
              <div class="sect-h"><span class="si"><Icon name="note" :size="16" /></span><span class="grow"><b>Note</b><span v-if="e.note" class="tiny ntx">{{ e.note }}</span></span></div>
              <div v-if="shown('routine_exercise', e.id).length" class="pnotes"><NoteItem v-for="n in shown('routine_exercise', e.id)" :key="n.id" :note="n" /></div>
            </div>
          </div>
        </div>
      </div>
      <div class="stack">
        <div class="card"><BodyMap :values="muscles" :highlight="worked.primary" :secondary="worked.secondary" :height="190" legend /><div class="chips" style="margin-top:8px;justify-content:center"><span v-for="m in [...worked.primary, ...worked.secondary]" :key="m" class="mchip">{{ muscleName(m) }}</span></div></div>
        <div class="card">
          <div class="row hgap"><b class="grow">Schedule</b><button class="qb acc" style="padding:4px 6px" @click="scheduleSheet = { routineId: id }"><Icon name="plus" :size="16" /></button></div>
          <div v-if="!mySchedules.length" class="tiny">Not scheduled. Add days to see it in Up next and the calendar, with a reminder.</div>
          <div v-for="s in mySchedules" :key="s.id" class="li" style="min-height:0;padding:calc(var(--lpy) - 2px) 0"><Icon name="calendar" :size="16" class="muted" /><span class="grow">{{ schedLine(s) }}</span>
            <Menu :items="[{ label: 'Edit', icon: 'edit', run: () => (scheduleSheet = s) }, schedRemove(s)]" /></div>
        </div>
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
          :menu="noteMenu(n, noteWhere(n) ?? routine.name)" />
      </div>
    </div>

    </Transition>
  </div>
</template>

<style scoped>
@media (max-width: 860px) { .grid[style*="300px"] { grid-template-columns: 1fr !important; } }
.pexlist { display: flex; flex-direction: column; gap: var(--spg); min-width: 0; }
.pex.sup { border-inline-start: 3px solid var(--acc); }
/* the figure sits level with the exercise's name instead of centring in a tall card (only here; the Routines list keeps its own) */
.pex > .rbody { align-self: flex-start; }
.pexb { min-width: 0; display: flex; flex-direction: column; gap: var(--lpy); }
/* a small inset so the tap tint is the same rounded patch on desktop and phone */
.pexh { border-bottom: 0; padding: var(--tdy); margin: calc(-1 * var(--tdy)); min-height: 0; border-radius: var(--r-sm); }
.pexh .t { font-weight: 600; }
.pexs { gap: 6px; flex-wrap: wrap; }
/* the column's gap already sits above a section's line, so its margin is the editor's less that gap: --cpy-1 on both sides of the line at every density */
.pexb > .sect { margin-top: calc(var(--cpy) - 1px - var(--lpy)); }
.pnotes { display: flex; flex-direction: column; gap: var(--lpy); }
.ntx { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; }
</style>

<style>
/* phone: the figure and the exercise's header share the first row; the set grid and notes take the card's full width below,
   so the columns never get squeezed beside the figure (the small one here) */
html.phone .pex.wbody { flex-wrap: wrap; row-gap: var(--lpy); }
html.phone .pex.wbody > .pexb { display: contents; }
html.phone .pex.wbody > .pexb > .pexh { flex: 1 1 0; min-width: 0; align-self: center; }
html.phone .pex.wbody > .pexb > :not(.pexh) { flex: 1 1 100%; min-width: 0; }
</style>
