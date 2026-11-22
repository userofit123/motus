<script setup lang="ts">
// One program: where you are and what's next (Start), the plan week by week with what was done, and whether you're on schedule.
import { loaded, useSettings } from "../api/queries";
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQueries, useQuery } from "@tanstack/vue-query";
import { programCheck, plannedWeekdays, weekMuscleSets, musclesWorked, weeksText, goalOf, type ProgramDetail, type Routine, type Schedule } from "@motus/shared";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { useFmt, unitOf, localYmd } from "../core/format";
import { toast, toastError } from "../core/toast";
import Icon from "../components/Icon.vue";
import MuscleFig from "../components/MuscleFig.vue";
import Menu from "../components/Menu.vue";
import ProgramEditor from "../components/ProgramEditor.vue";
import ProgramDaySheet from "../components/ProgramDaySheet.vue";
import ProgramAddSheet from "../components/ProgramAddSheet.vue";
import { scheduleSheet } from "../core/ui";
import type { MenuItem } from "../components/Menu.vue";
import RoutineCheckCard from "../components/RoutineCheckCard.vue";
import { sessionOf } from "../core/routineCheck";
import { useProgramMenu, moveDay } from "../core/programMenu";

const route = useRoute(), router = useRouter();
const id = computed(() => String(route.params.id));
const fmt = useFmt();
// filed under "routines" so finishing a workout or changing a routine refreshes it
const q = useQuery({ queryKey: computed(() => ["routines", "program", id.value]), queryFn: () => api.get<ProgramDetail>(`/programs/${id.value}`, { tz: new Date().getTimezoneOffset() }) });
const p = computed(() => q.data.value);
// the volume as the value with its unit small beside it ("12.4k" kg), as the other tiles' units
const volParts = computed(() => unitOf(fmt.value.vol(p.value?.stats.volumeKg ?? 0)));
const next = computed(() => p.value?.state.next ?? null);
// Back always goes to the Programs list, wherever the program was opened from (Home, a routine, the Start sheet);
// one step back when that list is the page before, so it isn't there twice
const toPrograms = () => (history.state?.back === "/routines?tab=programs" ? router.back() : router.push("/routines?tab=programs"));
const editing = ref(false);
const adding = ref(false);
/** weeks behind the calendar (only while following it) */
const behind = computed(() => (p.value?.status === "active" && next.value ? Math.max(0, p.value.calendarWeek - next.value.week) : 0));
/** a start or end day: "today", "tomorrow", "Mon 23 Nov", with the year when it isn't this year ("Sun 17 Jan 2027") */
const day = (d: string) => fmt.value.day(d);
/** not started yet: no date and no workout done, or a date still to come (the Training time tile and the header agree) */
const waiting = computed(() => !p.value?.startsOn || p.value.calendarWeek === 0);
// the end follows from the weeks (the last day of the last week), so it shows once the start is known. Before the
// start both shapes give the same facts in the same order: its length, when it starts, when it ends (once known).
// the goal (what the program trains for, which the Routine check's targets follow) ends the line, after its timing
const sub = computed(() => `${subTime.value} · For ${goalOf(p.value!.goal).lower}`);
const subTime = computed(() => {
  const x = p.value!;
  if (!x.state.total) return "No routines yet";
  if (x.status === "finished") return `All ${x.weeks.length} weeks done`;
  // paused before it starts: the main button says Resume, so the line says paused too
  if (x.status === "paused" && (!x.startsOn || x.calendarWeek === 0)) return `${weeksText(x.weeks.length)} · paused`;
  if (!x.startsOn) return `${weeksText(x.weeks.length)} · starts with its first workout`;
  if (x.calendarWeek === 0) return `${weeksText(x.weeks.length)} · starts ${day(x.startsOn)} · ends ${day(x.endsOn!)}`;
  return `Week ${next.value!.week} of ${x.weeks.length} · ${x.status === "paused" ? "paused" : `ends ${day(x.endsOn!)}`}`;
});

