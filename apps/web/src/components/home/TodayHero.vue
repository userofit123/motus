<script setup lang="ts">
// Home's first block: what to do today, and this week's training days at a glance. It changes with the day:
// a workout in progress takes it over, then today's plans, then your program's next workout, then a suggestion; with
// none of those it offers a workout of your choice. A new account gets a way to begin instead.
// Several plans for today are a list of equals, each with its own Start and a ⋮ menu to log it instead (a single plan's ⋮
// sits top-right in the header); only the earliest one's button is the filled one, so the screen keeps one primary
// button. Tapping a day in the week shows that day here instead of today.
import { computed, ref } from "vue";
import type { HomePlan, HomeToday } from "@motus/shared";
import { useRouter } from "vue-router";
import { useSettings } from "../../api/queries";
import { useFmt, ago, localYmd, tomorrowYmd, activityIcon } from "../../core/format";
import { startOpen } from "../../core/ui";
import { isPhone } from "../../core/device";
import Icon from "../Icon.vue";
import MuscleFig from "../MuscleFig.vue";
import Menu from "../Menu.vue";
import { startPlan, planMenu } from "./planActions";

const props = defineProps<{ h: HomeToday; fresh: boolean }>();
const router = useRouter();
const s = useSettings();
const fmt = useFmt();
const today = localYmd(new Date());
const tomorrow = tomorrowYmd();
// the day the block shows: today unless you tapped another day in the week
const sel = ref(today);

// a plan starts (a routine) or records (an activity); its ⋮ menu logs it instead (planActions)
const open = (p: HomePlan) => startPlan(router, p);
// the engine sends plans not done yet (each drops out on its own once done), timed ones in time order, then the rest
const plansOn = (d: string) => (props.h.upNext ?? []).filter((p) => p.date === d);
const todays = computed(() => plansOn(today));
const picked = computed(() => plansOn(sel.value));
const kindIcon = (p: HomePlan) => (p.routineId ? "dumbbell" : activityIcon(p.activityType));
const kindName = (p: HomePlan) => (p.routineId ? "Routine" : p.activityType ? p.activityType[0]!.toUpperCase() + p.activityType.slice(1) : "Activity");
const planSub = (p: HomePlan) => [p.timeOfDay ?? "Any time", kindName(p)].join(" · ");
const trainedToday = computed(() => (props.h.days ?? []).includes(today));
const n = (k: number, one: string, many = one + "s") => `${k} ${k === 1 ? one : many}`;

