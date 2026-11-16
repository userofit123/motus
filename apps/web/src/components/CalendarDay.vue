<script lang="ts">
import type { HealthDay } from "../api/queries";
import { localYmd } from "../core/format";
/** The Calendar's entries by day ("YYYY-MM-DD"): workouts, activities and plans (the engine leaves out plans already done,
 *  by their routine, activity type, or started from the plan); a plan before today is marked missed. The Calendar page
 *  and Home's calendar day both read them from here, so the two always list a day alike */
export function calendarDays(c: { workouts: any[]; activities: any[]; planned: any[] } | undefined, today: string) {
  const m = new Map<string, any[]>();
  const add = (d: string, x: any) => m.set(d, [...(m.get(d) ?? []), x]);
  if (!c) return m;
  for (const w of c.workouts) add(localYmd(new Date(w.startedAt)), { kind: "workout", ...w });
  for (const a of c.activities) add(localYmd(new Date(a.startedAt)), { kind: "activity", ...a });
  for (const p of c.planned) add(p.date, { kind: "planned", missed: p.date < today, ...p });
  // the engine sends workouts and activities as separate lists, so a day would show all its workouts before its activities;
  // order each day like Home's list for a day (oldest first, in order of when they happened), plans (no time of their own) after what was done
  for (const xs of m.values()) xs.sort((a, b) => (a.kind === "planned" ? 1 : 0) - (b.kind === "planned" ? 1 : 0) || (a.startedAt && b.startedAt ? a.startedAt.localeCompare(b.startedAt) : 0));
  return m;
}
/** Whether the band's numbers give the day's card any tiles (the same checks as its tiles below) */
export const hasDayTiles = (d: HealthDay | null | undefined) => !!d && !!(d.sleep || d.sleepH || d.restingHr != null || d.steps || d.distanceM);
</script>

<script setup lang="ts">
// One day's card as the Calendar shows it under the month (M-253), also Home's "Today's calendar" block (M-261): the
// band's numbers for the day as a report's tiles, then its hours and its sessions, each under a faint line and named as
// Stats' day cards name theirs. The heading above it is the page's own (the Calendar's date and its Plan, Home's block
// header through the head slot, inside the card)
import { computed, toRef } from "vue";
import { useRouter } from "vue-router";
import { useHealthAvailable, useHealthDay, useTypeName } from "../api/queries";
import { asleepMin, mins } from "../core/sleep";
import { useFmt, activityIcon, hrPart } from "../core/format";
import { activitySheet } from "../core/ui";
import { unplanItems } from "./home/planActions";
import Icon from "./Icon.vue";
import Menu from "./Menu.vue";
import DotLine from "./DotLine.vue";
import SessionStats from "./SessionStats.vue";
import DayByHour from "./stats/DayByHour.vue";
import { WORKOUT_COLOR, ACTIVITY_COLOR, useDaySessions } from "./stats/daySessions";
import { useDayTimeline } from "./stats/dayTimeline";

const props = defineProps<{ day: string; today: string; items: any[] }>();
const router = useRouter();
const fmt = useFmt();
const day = toRef(props, "day");

function open(x: any) { if (x.kind === "workout") router.push(x.status === "in_progress" ? "/workout" : `/workouts/${x.id}`); else if (x.kind === "activity") router.push(`/activities/${x.id}`); else if (x.routineId) router.push(`/routines/${x.routineId}/start?schedule=${x.scheduleId}&date=${x.date}`); else activitySheet.value = { type: x.activityType }; }
const icon = (x: any) => (x.kind === "activity" ? activityIcon(x.type) : x.kind === "planned" ? "calendar" : "dumbbell");
// an unnamed activity by its type's own name ("Walk"), as every list names it
const typeName = useTypeName();
const label = (x: any) => x.name || (x.type ? typeName(x.type) : "Workout");