const put = async (body: Record<string, unknown>, msg: string) => { try { await api.put(`/programs/${id.value}`, body); invalidate(["routines", "home"]); toast(msg); } catch (e) { toastError(e); } };
const start = () => router.push(`/routines/${next.value!.routineId}/start?program=${id.value}${next.value!.deload ? `&deload=${p.value!.deloadPct}` : ""}`);
// the one primary button: what makes sense now
const primary = computed(() => {
  const x = p.value!;
  if (!x.state.total) return { label: "Add routines", icon: "plus", run: () => (adding.value = true) };
  if (x.status === "finished") return { label: "Start again", icon: "refresh", run: () => pm.restart(p.value!) };
  if (x.status === "paused") return { label: "Resume", icon: "play", run: () => put({ active: true }, "Program resumed") };
  return { label: "Start", icon: "play", run: start };
});
const pm = useProgramMenu();
const menu = computed(() => pm.items(p.value!, { edit: () => (editing.value = true), add: p.value!.state.total ? () => (adding.value = true) : undefined, page: true }));
const hasDeload = computed(() => p.value?.plan.some((w) => w.deload));
type Day = ProgramDetail["plan"][number]["days"][number];
// an open day whose routine is planned says when (its routine's planned days go to its open days in order)
const planned = (d: Day) => (d.plannedOn ? `planned ${day(d.plannedOn)}` : "");
const dayLine = (d: Day) => {
  if (d.status === "done") return `${fmt.value.date(d.workout!.startedAt, { weekday: "short", day: "numeric", month: "short" })} · ${fmt.value.dur(d.workout!.durationS, true)} · ${fmt.value.vol(d.workout!.volumeKg)}`;
  if (d.status === "skipped") return "Skipped";
  const parts = d.status === "next" ? ["Up next", planned(d) || (behind.value ? "behind the calendar" : "")] : d.status === "late" ? ["Not done yet", planned(d) || "its week has passed"] : [planned(d)];
  const line = parts.filter(Boolean).join(" · ");
  return line.charAt(0).toUpperCase() + line.slice(1);
};
// a workout moved up or down in its week, saved straight away, as the routine editor's exercises move in their ⋮
// (read fresh, so two quick moves both land instead of the second undoing the first)
async function move(d: Day, by: number) {
  try {
    const fresh = await api.get<ProgramDetail>(`/programs/${id.value}`, { tz: new Date().getTimezoneOffset() });
    const to = d.day - 1 + by, w = fresh.weeks[d.week - 1];
    if (!w || to < 0 || to >= w.days.length) return;
    const weeks = fresh.weeks.map((x, i) => (i === d.week - 1 ? moveDay(x, d.day - 1, to) : x));
    await api.put(`/programs/${id.value}`, { weeks }); invalidate(["routines", "home"]);
  } catch (e) { toastError(e); }
}
// each day's ⋮: which workout counts for it (or skipped), planning its routine, its place in the week, and back to automatic
const dayOpen = ref<Day | null>(null);
const used = computed(() => new Map((p.value?.plan ?? []).flatMap((w) => w.days.flatMap((d) => (d.workout ? [[d.workout.id, w.week] as [string, number]] : [])))));
const dayMenu = (d: Day): MenuItem[] => [
  { label: "Choose the workout", icon: "edit", run: () => (dayOpen.value = d) },
  { label: "Schedule", icon: "calendar", run: () => (scheduleSheet.value = { routineId: d.routineId }) },
  { label: "Move up", icon: "up", sep: true, hidden: d.day === 1, run: () => move(d, -1) },
  { label: "Move down", icon: "down", hidden: d.day === (p.value!.weeks[d.week - 1]?.days.length ?? 0), run: () => move(d, 1) },
  { label: "Count automatically", icon: "refresh", sep: true, hidden: !d.byHand, run: async () => {
    try { await api.put(`/programs/${id.value}/days`, { week: d.week, day: d.day, auto: true }); invalidate(["routines", "home"]); toast(`Week ${d.week} · ${d.name} counts automatically again`); } catch (e) { toastError(e); } } },
];
// the Routine check (feature) of the program's first full week (not a deload one), all its workouts together: sets per
// muscle, twice a week, push and pull balance, quads and hamstrings, a day off after 6 or more sets for a muscle,
// Progression on each exercise, muscles worked while stretched, and, over all its weeks, deload weeks (M-298; each
// routine's page checks its own order, reps, sets and rest, M-287). From its routines as Routines loads them (the same
// cache), and the plans (Schedule) for the day-off check's weekdays; asked for only while the feature is on
const st = useSettings();
const checkOn = computed(() => !!st.value.features.routineCheck);
const checkWeek = computed(() => (checkOn.value ? p.value?.plan.find((w) => !w.deload && w.days.length) ?? null : null));
const weekIds = computed(() => [...new Set((checkWeek.value?.days ?? []).map((d) => d.routineId))]);
const plans = useQuery({ queryKey: ["schedules"], queryFn: () => api.get<Schedule[]>("/schedules"), enabled: checkOn });
const weekRoutines = useQueries({ queries: computed(() => weekIds.value.map((rid) => ({ queryKey: ["routines", rid], queryFn: () => api.get<Routine>(`/routines/${rid}`) }))) });
const check = computed(() => {
  if (!checkWeek.value || weekRoutines.value.some((x) => !x.data)) return null;
  // wait for the plans too, so the day-off row doesn't flip once they come in; a failed or offline fetch doesn't hold it
  if (plans.status.value === "pending" && plans.fetchStatus.value !== "idle") return null;
  // one session per routine, so a routine done twice in the week is the same workout twice
  const byId = new Map(weekIds.value.map((rid, i) => [rid, sessionOf(weekRoutines.value[i]!.data, st.value.workout, st.value.progression.mode)]));
  const days = checkWeek.value.days.map((d) => byId.get(d.routineId)!);
  // each workout's routine name, so a tip can point at "workout 2 (Back)"
  const dayNames = checkWeek.value.days.map((d) => weekRoutines.value[weekIds.value.indexOf(d.routineId)]!.data!.name);
  const c = programCheck(days, p.value!.goal, checkWeek.value.week, dayNames, plannedWeekdays(checkWeek.value.days.map((d) => d.routineId), plans.data.value ?? [], localYmd(new Date())),
    { deload: p.value!.weeks.map((w) => !!w.deload), empty: p.value!.weeks.map((w) => !w.days.length), deloadPct: p.value!.deloadPct });
  const worked = musclesWorked(days.flat().filter((e) => e.category !== "cardio" && e.category !== "stretching"));
  return c ? { c, muscles: { sets: weekMuscleSets(days), primary: worked.primary, secondary: worked.secondary } } : null;
});
// show the page once its data is in, all at once
await loaded(q);
</script>

