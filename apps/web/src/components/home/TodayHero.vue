<script setup lang="ts">
// Home's first block: what to do today, and this week's training days at a glance. It changes with the day:
// a workout in progress takes it over, then today's plans, then your program's next workout, then a suggestion; with
// none of those it offers a workout of your choice. A new account gets a way to begin instead.
// Several plans for today are a list of equals, each with its own Start and a ⋮ menu to log it instead, skip it or
// remove it (a single plan's ⋮ sits top-right in the header); only the earliest one's button is the filled one, so the
// screen keeps one primary button. What you did today is listed under them (each opens). Tapping a day in the week shows
// that day here instead of today; its plans have only the ⋮ to skip or remove them; a past day lists what you did and the
// plans you missed.
import { computed, ref } from "vue";
import type { HomePlan, HomeToday } from "@motus/shared";
import { useRouter } from "vue-router";
import { useCalendar, useSettings } from "../../api/queries";
import { useFmt, ago, localYmd, tomorrowYmd, activityIcon } from "../../core/format";
import { startOpen } from "../../core/ui";
import Icon from "../Icon.vue";
import MuscleFig from "../MuscleFig.vue";
import SessionStats from "../SessionStats.vue";
import Menu from "../Menu.vue";
import { startPlan, planMenu, unplanItems } from "./planActions";

const props = defineProps<{ h: HomeToday; fresh: boolean }>();
const router = useRouter();
const s = useSettings();
const fmt = useFmt();
const today = localYmd(new Date());
const tomorrow = tomorrowYmd();
// the day the block shows: today unless you tapped another day in the week
const sel = ref(today);

// a plan starts (a routine) or records (an activity); its ⋮ menu logs it instead, skips it or removes it (planActions)
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
interface Hero { label: string; title: string; sub: string; routine: string | null; plan?: HomePlan; done?: boolean; act: { label: string; icon: string; run: () => void } }
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
  const another = { label: "Another workout", icon: "play", run: () => (startOpen.value = true) };
  // trained today with nothing left: one done state. Its label counts what you did (the list under it, which then needs
  // no heading of its own, as "N plans for today" heads the plan list); only when today had plans, all done now, does it
  // add that nothing else is planned. "Nothing planned" never shows beside a workout you did
  if (trainedToday.value) return { label: cal.data.value ? `${n(dayDone.value, "session")} today` : cal.isError.value ? "Trained today" : "\u00a0", title: "Done for today",
    sub: (h.plannedToday ?? 0) ? "Nothing else planned for today" : "", routine: null, done: true, act: another };
  return { label: (h.plannedToday ?? 0) ? "Nothing else planned for today" : "Nothing planned for today", title: "Your call today", sub: "", routine: null,
    act: { ...another, label: "Start a workout" } };
});
// today's plans as rows: all of them when there are several, or beside a workout in progress (the one plan otherwise is the title)
const rows = computed(() => (props.h.active || todays.value.length > 1 ? todays.value : []));
// the filled button: the earliest plan's, unless a workout in progress holds it (Resume)
const primary = (i: number) => !props.h.active && i === 0;

