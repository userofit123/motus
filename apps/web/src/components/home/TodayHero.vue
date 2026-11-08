<script setup lang="ts">
// Home's first block: the one thing to do today, and this week's training days at a glance. It changes with the day:
// a workout in progress takes it over, then today's plan, then your program's next workout, then a suggestion; with
// none of those it offers a workout of your choice. A new account gets a way to begin instead.
// With several plans for today the first (in time order) leads and the others follow as a short list, so none is hidden.
import { computed } from "vue";
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

const start = (p: HomePlan) => router.push(`/routines/${p.routineId}/start${p.scheduleId ? `?schedule=${p.scheduleId}&date=${p.date}` : ""}`);
// a routine starts, an activity opens its log
const open = (p: HomePlan) => (p.routineId ? start(p) : (activitySheet.value = { type: p.activityType ?? undefined }));
// every plan for today not done yet (the engine drops the done ones, each on its own)
const todays = computed(() => (props.h.upNext ?? []).filter((p) => p.date === today));
// the rest of today's plans, under the one that leads (none while a workout is in progress: it has the block)
const also = computed(() => (props.h.active ? [] : todays.value.slice(1)));
const since = computed(() => { const d = props.h.daysSinceLast; return d == null ? "" : d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`; });
const lastLine = computed(() => (props.h.last ? `Last workout: ${props.h.last.name} · ${since.value}` : ""));
const trainedToday = computed(() => (props.h.days ?? []).includes(today));

interface Hero { label: string; title: string; sub: string; routine: string | null; act: { label: string; icon: string; run: () => void } }
const hero = computed<Hero>(() => {
  const h = props.h;
  if (h.active) return { label: "Workout in progress", title: h.active.name || "Workout", sub: `Started ${ago(h.active.startedAt)}`, routine: null,
    act: { label: "Resume", icon: "play", run: () => router.push("/workout") } };
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

// this week, from your first day of the week: trained, planned, today, still to come
const week = computed(() => {
  const now = new Date(), back = (now.getDay() - s.value.firstDay + 7) % 7;
  const planned = new Set((props.h.upNext ?? []).map((p) => p.date));
  const done = new Set(props.h.days ?? []);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back + i), ymd = localYmd(d);
    return { ymd, day: fmt.value.date(ymd, { weekday: "narrow" }), n: d.getDate(), done: done.has(ymd), today: ymd === today, plan: planned.has(ymd) && !done.has(ymd), past: ymd < today };
  });
});
const doneCount = computed(() => week.value.filter((d) => d.done).length);
</script>

<template>
  <div v-if="fresh" class="card hero today">
    <div class="tmain">
      <div class="ch"><span class="bi"><Icon name="play" :size="15" /></span><span class="t grow">Today</span></div>
      <div class="tl">Welcome to Motus</div>
      <div class="tt">Let's get you started</div>
      <div class="ts">Make a routine with the exercises you do, pick a ready-made one, or start a workout and add exercises as you go.</div>
      <div class="tacts">
        <button class="btn" @click="router.push('/routines/new/edit')"><Icon name="plus" :size="16" />Create a routine</button>
        <button class="btn tonal" @click="router.push('/routines?template=1')">Use a template</button>
        <button class="btn tonal" @click="startOpen = true"><Icon name="play" :size="16" />Start a workout</button>
      </div>
    </div>
  </div>
  <div v-else class="card hero today" :class="{ live: !!h.active }">
    <div class="tmain">
      <div class="ch"><span class="bi"><Icon name="play" :size="15" /></span><span class="t grow">Today</span></div>
      <div class="tl"><span v-if="h.active" class="pulse" aria-hidden="true" />{{ hero.label }}</div>
      <div class="thead">
        <div class="tt">{{ hero.title }}</div>
        <button class="btn s" @click="hero.act.run()"><Icon :name="hero.act.icon" :size="14" />{{ hero.act.label }}</button>
      </div>
      <div v-if="hero.sub" class="ts">{{ hero.sub }}</div>
      <div v-if="also.length" class="also" role="list" aria-label="Also planned for today">
        <span class="al">Also today</span>
        <button v-for="p in also" :key="p.scheduleId" role="listitem" class="ai" :aria-label="`${p.routineId ? 'Start' : 'Log'} ${p.name}`" @click="open(p)">
          <Icon :name="p.routineId ? 'play' : 'plus'" :size="12" /><span class="an">{{ p.name }}</span><template v-if="p.timeOfDay"><span class="sep">·</span><span>{{ p.timeOfDay }}</span></template>
        </button>
      </div>
    </div>
    <MuscleFig v-if="hero.routine" class="tfig" :routine="hero.routine" />
    <div class="tweek" role="list" :aria-label="`This week: ${doneCount} of 7 days trained`">
      <div v-for="d in week" :key="d.ymd" role="listitem" class="wd" :class="{ done: d.done, now: d.today, plan: d.plan, past: d.past }"
        :title="d.done ? 'Trained' : d.plan ? 'Planned' : undefined">
        <span class="wl">{{ d.day }}</span>
        <span class="wn">{{ d.done ? "" : d.n }}<Icon v-if="d.done" name="check" :size="14" /></span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* the hero: the theme's primary container. Text on the left, the routine's muscles beside it, the week along the side */
.today { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; column-gap: calc(var(--cpx) * 1.5); row-gap: var(--hg); }
.tmain { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
/* the block header every Home block has, in the hero's own colours */
.today .ch { margin-bottom: 0; }
.today .ch .bi { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; flex: none; background: color-mix(in srgb, var(--onc) 14%, transparent); color: var(--onc); }
.tl { font-size: var(--fs-sm); font-weight: 600; display: flex; align-items: center; gap: 8px; color: color-mix(in srgb, var(--onc) 78%, transparent); }
.tt { font-size: calc(var(--fs-lg) * 1.625); font-weight: 650; letter-spacing: -.5px; line-height: 1.15; overflow-wrap: anywhere; }
.ts { font-size: var(--fs-sm); color: color-mix(in srgb, var(--onc) 75%, transparent); }
/* the one action sits on the title's row, small, instead of a large button under it */
.thead { display: flex; align-items: center; justify-content: space-between; gap: var(--cpx); }
.thead .btn { flex: none; }
.tacts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: var(--hg); }
.tfig { flex: none; }
/* the rest of today's plans: quiet chips under the lead, each starts or logs its own (the lead keeps the one button) */
.also { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: calc(var(--hg) / 2); }
.al { font-size: var(--fs-xs); font-weight: 600; color: color-mix(in srgb, var(--onc) 70%, transparent); }
.ai { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-width: 0; padding: 4px 10px; border: 0; border-radius: var(--pill); font: inherit; font-size: var(--fs-sm);
  color: var(--onc); background: color-mix(in srgb, var(--onc) 10%, transparent); cursor: pointer; }
.ai:hover { background: color-mix(in srgb, var(--onc) 16%, transparent); }
.ai .an { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* the hero's own text colour, not the page's muted one */
.ai .sep { color: inherit; opacity: .7; }
/* a workout in progress: a calm pulse beside its label is the one moving thing on Home */
.pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--pos); animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
.tweek { display: flex; gap: 6px; }
.wd { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 36px; }
.wl { font-size: var(--fs-xs); font-weight: 600; color: color-mix(in srgb, var(--onc) 70%, transparent); }
.wn { width: 34px; height: 34px; border-radius: var(--pill); display: grid; place-items: center; font-size: var(--fs-sm); font-weight: 600; font-variant-numeric: tabular-nums;
  background: color-mix(in srgb, var(--onc) 8%, transparent); position: relative; }
.wd.past:not(.done) .wn { color: color-mix(in srgb, var(--onc) 55%, transparent); background: none; }
.wd.done .wn { background: var(--acc); color: var(--on); }
.wd.now .wn { box-shadow: 0 0 0 2px var(--onc); }
.wd.plan .wn::after { content: ""; position: absolute; bottom: 4px; width: 4px; height: 4px; border-radius: 50%; background: var(--acc); }
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