// one big title with one action: a workout in progress, the only plan for today, or what to do with none
interface Hero { label: string; title: string; sub: string; routine: string | null; plan?: HomePlan; act: { label: string; icon: string; run: () => void } }
const hero = computed<Hero | null>(() => {
  const h = props.h;
  if (h.active) return { label: "Workout in progress", title: h.active.name || "Workout", sub: `Started ${ago(h.active.startedAt)}`, routine: null,
    act: { label: "Resume", icon: "play", run: () => router.push("/workout") } };
  // two or more plans: the list below says it all
  if (todays.value.length > 1) return null;
  const plan = todays.value[0];
  if (plan) return { label: plan.timeOfDay ? `Planned for today at ${plan.timeOfDay}` : "Planned for today", title: plan.name, sub: "", routine: plan.routineId ?? null, plan,
    act: { label: "Start", icon: "play", run: () => open(plan) } };
  // a program only while Programs is switched on (Settings → Features)
  const prog = s.value.features.programs ? (h.programs ?? []).find((p) => p.calendarWeek > 0 && p.next) : undefined;
  const next = prog?.next;
  if (prog && next) return { label: `${prog.name}, week ${next.week} of ${prog.weeks}`, title: next.name, sub: "", routine: next.routineId,
    act: { label: "Start", icon: "play", run: () => router.push(`/routines/${next.routineId}/start?program=${prog.id}${next.deload ? `&deload=${prog.deloadPct}` : ""}`) } };
  const sug = trainedToday.value ? null : (h.suggest ?? []).find((x) => x.routineId);
  if (sug) return { label: "Suggested for today", title: sug.title, sub: sug.reason, routine: sug.routineId,
    act: { label: "Start", icon: "play", run: () => router.push(`/routines/${sug.routineId!}/start`) } };
  return { label: "Nothing planned today", title: trainedToday.value ? "Done for today" : "Your call today", sub: "", routine: null,
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
  <div v-else class="card hero today">
    <div class="ch"><span class="bi"><Icon name="play" :size="15" /></span><span class="t grow">{{ sel === today ? "Today" : dayLabel }}</span>
      <button v-if="sel !== today" class="tlnk" @click="openDay">Open in calendar<Icon name="right" :size="14" /></button>
      <span v-else-if="hero?.plan" class="hmenu"><Menu :items="planMenu(router, hero.plan)" :label="`Options for ${hero.plan.name}`" /></span></div>

    <!-- the top row: the title (or what the list below is) beside the figure and the week -->
    <div class="tmain tsec" aria-live="polite">
      <template v-if="sel === today">
        <template v-if="hero">
          <div class="tl"><span v-if="h.active" class="pulse" aria-hidden="true" />{{ hero.label }}</div>
          <div class="thead">
            <div class="tt">{{ hero.title }}</div>
            <button class="btn s" :aria-label="hero.plan || hero.routine || h.active ? `${hero.act.label} ${hero.title}` : undefined" @click="hero.act.run()"><Icon :name="hero.act.icon" :size="14" />{{ hero.act.label }}</button>
          </div>
          <div v-if="hero.sub" class="ts">{{ hero.sub }}</div>
        </template>
        <div v-else class="tl">{{ n(rows.length, "plan") }} for today</div>
      </template>
      <template v-else-if="sel > today">
        <div class="tl">{{ picked.length ? n(picked.length, "plan") : "Nothing planned" }}</div>
        <div v-if="!picked.length" class="ts">Plan a routine or an activity for this day in the calendar.</div>
      </template>
      <div v-else class="ts">{{ pastNote }}</div>
    </div>
    <MuscleFig v-if="sel === today && hero?.routine" class="tfig" :routine="hero.routine" />
    <div class="tweek" role="group" :aria-label="`This week: ${doneCount} of 7 days trained`">
      <button v-for="d in week" :key="d.ymd" type="button" class="wd" :class="{ done: d.done, now: d.today, plan: d.plan, past: d.past, sel: sel === d.ymd && !d.today }"
        :aria-pressed="sel === d.ymd" :aria-label="d.aria" :title="d.done ? 'Trained' : d.plan ? 'Planned' : undefined" @click="sel = sel === d.ymd ? today : d.ymd">
        <span class="wl">{{ d.day }}</span>
        <span class="wn">{{ d.done ? "" : d.n }}<Icon v-if="d.done" name="check" :size="14" /></span>
      </button>
    </div>

    <!-- the day's plans as equal rows across the whole block -->
    <div v-if="sel === today && rows.length" class="tlist tsec" aria-live="polite">
      <div v-if="hero" class="tl">Also planned for today</div>
      <div class="plist" role="list">
        <div v-for="(p, i) in rows" :key="p.scheduleId" role="listitem" class="prow">
          <span class="pk"><Icon :name="kindIcon(p)" :size="isPhone ? 18 : 16" /></span>
          <div class="pt"><div class="pn">{{ p.name }}</div><div class="ps">{{ planSub(p) }}</div></div>
          <span class="pact"><button class="btn s" :class="{ tonal: !primary(i) }" :aria-label="`Start ${p.name}`" @click="open(p)"><Icon name="play" :size="14" />Start</button>
            <Menu :items="planMenu(router, p)" :label="`Options for ${p.name}`" /></span>
        </div>
      </div>
    </div>
    <div v-else-if="sel > today && picked.length" class="tlist plist" role="list" aria-live="polite">
      <div v-for="p in picked" :key="p.scheduleId" role="listitem" class="prow">
        <span class="pk"><Icon :name="kindIcon(p)" :size="isPhone ? 18 : 16" /></span>
        <div class="pt"><div class="pn">{{ p.name }}</div><div class="ps">{{ planSub(p) }}</div></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* the hero: the theme's primary container. The header and the plans span the whole block; between them the title, the
   routine's muscles and the week share a row. No column gap: the figure may be absent, and an empty column's gaps would
   leave a hole, so the figure and the week bring their own space on their left */
.today { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; row-gap: var(--hg); }
.today > * { grid-column: 1 / -1; }
.today > .tmain { grid-column: 1; }
.today > .tfig { grid-column: 2; margin-left: calc(var(--cpx) * 1.5); }
.today > .tweek { grid-column: 3; margin-left: calc(var(--cpx) * 1.5); }
/* lines inside a section sit closer than the sections do */
.tsec { min-width: 0; display: flex; flex-direction: column; gap: var(--tdy); }
/* the block header every Home block has, in the hero's own colours */
.today .ch { margin-bottom: 0; }
.today .ch .bi { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; flex: none; background: color-mix(in srgb, var(--onc) 14%, transparent); color: var(--onc); }
.today .ch .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tlnk { flex: none; display: inline-flex; align-items: center; gap: 2px; padding: 0; border: 0; background: none; font: inherit; font-size: var(--fs-sm); font-weight: 600; color: var(--onc); cursor: pointer; }
.tlnk:hover { text-decoration: underline; }
.tl { font-size: var(--fs-sm); font-weight: 600; display: flex; align-items: center; gap: 8px; color: color-mix(in srgb, var(--onc) 78%, transparent); }
.tt { font-size: calc(var(--fs-lg) * 1.625); font-weight: 650; letter-spacing: -.5px; line-height: 1.15; overflow-wrap: anywhere; }
.ts { font-size: var(--fs-sm); color: color-mix(in srgb, var(--onc) 75%, transparent); }
/* the one action sits on the title's row, small, instead of a large button under it; a plan's ⋮ sits top-right in the
   header, like the ⋮ on a routine card, so the title keeps the room it had beside Start alone */
.thead { display: flex; align-items: center; justify-content: space-between; gap: var(--cpx); }
.thead .btn { flex: none; }
/* the ⋮ is taller than the header's icon; it overlaps the header's padding instead of making the header taller */
.hmenu { margin-block: -5px; }
.tacts { display: flex; flex-wrap: wrap; gap: 8px; }
/* a day's plans: equal rows, each a soft tile with its kind, name, time and its own action. Spaced like the app's other
   tinted rows (the workout's exercise list: --lpy all round, the 12px gap every list row has), so the name keeps its room
   beside Start and ⋮ */
.plist { display: flex; flex-direction: column; gap: var(--tdy); }
.tl + .plist { margin-top: var(--tdy); }
.prow { display: flex; align-items: center; gap: 12px; min-height: var(--lmh); padding: var(--lpy); border-radius: var(--r-md); background: color-mix(in srgb, var(--onc) 8%, transparent); }
.pk { width: 32px; height: 32px; flex: none; border-radius: var(--r-sm); display: grid; place-items: center; background: color-mix(in srgb, var(--onc) 12%, transparent); color: var(--onc); }
.pt { flex: 1; min-width: 0; }
.pn { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ps { font-size: var(--fs-sm); color: color-mix(in srgb, var(--onc) 72%, transparent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* the ⋮ beside Start (and a single plan's in the header): full on-colour like the hero's other controls (above the
   hero's softer .sm text), and the hero's own hover instead of the surface one */
:is(.pact, .hmenu) :deep(.ib.plain) { color: var(--onc); }
:is(.pact, .hmenu) :deep(.ib.plain:hover) { background: color-mix(in srgb, var(--onc) 18%, transparent); }
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
/* narrower screens: text and figure on top, then the plans, the week across the bottom */
@media (max-width: 900px) {
  .today { grid-template-columns: minmax(0, 1fr) auto; }
  .today > .tweek { grid-column: 1 / -1; order: 1; margin-left: 0; justify-content: space-between; }
}
html.phone .today { grid-template-columns: minmax(0, 1fr) auto; }
html.phone .today > .tweek { grid-column: 1 / -1; order: 1; margin-left: 0; justify-content: space-between; }
html.phone .tt { font-size: calc(var(--fs-lg) * 1.375); }
html.phone .wd { width: auto; flex: 1; }
/* a phone's rows show their kind as a plain icon, like the calendar's day list, so the name has room beside Start and ⋮ */
html.phone .pk { width: auto; height: auto; background: none; }
html.phone .wn { width: min(34px, 100%); aspect-ratio: 1; height: auto; }
</style>