// another day of the week: its plans (no Start or Log it: it isn't that day yet, so the ⋮ only skips or removes), or on
// a past one what you did and what you missed, like the calendar's day list
const dayLabel = computed(() => (sel.value === tomorrow ? "Tomorrow" : fmt.value.date(sel.value, { weekday: "long", day: "numeric", month: "long" })));
// Home's data only says which days you trained, so a day's sessions come from the calendar, for the whole week at once,
// once you've trained today or picked a past day (Home itself doesn't wait for it). Finishing a workout or an activity
// refreshes the calendar too (live.ts), so today's list grows by itself
const wantPast = ref(false);
const wantCal = computed(() => wantPast.value || trainedToday.value);
const weekRange = computed(() => {
  const now = new Date(), back = (now.getDay() - s.value.firstDay + 7) % 7;
  return { from: localYmd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back)), to: localYmd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back + 6)) };
});
const cal = useCalendar(weekRange, wantCal);
interface DayRow { key: string; kind: "workout" | "activity" | "planned"; icon: string; name: string; sub: string; x: any }
// today or a past day: what you did, then (a past day only) the plans you missed. Today leaves out a workout in progress
// (the title is Resume) and its open plans (they're the title or the plan list above)
const dayRows = computed<DayRow[]>(() => {
  const c = cal.data.value as any, d = sel.value;
  if (!c || d > today) return [];
  const on = (iso: string) => localYmd(new Date(iso)) === d;
  const done: DayRow[] = [
    ...c.workouts.filter((w: any) => on(w.startedAt) && (d < today || w.status !== "in_progress")).map((w: any) => ({ key: w.id, kind: "workout" as const, icon: "dumbbell", name: w.name || "Workout", sub: `${fmt.value.time(w.startedAt)} · Workout`, x: { kind: "workout", ...w } })),
    ...c.activities.filter((a: any) => on(a.startedAt)).map((a: any) => {
      const t = a.type ? a.type[0].toUpperCase() + a.type.slice(1) : "Activity";
      return { key: a.id, kind: "activity" as const, icon: activityIcon(a.type), name: a.name || t, sub: `${fmt.value.time(a.startedAt)} · ${t}`, x: { kind: "activity", ...a } };
    }),
  ].sort((a, b) => a.x.startedAt.localeCompare(b.x.startedAt));
  // plans that day not done (the engine leaves out the done ones): missed, as the calendar shows them
  if (d === today) return done;
  const missed: DayRow[] = c.planned.filter((p: any) => p.date === d).map((p: any) => ({ key: p.scheduleId, kind: "planned" as const, icon: kindIcon(p), name: p.name, sub: ["Missed", kindName(p)].join(" · "), x: p }));
  return [...done, ...missed];
});
const dayDone = computed(() => dayRows.value.filter((r) => r.kind !== "planned").length);
const pastMissed = computed(() => dayRows.value.length - dayDone.value);
const pastLabel = computed(() => [dayDone.value ? n(dayDone.value, "session") : "Nothing done", pastMissed.value ? `${pastMissed.value} missed` : ""].filter(Boolean).join(" · "));
const openRow = (r: DayRow) => router.push(r.kind === "activity" ? `/activities/${r.x.id}` : r.x.status === "in_progress" ? "/workout" : `/workouts/${r.x.id}`);
const pick = (d: string) => { sel.value = sel.value === d ? today : d; if (sel.value < today) wantPast.value = true; };
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
      <template v-else-if="cal.data.value">
        <div class="tl">{{ pastLabel }}</div>
        <div v-if="!dayRows.length" class="ts">No workout or activity on this day.</div>
      </template>
      <!-- the calendar is still on its way: hold the line's place so the block doesn't jump -->
      <div v-else-if="cal.isError.value" class="ts">Couldn't load this day.</div>
      <template v-else><div class="tl" aria-hidden="true">&nbsp;</div><div class="ts" aria-hidden="true">&nbsp;</div></template>
    </div>
    <MuscleFig v-if="sel === today && hero?.routine" class="tfig" :routine="hero.routine" />
    <div class="tweek" role="group" :aria-label="`This week: ${doneCount} of 7 days trained`">
      <button v-for="d in week" :key="d.ymd" type="button" class="wd" :class="{ done: d.done, now: d.today, plan: d.plan, past: d.past, sel: sel === d.ymd && !d.today }"
        :aria-pressed="sel === d.ymd" :aria-label="d.aria" :title="d.done ? 'Trained' : d.plan ? 'Planned' : undefined" @click="pick(d.ymd)">
        <span class="wl">{{ d.day }}</span>
        <span class="wn">{{ d.done ? "" : d.n }}<Icon v-if="d.done" name="check" :size="14" /></span>
      </button>
    </div>

    <!-- the day's plans as equal rows across the whole block -->
    <div v-if="sel === today && rows.length" class="tlist tsec" aria-live="polite">
      <div v-if="hero" class="tl">Also planned for today</div>
      <div class="plist" role="list">
        <div v-for="(p, i) in rows" :key="p.scheduleId" role="listitem" class="prow">
          <span class="pk"><Icon :name="kindIcon(p)" :size="18" /></span>
          <div class="pt"><div class="pn">{{ p.name }}</div><div class="ps">{{ planSub(p) }}</div></div>
          <span class="pact"><button class="btn s" :class="{ tonal: !primary(i) }" :aria-label="`Start ${p.name}`" @click="open(p)"><Icon name="play" :size="14" />Start</button>
            <Menu :items="planMenu(router, p)" :label="`Options for ${p.name}`" /></span>
        </div>
      </div>
    </div>
    <div v-else-if="sel > today && picked.length" class="tlist plist" role="list" aria-live="polite">
      <div v-for="p in picked" :key="p.scheduleId" role="listitem" class="prow">
        <span class="pk"><Icon :name="kindIcon(p)" :size="18" /></span>
        <div class="pt"><div class="pn">{{ p.name }}</div><div class="ps">{{ planSub(p) }}</div></div>
        <span class="pact"><Menu :items="unplanItems(p)" :label="`Options for ${p.name}`" /></span>
      </div>
    </div>
    <!-- today or a past day: what you did (each opens), then a past day's missed plans, faded like the calendar's -->
    <!-- today's list holds its place while the calendar is on its way, as a past day's line does -->
    <div v-if="sel <= today && (dayRows.length || (sel === today && trainedToday && !cal.data.value))" class="tlist tsec" aria-live="polite">
      <!-- the heading counts them, unless the done state's label above already does -->
      <div v-if="sel === today && cal.data.value && !hero?.done" class="tl">{{ n(dayDone, "session") }} today</div>
      <div v-else-if="sel === today && cal.isError.value" class="ts">Couldn't load today's sessions.</div>
      <template v-else-if="sel === today && !cal.data.value"><div v-if="!hero?.done" class="tl" aria-hidden="true">&nbsp;</div><div class="plist" aria-hidden="true"><div class="prow ph"><div class="pt"><div class="pn">&nbsp;</div><div class="ps">&nbsp;</div></div></div></div></template>
      <div v-if="dayRows.length" class="plist" role="list">
        <template v-for="r in dayRows" :key="r.key">
          <div v-if="r.kind === 'planned'" role="listitem" class="prow missed">
            <span class="pk"><Icon :name="r.icon" :size="18" /></span>
            <div class="pt"><div class="pn">{{ r.name }}</div><div class="ps">{{ r.sub }}</div></div>
            <span class="pact"><Menu :items="unplanItems(r.x)" :label="`Options for ${r.name}`" /></span>
          </div>
          <div v-else role="listitem" class="prow click" tabindex="0" :aria-label="`Open ${r.name}`" @click="openRow(r)" @keydown.enter.self.prevent="openRow(r)">
            <span class="pk"><Icon :name="r.icon" :size="18" /></span>
            <div class="pt"><div class="pn">{{ r.name }}</div><div class="ps">{{ r.sub }}</div></div>
            <SessionStats :x="r.x" />
            <Icon name="right" class="pgo" />
          </div>
        </template>
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
/* the kind shows as a plain icon, like the calendar's day list, so the name has room beside Start and ⋮ */
.pk { flex: none; display: grid; place-items: center; color: var(--onc); }
.pt { flex: 1; min-width: 0; }
.pn { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ps { font-size: var(--fs-sm); color: color-mix(in srgb, var(--onc) 72%, transparent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* the ⋮ beside Start (on a later day's plans on its own, and a single plan's in the header): full on-colour like the hero's other controls (above the
   hero's softer .sm text), and the hero's own hover instead of the surface one */
:is(.pact, .hmenu) :deep(.ib.plain) { color: var(--onc); }
:is(.pact, .hmenu) :deep(.ib.plain:hover) { background: color-mix(in srgb, var(--onc) 18%, transparent); }
/* the other plans' buttons: tonal on the hero's own colour, so only the first one is filled */
.prow .btn.tonal { background: color-mix(in srgb, var(--onc) 12%, transparent); color: var(--onc); }
/* a past day's sessions open like the calendar's rows: the hero's own hover, its stats column and arrow in its softer text */
.prow.click > .pt { min-width: 42%; }
.prow.click:is(:hover, :active) { background: color-mix(in srgb, var(--onc) 14%, transparent); }
.prow.click:focus-visible { outline: 2px solid var(--onc); outline-offset: 2px; }
.prow :deep(.sstats) { color: color-mix(in srgb, var(--onc) 72%, transparent); text-align: end; }
.pgo { flex: none; color: color-mix(in srgb, var(--onc) 60%, transparent); }
/* the row that holds today's list's place while it loads: as tall as a real one, not seen */
.prow.ph { visibility: hidden; }
/* a plan you missed: faded, as the calendar shows it */
.prow.missed .pn { opacity: .5; }
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
html.phone .wn { width: min(34px, 100%); aspect-ratio: 1; height: auto; }
</style>