// what a band handed over for the day (its night, resting heart rate, steps and distance), as tiles at the top of the
// card; asked only for a day up to today, once a band has handed something over at all
const avail = useHealthAvailable();
const banded = computed(() => !!avail.data.value && Object.values(avail.data.value).some(Boolean));
const hDay = useHealthDay(computed(() => (day.value <= props.today ? day.value : null)), banded);
const dayTiles = computed(() => {
  const d = hDay.data.value;
  if (!d || d.date !== day.value) return [];
  const out: { key: string; icon: string; label: string; value: string; unit: string; sub: string; open?: () => void }[] = [];
  // Sleep, resting heart rate and Steps each open their Stats tab on this day; a day with only its sleep hours (synced
  // before nights came in, or typed) shows those
  const stats = (tab: string) => () => router.push(`/stats?tab=${tab}&day=${d.date}`);
  if (d.sleep) { const n = d.sleep; out.push({ key: "sleep", icon: "moon", label: "Sleep", value: mins(asleepMin(n)), unit: "", sub: `${fmt.value.time(n.startAt)}-${fmt.value.time(n.endAt)}`, open: stats("sleep") }); }
  else if (d.sleepH) out.push({ key: "sleep", icon: "moon", label: "Sleep", value: mins(d.sleepH * 60), unit: "", sub: "Daily log", open: stats("sleep") });
  if (d.restingHr != null) out.push({ key: "rhr", icon: "heartPulse", label: "Resting heart rate", value: String(Math.round(d.restingHr)), unit: "bpm", sub: d.hrv != null ? `HRV ${Math.round(d.hrv)} ms` : "", open: stats("heart") });
  const dist = d.distanceM ? fmt.value.dist(d.distanceM, 1) : "";
  // the day's steps open it on Stats → Steps (its hours, against your usual day)
  if (d.steps) out.push({ key: "steps", icon: "steps", label: "Steps", value: fmt.value.num(d.steps, 0), unit: "", sub: dist, open: stats("steps") });
  else if (dist) { const i = dist.lastIndexOf(" "); out.push({ key: "dist", icon: "walk", label: "Distance", value: dist.slice(0, i), unit: dist.slice(i + 1), sub: "" }); }
  return out;
});
// the day at a glance under its tiles (M-244): the night, the steps by hour and the heart rate on one timeline with the
// day's sessions shaded on it, only from what the band saved; each part opens its Stats tab on this day, as the tiles do
const tlOn = computed(() => banded.value && day.value <= props.today);
const { sessions: tlSessions } = useDaySessions(day, tlOn);
const { tl, has: tlHas } = useDayTimeline(day, computed(() => hDay.data.value), tlOn);
const dayTop = computed(() => dayTiles.value.length > 0 || tlHas.value);
</script>

<template>
  <div class="card" :class="{ wkc: dayTop }">
    <slot name="head" />
    <div v-if="dayTiles.length" class="wstats dtiles">
      <div v-for="x in dayTiles" :key="x.key" class="ws" :class="{ click: x.open }" :role="x.open ? 'button' : 'group'" :tabindex="x.open ? 0 : undefined" :aria-label="[x.label, x.value, x.unit, x.sub].filter(Boolean).join(' ')" @click.stop="x.open?.()" @keydown.enter.stop="x.open?.()">
        <div class="wlb"><Icon :name="x.icon" :size="14" />{{ x.label }}<Icon v-if="x.open" name="right" :size="14" class="wgo" /></div>
        <div class="wv">{{ x.value }} <small v-if="x.unit">{{ x.unit }}</small></div>
        <div class="wd">{{ x.sub }}</div>
      </div>
    </div>
    <div v-if="tlHas" :class="{ csec: dayTiles.length }">
      <DayByHour :tl="tl" :day="day" :sessions="tlSessions" @open="(tab) => router.push(`/stats?tab=${tab}&day=${day}`)" @pick="(id) => router.push(id)" /></div>
    <div :class="{ 'csec dsess': dayTop }"><div v-if="dayTop && items.length" class="lbl hgap">Workouts and activities</div>
    <div v-if="!items.length" class="tiny">{{ day >= today ? "Nothing planned. Use Plan to put a routine on this day." : "No workouts or activities on this day." }}</div>
    <div class="list"><div v-for="x in items" :key="x.id ?? x.scheduleId" class="li click" @click.stop="open(x)">
      <Icon :name="icon(x)" :size="18" :style="{ color: x.color ?? (x.kind === 'activity' ? ACTIVITY_COLOR : WORKOUT_COLOR) }" /><div class="grow"><div class="t" :style="x.missed ? { opacity: .5 } : undefined">{{ label(x) }}</div><div class="s"><template v-if="x.kind === 'planned'">{{ x.missed ? "Missed" : "Planned workout" }}</template><DotLine v-else :parts="[fmt.time(x.startedAt), hrPart(x)].filter((p) => p != null)" /></div></div><SessionStats v-if="x.kind !== 'planned'" :x="x" /><span v-if="x.kind === 'planned'" @click.stop><Menu :items="unplanItems(x)" :label="`Options for ${x.name}`" /></span><Icon v-else name="right" class="muted" /></div></div>
    </div>
  </div>
</template>

<style scoped>
/* the day's sessions under the band's tiles in the shared section (.csec), as Stats' day cards: no line above the first row
   or under the last, as their session list's */
.dsess .li:first-child { padding-top: 0; }
.dsess .li:last-child { border-bottom: 0; padding-bottom: 0; }
/* the phone shows these as rows whose label column is what the subtitles leave over: with the tighter gap "Resting heart rate" still fits beside a night's times; a longer label wraps instead of running under its value */
.dtiles { column-gap: var(--hg); }
.dtiles .wlb { white-space: normal; }
</style>