<template>
  <div v-if="p" class="page">
    <button class="back" @click="toPrograms"><Icon name="left" :size="16" /><span>Programs</span></button>
    <div class="ph">
      <div><h1>{{ p.name }}</h1><div class="sub">{{ sub }}</div></div>
      <div class="acts"><button class="btn keep" @click="primary.run()"><Icon :name="primary.icon" :size="16" />{{ primary.label }}</button><Menu :items="menu" /></div>
    </div>
    <p v-if="p.description" class="muted desc">{{ p.description }}</p>

    <div v-if="p.status !== 'finished' && next" class="card spb nx" :class="{ dl: next.deload }">
      <div class="row"><MuscleFig sm :routine="next.routineId" />
        <div class="grow"><div class="lbl">{{ p.status === "paused" ? "When you resume" : "Next" }} · week {{ next.week }}, workout {{ next.day }}</div><b class="nm">{{ next.name }}</b></div>
        <button class="qb acc" @click="router.push(`/routines/${next.routineId}`)">See routine</button></div>
      <div v-if="next.deload" class="tiny">Deload week: a lighter week to let your body recover. Working weights start {{ p.deloadPct }}% lower; warm-ups and reps stay the same.</div>
      <div v-if="behind" class="tiny wn">You're {{ behind }} week{{ behind > 1 ? "s" : "" }} behind the calendar. Carry on from here, or start again from week 1 in ⋮.</div>
    </div>

    <div class="grid g4 spb st">
      <div class="card stat"><div class="lbl">Workouts done</div><div class="val">{{ p.stats.done }}<small>of {{ p.stats.total }}</small></div><div class="sub">{{ p.stats.weeksDone }} of {{ p.weeks.length }} weeks complete</div></div>
      <!-- planned workouts done vs due, counted up to the end of the last full week (so the week you're in can't count against you) -->
      <div class="card stat"><div class="lbl">On schedule</div>
        <template v-if="p.stats.expected"><div class="val">{{ p.stats.adherencePct }}<small>%</small></div>
          <div class="sub">{{ Math.min(p.stats.done, p.stats.expected) }} of {{ p.stats.expected }} planned up to last week</div></template>
        <template v-else><div class="val na">Not yet</div><div class="sub">Starts counting after week 1</div></template></div>
      <div class="card stat"><div class="lbl">Volume</div><div class="val">{{ volParts.value }}<small>{{ volParts.unit }}</small></div><div class="sub">Weight × reps, all workouts</div></div>
      <!-- before the start, a muted "Not yet" with when it starts counting, as On schedule shows it -->
      <div class="card stat"><div class="lbl">Training time</div>
        <template v-if="!waiting"><div class="val">{{ fmt.dur(p.stats.durationS, true) }}</div><div class="sub">Since {{ day(p.startsOn!) }}</div></template>
        <template v-else><div class="val na">Not yet</div><div class="sub">{{ p.startsOn ? `Counts from ${day(p.startsOn)}` : "Counts from its first workout" }}</div></template></div>
    </div>

    <div class="grid lay">
      <section>
        <div class="sh"><h2>Plan</h2></div>
        <div v-if="!p.state.total" class="card empty"><b>No routines yet</b><button class="btn tonal" @click="adding = true">Add routines</button></div>
        <div v-else class="grid gauto wks">
          <div v-for="w in p.plan" :key="w.week" class="card wk" :class="{ cur: next && w.week === next.week && p.status !== 'finished' }">
            <div class="ch"><span class="t grow">Week {{ w.week }}</span><span v-if="w.deload" class="mchip">Deload -{{ p.deloadPct }}%</span><Icon v-if="w.days.length && w.days.every((d) => d.status === 'done')" name="check" :size="16" class="pos" /></div>
            <div v-if="!w.days.length" class="tiny">Rest week</div>
            <div class="list">
              <div v-for="d in w.days" :key="d.day" class="li" :class="[d.status, { click: !!d.workout }]" @click="d.workout && router.push(`/workouts/${d.workout.id}`)">
                <MuscleFig sm :routine="d.routineId" />
                <span class="mk"><Icon v-if="d.status === 'done'" name="check" :size="14" /><Icon v-else-if="d.status === 'next'" name="play" :size="12" /><Icon v-else-if="d.status === 'skipped'" name="skip" :size="12" /><template v-else>{{ d.day }}</template></span>
                <div class="grow"><div class="t">{{ d.name }}</div><div v-if="dayLine(d)" class="s">{{ dayLine(d) }}</div></div>
                <Menu :items="dayMenu(d)" :label="`Options for week ${w.week} · ${d.name}`" />
              </div>
            </div>
          </div>
        </div>
        <p v-if="hasDeload" class="tiny dnote">Deload weeks are lighter weeks to recover: working weights are {{ p.deloadPct }}% lower.</p>
      </section>
      <!-- its own heading so both columns start level, and so it keeps the section gap when the columns stack on a phone -->
      <section>
        <div class="sh"><h2>Progress</h2></div>
        <div class="stack">
          <div v-if="p.stats.perRoutine.length" class="card">
            <div class="ch"><span class="t">By routine</span></div>
            <div class="prs"><div v-for="r in p.stats.perRoutine" :key="r.routineId"><div class="row"><span class="grow">{{ r.name }}</span><span class="tiny num">{{ r.done }} of {{ r.planned }}</span></div><div class="pbar" :class="{ ok: r.done >= r.planned }"><i :style="{ width: (r.done / r.planned) * 100 + '%' }" /></div></div></div>
          </div>
          <div class="card">
            <div class="ch"><span class="t">Recent workouts</span></div>
            <div v-if="!p.recent.length" class="tiny">{{ p.startsOn ? `None yet. Workouts done from ${day(p.startsOn)} count.` : "None yet. The program starts with its first workout." }}</div>
            <div class="list"><div v-for="w in p.recent" :key="w.id" class="li click" @click="router.push(`/workouts/${w.id}`)">
              <div class="grow"><div class="t">{{ w.name }}</div><div class="s">{{ fmt.date(w.startedAt, { weekday: "short", day: "numeric", month: "short" }) }} · {{ w.week ? `week ${w.week}, workout ${w.day}` : "extra, beyond the plan" }}</div></div><Icon name="right" class="muted" /></div></div>
          </div>
        </div>
      </section>
    </div>
    <!-- below both columns, as on a routine's page: its rows say what to change in full, which the side column is too narrow for -->
    <RoutineCheckCard v-if="check" class="spt" :check="check.c" title="Check of this program" :source="`Scores week ${checkWeek!.week}, ${checkWeek!.days.length === 1 ? 'its 1 workout' : `all ${checkWeek!.days.length} workouts together`}, against the targets for ${goalOf(p.goal).lower}${check.c.checks.some((x) => x.key === 'deload') ? `, and deload weeks over all ${p.weeks.length} weeks` : ''}`" goal-note="This program's goal. Change it with Edit in ⋮." :muscles="check.muscles" />

    <ProgramEditor v-if="editing" :program="p" @close="editing = false" />
    <ProgramAddSheet v-if="adding" :program="p" @close="adding = false" />
    <ProgramDaySheet v-if="dayOpen" :program-id="p.id" :day="dayOpen" :used="used" @close="dayOpen = null" />
  </div>
  <div v-else-if="q.isError.value" class="page"><div class="card empty"><b>Program not found</b><button class="btn tonal" @click="router.push('/routines?tab=programs')">Back to programs</button></div></div>
