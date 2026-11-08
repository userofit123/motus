<script setup lang="ts">
// Home's first block: what to do today, and this week's training days at a glance. It changes with the day:
// a workout in progress takes it over, then today's plans, then your program's next workout, then a suggestion; with
// none of those it offers a workout of your choice. A new account gets a way to begin instead.
// Several plans for today are a list of equals, each with its own Start or Log; only the earliest one's button is the
// filled one, so the screen keeps one primary button. Tapping a day in the week shows that day here instead of today.
import { computed, ref } from "vue";
import type { HomePlan, HomeToday } from "@motus/shared";
import { useRouter } from "vue-router";
import { useSettings } from "../../api/queries";
import { useFmt, ago, localYmd } from "../../core/format";
import { startOpen, activitySheet } from "../../core/ui";
import Icon from "../Icon.vue";
import MuscleFig from "../MuscleFig.vue";

const props = defineProps<{ h: HomeToday; fresh: boolean }>();
const router = useRouter();
const s = useSettings();
const fmt = useFmt();
const today = localYmd(new Date());
const tomorrow = localYmd(new Date(Date.now() + 86400000));
// the day the block shows: today unless you tapped another day in the week
const sel = ref(today);

const start = (p: HomePlan) => router.push(`/routines/${p.routineId}/start${p.scheduleId ? `?schedule=${p.scheduleId}&date=${p.date}` : ""}`);
// a routine starts, an activity opens its log
const open = (p: HomePlan) => (p.routineId ? start(p) : (activitySheet.value = { type: p.activityType ?? undefined }));
// the engine sends plans not done yet (each drops out on its own once done), timed ones in time order, then the rest
const plansOn = (d: string) => (props.h.upNext ?? []).filter((p) => p.date === d);
const todays = computed(() => plansOn(today));
const picked = computed(() => plansOn(sel.value));
const ACTS = ["walk", "run", "cycle", "hike", "swim", "yoga"];
const kindIcon = (p: HomePlan) => (p.routineId ? "dumbbell" : ACTS.includes(p.activityType ?? "") ? p.activityType! : "activity");
const kindName = (p: HomePlan) => (p.routineId ? "Routine" : p.activityType ? p.activityType[0]!.toUpperCase() + p.activityType.slice(1) : "Activity");
const planSub = (p: HomePlan) => [p.timeOfDay ?? "Any time", kindName(p)].join(" · ");
const since = computed(() => { const d = props.h.daysSinceLast; return d == null ? "" : d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`; });
const lastLine = computed(() => (props.h.last ? `Last workout: ${props.h.last.name} · ${since.value}` : ""));
const trainedToday = computed(() => (props.h.days ?? []).includes(today));
const n = (k: number, one: string, many = one + "s") => `${k} ${k === 1 ? one : many}`;

// one big title with one action: a workout in progress, the only plan for today, or what to do with none
interface Hero { label: string; title: string; sub: string; routine: string | null; act: { label: string; icon: string; run: () => void } }
const hero = computed<Hero | null>(() => {
  const h = props.h;
  if (h.active) return { label: "Workout in progress", title: h.active.name || "Workout", sub: `Started ${ago(h.active.startedAt)}`, routine: null,
    act: { label: "Resume", icon: "play", run: () => router.push("/workout") } };
  // two or more plans: the list below says it all
  if (todays.value.length > 1) return null;
  const plan = todays.value[0];
  if (plan) return { label: plan.timeOfDay ? `Planned for today at ${plan.timeOfDay}` : "Planned for today", title: plan.name, sub: lastLine.value, routine: plan.routineId ?? null,
    act: plan.routineId ? { label: "Start", icon: "play", run: () => start(plan) } : { label: "Log it", icon: "plus", run: () => open(plan) } };
  // a program only while Programs is switched on (Settings → Features)
  const prog = s.value.features.programs ? (h.programs ?? []).find((p) => p.calendarWeek > 0 && p.next) : undefined;
  const next = prog?.next;
  if (prog && next) return { label: `${prog.name}, week ${next.week} of ${prog.weeks}`, title: next.name, sub: lastLine.value, routine: next.routineId,
    act: { label: "Start", icon: "play", run: () => router.push(`/routines/${next.routineId}/start?program=${prog.id}${next.deload ? `&deload=${prog.deloadPct}` : ""}`) } };
  const sug = trainedToday.value ? null : (h.suggest ?? []).find((x) => x.routineId);
  if (sug) return { label: "Suggested for today", title: sug.title, sub: sug.reason, routine: sug.routineId,
    act: { label: "Start", icon: "play", run: () => router.push(`/routines/${sug.routineId!}/start`) } };
  return { label: "Nothing planned today", title: trainedToday.value ? "Done for today" : "Your call today", sub: lastLine.value, routine: null,
    act: { label: trainedToday.value ? "Another workout" : "Start a workout", icon: "play", run: () => (startOpen.value = true) } };
});
// today's plans as rows: all of them when there are several, or beside a workout in progress (the one plan otherwise is the title)
const rows = computed(() => (props.h.active || todays.value.length > 1 ? todays.value : []));
// the filled button: the earliest plan's, unless a workout in progress holds it (Resume)
const primary = (i: number) => !props.h.active && i === 0;

// another day of the week: its plans (no Start: it isn't that day yet), or whether you trained on a past one
const dayLabel = computed(() => (sel.value === tomorrow ? "Tomorrow" : fmt.value.date(sel.value, { weekday: "long", day: "numeric", month: "long" })));
const pastNote = computed(() => ((props.h.days ?? []).includes(sel.value) ? "You trained on this day." : "No workout or activity on this day."));
const openDay = () => router.push({ path: "/history", query: { date: sel.value } });

// this week, from your first day of the week: trained, planned, today, still to come
const week = computed(() => {
  const now = new Date(), back = (now.getDay() - s.value.firstDay + 7) % 7;
  const planned = new Set((props.h.upNext ?? []).map((p) => p.date));
  const done = new Set(props.h.days ?? []);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back + i), ymd = localYmd(d);
    const st = done.has(ymd) ? "trained" : planned.has(ymd) ? "planned" : "";
    return { ymd, day: fmt.value.date(ymd, { weekday: "narrow" }), n: d.getDate(), done: done.has(ymd), today: ymd === today, plan: planned.has(ymd) && !done.has(ymd), past: ymd < today,
      aria: [ymd === today ? "Today" : fmt.value.date(ymd, { weekday: "long", day: "numeric" }), st].filter(Boolean).join(", ") };
  });
});
const doneCount = computed(() => week.value.filter((d) => d.done).length);
</script>

<template>
  <div v-if="fresh" class="card hero today">
    <div class="tmain">
      <div class="ch"><span class="bi"><Icon name="play" :size="15" /></span><span class="t grow">Today</span></div>
      <div class="tsec">
        <div class="tl">Welcome to Motus</div>
        <div class="tt">Let's get you started</div>
        <div class="ts">Make a routine with the exercises you do, pick a ready-made one, or start a workout and add exercises as you go.</div>
      </div>
      <div class="tacts">
        <button class="btn" @click="router.push('/routines/new/edit')"><Icon name="plus" :size="16" />Create a routine</button>
        <button class="btn tonal" @click="router.push('/routines?template=1')">Use a template</button>
        <button class="btn tonal" @click="startOpen = true"><Icon name="play" :size="16" />Start a workout</button>
      </div>
    </div>
  </div>
  <div v-else class="card hero today" :class="{ live: !!h.active && sel === today }">
    <div class="tmain">
      <div class="ch"><span class="bi"><Icon name="play" :size="15" /></span><span class="t grow">{{ sel === today ? "Today" : dayLabel }}</span>
        <button v-if="sel !== today" class="tlnk" @click="openDay">Open in calendar<Icon name="right" :size="14" /></button></div>

      <template v-if="sel === today">
        <div v-if="hero" class="tsec">
          <div class="tl"><span v-if="h.active" class="pulse" aria-hidden="true" />{{ hero.label }}</div>
          <div class="thead">
            <div class="tt">{{ hero.title }}</div>
            <button class="btn s" @click="hero.act.run()"><Icon :name="hero.act.icon" :size="14" />{{ hero.act.label }}</button>
          </div>
          <div v-if="hero.sub" class="ts">{{ hero.sub }}</div>
        </div>
        <div v-if="rows.length" class="tsec">
          <div class="tl">{{ h.active ? "Also planned for today" : `${n(rows.length, "plan")} for today` }}</div>
          <div class="plist" role="list">
            <div v-for="(p, i) in rows" :key="p.scheduleId" role="listitem" class="prow">
              <span class="pk"><Icon :name="kindIcon(p)" :size="16" /></span>
              <div class="pt"><div class="pn">{{ p.name }}</div><div class="ps">{{ planSub(p) }}</div></div>
              <button class="btn s" :class="{ tonal: !primary(i) }" :aria-label="`${p.routineId ? 'Start' : 'Log'} ${p.name}`" @click="open(p)">
                <Icon :name="p.routineId ? 'play' : 'plus'" :size="14" />{{ p.routineId ? "Start" : "Log" }}</button>
            </div>
          </div>
          <div v-if="!hero && lastLine" class="ts">{{ lastLine }}</div>
        </div>
      </template>

      <div v-else class="tsec">
        <template v-if="sel > today">
          <div class="tl">{{ picked.length ? n(picked.length, "plan") : "Nothing planned" }}</div>
          <div v-if="picked.length" class="plist" role="list">
            <div v-for="p in picked" :key="p.scheduleId" role="listitem" class="prow">
              <span class="pk"><Icon :name="kindIcon(p)" :size="16" /></span>
              <div class="pt"><div class="pn">{{ p.name }}</div><div class="ps">{{ planSub(p) }}</div></div>
            </div>
          </div>
          <div v-else class="ts">Plan a routine or an activity for this day in the calendar.</div>
        </template>
        <div v-else class="ts">{{ pastNote }}</div>
      </div>
    </div>
    <MuscleFig v-if="sel === today && hero?.routine" class="tfig" :routine="hero.routine" />
    <div class="tweek" role="group" :aria-label="`This week: ${doneCount} of 7 days trained`">
      <button v-for="d in week" :key="d.ymd" type="button" class="wd" :class="{ done: d.done, now: d.today, plan: d.plan, past: d.past, sel: sel === d.ymd && !d.today }"
        :aria-pressed="sel === d.ymd" :aria-label="d.aria" :title="d.done ? 'Trained' : d.plan ? 'Planned' : undefined" @click="sel = sel === d.ymd ? today : d.ymd">
        <span class="wl">{{ d.day }}</span>
        <span class="wn">{{ d.done ? "" : d.n }}<Icon v-if="d.done" name="check" :size="14" /></span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* the hero: the theme's primary container. Text on the left, the routine's muscles beside it, the week along the side */
.today { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; column-gap: calc(var(--cpx) * 1.5); row-gap: var(--spg); }
/* sections (the title, the list of plans) get room between them; lines inside a section sit closer */
.tmain { min-width: 0; display: flex; flex-direction: column; gap: var(--hg); }
.tsec { min-width: 0; display: flex; flex-direction: column; gap: var(--tdy); }
.tsec + .tsec { margin-top: calc(var(--hg) / 2); }
/* the block header every Home block has, in the hero's own colours */
.today .ch { margin-bottom: 0; }
.today .ch .bi { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; flex: none; background: color-mix(in srgb, var(--onc) 14%, transparent); color: var(--onc); }
.today .ch .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tlnk { flex: none; display: inline-flex; align-items: center; gap: 2px; padding: 0; border: 0; background: none; font: inherit; font-size: var(--fs-sm); font-weight: 600; color: var(--onc); cursor: pointer; }
.tlnk:hover { text-decoration: underline; }
.tl { font-size: var(--fs-sm); font-weight: 600; display: flex; align-items: center; gap: 8px; color: color-mix(in srgb, var(--onc) 78%, transparent); }
.tt { font-size: calc(var(--fs-lg) * 1.625); font-weight: 650; letter-spacing: -.5px; line-height: 1.15; overflow-wrap: anywhere; }
.ts { font-size: var(--fs-sm); color: color-mix(in srgb, var(--onc) 75%, transparent); }
/* the one action sits on the title's row, small, instead of a large button under it */
.thead { display: flex; align-items: center; justify-content: space-between; gap: var(--cpx); }
.thead .btn { flex: none; }
.tacts { display: flex; flex-wrap: wrap; gap: 8px; }
.tfig { flex: none; }
/* a day's plans: equal rows, each a soft tile with its kind, name, time and its own action */
.plist { display: flex; flex-direction: column; gap: var(--tdy); margin-top: var(--tdy); }
.prow { display: flex; align-items: center; gap: var(--cpx); min-height: var(--lmh); padding: var(--lpy) var(--cpx); border-radius: var(--r-md); background: color-mix(in srgb, var(--onc) 8%, transparent); }
.pk { width: 32px; height: 32px; flex: none; border-radius: var(--r-sm); display: grid; place-items: center; background: color-mix(in srgb, var(--onc) 12%, transparent); color: var(--onc); }
.pt { flex: 1; min-width: 0; }
.pn { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ps { font-size: var(--fs-sm); color: color-mix(in srgb, var(--onc) 72%, transparent); }
.prow .btn { flex: none; }
/* the other plans' buttons: tonal on the hero's own colour, so only the first one is filled */
.prow .btn.tonal { background: color-mix(in srgb, var(--onc) 12%, transparent); color: var(--onc); }
/* a workout in progress: a calm pulse beside its label is the one moving thing on Home */
.pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--pos); animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
/* the week: each day a button that shows it in the block (again, or today, to go back) */
.tweek { display: flex; gap: 6px; align-self: center; }
.wd { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 36px; padding: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; }
.wl { font-size: var(--fs-xs); font-weight: 600; color: color-mix(in srgb, var(--onc) 70%, transparent); }
.wn { width: 34px; height: 34px; border-radius: var(--pill); display: grid; place-items: center; font-size: var(--fs-sm); font-weight: 600; font-variant-numeric: tabular-nums;
  background: color-mix(in srgb, var(--onc) 8%, transparent); position: relative; transition: background .15s, box-shadow .15s; }
.wd:hover .wn { background: color-mix(in srgb, var(--onc) 16%, transparent); }
.wd.past:not(.done) .wn { color: color-mix(in srgb, var(--onc) 55%, transparent); background: none; }
.wd.done .wn { background: var(--acc); color: var(--on); }
.wd.now .wn { box-shadow: 0 0 0 2px var(--onc); }
.wd.plan .wn::after { content: ""; position: absolute; bottom: 4px; width: 4px; height: 4px; border-radius: 50%; background: var(--acc); }
/* the day you picked: filled with the hero's text colour (a trained one keeps its colour and gets a ring) */
.wd.sel .wl { color: var(--onc); }
.wd.sel:not(.done) .wn { background: var(--onc); color: var(--accc); }
.wd.sel.done .wn { box-shadow: 0 0 0 2px var(--accc), 0 0 0 4px var(--onc); }
/* narrower screens: text and figure on top, the week across the bottom */
@media (max-width: 900px) {
  .today { grid-template-columns: minmax(0, 1fr) auto; }
  .tweek { grid-column: 1 / -1; justify-content: space-between; }
}
html.phone .today { grid-template-columns: minmax(0, 1fr) auto; }
html.phone .tweek { grid-column: 1 / -1; justify-content: space-between; }
html.phone .tt { font-size: calc(var(--fs-lg) * 1.375); }
html.phone .wd { width: auto; flex: 1; }
html.phone .wn { width: min(34px, 100%); aspect-ratio: 1; height: auto; }
</style>