</template>

<style scoped>
/* the next card's lines (what's next, deload note, behind note) are spaced by one gap, so no line leaves extra space at the bottom */
.nx { display: flex; flex-direction: column; gap: var(--hg); }
.nx .lbl { font-size: 12.5px; color: var(--tx2); }
.nx .nm { font-size: 17px; }
.nx.dl { border: 1px solid color-mix(in srgb, var(--acc) 35%, transparent); }
.wn { color: var(--warn); }
/* the explanation lines sit on the cards' bottom edge so values and explanations line up across the row even when one wraps */
.st .stat .sub { margin-top: auto; padding-top: 2px; }
.st .val.na { color: var(--tx2); }
.lay { grid-template-columns: minmax(0, 1fr) 300px; align-items: start; }
/* the deload note sits close under the weeks it explains, apart from the blocks below */
.dnote { margin: var(--hg) 0 0; }
.wk.cur { box-shadow: inset 0 0 0 2px var(--acc); }
/* a day's row is as tall as its ⋮ (the tap target) or its two lines, not the list's tap height; padding stays the list's own */
.wk .li { min-height: 0; }
.mk { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; flex: none; font-size: 11.5px; background: var(--s2); color: var(--tx2); }
.li.done .mk { background: var(--pos); color: var(--bg); }
.li.next { background: var(--accc); border-radius: var(--r-sm); }
.li.next .mk { background: var(--acc); color: var(--on); }
.li.next .t, .li.next .s { color: var(--onc) !important; }
.li.late .mk { background: color-mix(in srgb, var(--warn) 20%, transparent); color: var(--warn); }
.li.late .s { color: var(--warn) !important; }
.li.todo .t, .li.skipped .t { color: var(--tx2); }
/* wide enough for a day's ⋮ beside its date, length and volume */
.wks { grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); }
/* the ⋮ reaches into the row's end padding but stays inside the row, so the Up next row's background holds it */
.wk .li > :deep(.ib.plain) { margin-inline-end: -4px; }
/* routine bars are spaced like list rows (two row paddings apart), and a gap leaves no extra space under the last one */
.prs { display: flex; flex-direction: column; gap: calc(var(--lpy) * 2); }
.prs .pbar { height: 6px; margin-top: 4px; }
@media (max-width: 860px) { .lay { grid-template-columns: 1fr; } }
</style>
