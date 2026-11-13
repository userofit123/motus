<script lang="ts">
// outlives the page: see "where you were" below
const kept: { v: { month: number; sel: string | null } | null } = { v: null };
</script>

<script setup lang="ts">
// History (requirement 1): a month calendar of workouts, activities and planned days (click a day to list its sessions below, or an entry to open it),
// or a list. On the phone: a compact month with dots; both show the chosen day's sessions below.
import { computed, ref, watch } from "vue";
import { daysIntoWeek, weekdayOrder } from "@motus/shared";
import { useRoute, useRouter } from "vue-router";
import { useCalendar, useSettings, useWorkouts, useActivities, loaded } from "../api/queries";
import Menu from "../components/Menu.vue";
import { unplanItems } from "../components/home/planActions";
import { useFmt, localYmd, activityIcon } from "../core/format";
import { isPhone } from "../core/device";
import { activitySheet } from "../core/ui";
import Icon from "../components/Icon.vue";
import SearchField from "../components/SearchField.vue";
import ScheduleEditor from "../components/ScheduleEditor.vue";
import SessionStats from "../components/SessionStats.vue";

const route = useRoute(), router = useRouter();
const s = useSettings();
const fmt = useFmt();
const view = ref<"calendar" | "list">(route.query.view === "list" ? "list" : "calendar");
watch(view, (v) => router.replace({ query: v === "list" ? { view: "list" } : {} }));
// where you were (month, chosen day), so coming Back from something you opened from here lands on the same day;
// kept for this visit of the app only. A link to a day (?date=YYYY-MM-DD, e.g. from Home's week) opens on that day instead
// a real calendar day only (2026-02-31 is not one)
const dayParam = (v: unknown) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split("-").map(Number);
  return localYmd(new Date(y!, m! - 1, d!)) === v ? v : null;
};
// the link is used once and then dropped from the address, so Back from a workout returns to where you were, not to the link's day
const dropDate = () => { if (route.query.date !== undefined) router.replace({ query: { ...route.query, date: undefined } }); };
const qd = dayParam(route.query.date);
dropDate();
const memo = qd ? { month: new Date(Number(qd.slice(0, 4)), Number(qd.slice(5, 7)) - 1, 1).getTime(), sel: qd } : kept.v;
const month = ref(memo ? new Date(memo.month) : new Date(new Date().getFullYear(), new Date().getMonth(), 1));
const first = computed(() => s.value.firstDay);
const grid = computed(() => {
  const m = month.value, start = new Date(m);
  const lead = daysIntoWeek(m.getDay(), first.value);
  start.setDate(1 - lead);
  // only the weeks this month touches (5 or 6, sometimes 4)
  const cells = Math.ceil((lead + new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
});
const range = computed(() => ({ from: localYmd(grid.value[0]!), to: localYmd(grid.value.at(-1)!) }));
const cal = useCalendar(range);
const today = localYmd(new Date());
const byDay = computed(() => {
  const m = new Map<string, any[]>();
  const add = (d: string, x: any) => m.set(d, [...(m.get(d) ?? []), x]);
  const c = cal.data.value;
  if (!c) return m;
  for (const w of c.workouts) add(localYmd(new Date(w.startedAt)), { kind: "workout", ...w });
  for (const a of c.activities) add(localYmd(new Date(a.startedAt)), { kind: "activity", ...a });
  // the engine leaves out plans already done (by their routine, activity type, or started from the plan)
  for (const p of c.planned) add(p.date, { kind: "planned", missed: p.date < today, ...p });
  return m;
});
const DOW = computed(() => weekdayOrder(first.value).map((i) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][i]));
const calDir = ref("nx");
const shift = (n: number) => { calDir.value = n > 0 ? "nx" : "pv"; month.value = new Date(month.value.getFullYear(), month.value.getMonth() + n, 1); };
const sel = ref<string | null>(memo?.sel ?? today);
// a link to a day while this page is already open
watch(() => route.query.date, (v) => {
  const d = dayParam(v);
  if (d) { month.value = new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, 1); sel.value = d; }
  dropDate();
});
watch([month, sel], () => { kept.v = { month: month.value.getTime(), sel: sel.value }; }, { flush: "sync" });
// on the phone a sideways swipe on the month changes the month (elsewhere on the page it changes tab)
let sx = 0, sy = 0;
const calStart = (e: TouchEvent) => { sx = e.touches[0]!.clientX; sy = e.touches[0]!.clientY; };
const calEnd = (e: TouchEvent) => { const dx = e.changedTouches[0]!.clientX - sx, dy = e.changedTouches[0]!.clientY - sy; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) shift(dx < 0 ? 1 : -1); };
function open(x: any) { if (x.kind === "workout") router.push(x.status === "in_progress" ? "/workout" : `/workouts/${x.id}`); else if (x.kind === "activity") router.push(`/activities/${x.id}`); else if (x.routineId) router.push(`/routines/${x.routineId}/start?schedule=${x.scheduleId}&date=${x.date}`); else activitySheet.value = { type: x.activityType }; }
const icon = (x: any) => (x.kind === "activity" ? activityIcon(x.type) : x.kind === "planned" ? "calendar" : "dumbbell");
const label = (x: any) => x.name || (x.type ? x.type[0].toUpperCase() + x.type.slice(1) : "Workout");
const monthStats = computed(() => {
  const inMonth = [...byDay.value.entries()].filter(([d]) => d.slice(0, 7) === localYmd(month.value).slice(0, 7));
  const all = inMonth.flatMap(([, v]) => v);
  const w = all.filter((x) => x.kind === "workout" && x.status === "completed"), a = all.filter((x) => x.kind === "activity");
  return { workouts: w.length, activities: a.length, timeS: [...w, ...a].reduce((t, x) => t + (x.durationS ?? 0), 0), days: inMonth.filter(([, v]) => v.some((x) => x.kind !== "planned")).length };
});
const planDay = ref<string | null>(null);
const n = (k: number, one: string, many = one + "s") => `${k} ${k === 1 ? one : many}`;
// the shown month's finished workouts and activities and their time together; it follows the month you are looking at,
// so it names that month (a bare "6 workouts · 7h 2m" under the title read as a riddle)
const summary = computed(() => {
  const m = monthStats.value, mk = localYmd(month.value).slice(0, 7);
  const name = mk === today.slice(0, 7) ? "This month" : month.value.toLocaleDateString(undefined, mk.slice(0, 4) === today.slice(0, 4) ? { month: "long" } : { month: "long", year: "numeric" });
  if (!m.workouts && !m.activities) return { head: `${name}:`, parts: [mk >= today.slice(0, 7) ? "nothing yet" : "nothing logged"] };
  return { head: `${name}:`, parts: [m.workouts ? n(m.workouts, "workout") : "", m.activities ? n(m.activities, "activity", "activities") : "", m.timeS ? `${fmt.value.dur(m.timeS, true)} in total` : ""].filter(Boolean) };
});
// list view
const listWorkouts = useWorkouts(computed(() => ({ limit: 300 })));
const listActs = useActivities(computed(() => ({ limit: 300 })));
const qtext = ref("");
const list = computed(() => [...(listWorkouts.data.value ?? []).map((w: any) => ({ kind: "workout", ...w })), ...(listActs.data.value ?? []).map((a: any) => ({ kind: "activity", ...a }))]
  .filter((x: any) => !qtext.value || label(x).toLowerCase().includes(qtext.value.toLowerCase())).sort((a: any, b: any) => b.startedAt.localeCompare(a.startedAt)));
const listGroups = computed(() => { const m = new Map<string, any[]>(); for (const x of list.value) { const k = fmt.value.date(x.startedAt, { month: "long", year: "numeric" }); m.set(k, [...(m.get(k) ?? []), x]); } return [...m]; });
// show the page once its data is in, all at once
await loaded(cal, listWorkouts, listActs);
</script>

<template>
  <div class="page">
    <div class="ph">
      <div><h1>Calendar</h1><div class="sub"><template v-if="view === 'calendar'">{{ summary.head }} <template v-for="(p, i) in summary.parts" :key="p"><template v-if="i"> · </template><span class="nw">{{ p }}</span></template></template><template v-else>{{ n(list.length, "session") }}</template></div></div>
      <div class="acts">
        <div class="seg"><button :class="{ on: view === 'calendar' }" @click="view = 'calendar'">Calendar</button><button :class="{ on: view === 'list' }" @click="view = 'list'">List</button></div>
      </div>
    </div>

    <Transition name="sw" mode="out-in">
    <div v-if="view === 'calendar'" key="cal">
      <div class="calnav">
        <button class="ib sm plain" aria-label="Previous month" @click="shift(-1)"><Icon name="left" :size="18" /></button>
        <b>{{ month.toLocaleDateString(undefined, { month: "long", year: "numeric" }) }}</b>
        <button class="ib sm plain" aria-label="Next month" @click="shift(1)"><Icon name="right" :size="18" /></button>
        <div class="grow" />
        <button v-if="localYmd(month).slice(0, 7) !== today.slice(0, 7)" class="fchip acc" @click="month = new Date(new Date().getFullYear(), new Date().getMonth(), 1); sel = today">Today</button>
        <button v-if="!isPhone && (!sel || sel < today)" class="qb acc" @click="planDay = today"><Icon name="plus" :size="16" />Plan a workout</button>
      </div>
      <Transition :name="calDir" mode="out-in">
      <div :key="month.getTime()" class="cal" @touchstart.passive="calStart" @touchend.passive="calEnd">
        <div v-for="d in DOW" :key="d" class="dh">{{ isPhone ? d![0] : d }}</div>
        <div v-for="d in grid" :key="d.getTime()" class="d" :class="{ out: d.getMonth() !== month.getMonth(), today: localYmd(d) === today, sel: sel === localYmd(d) }" @click="sel = localYmd(d)">
          <span class="n">{{ d.getDate() }}</span>
          <template v-if="!isPhone">
            <div v-for="x in (byDay.get(localYmd(d)) ?? []).slice(0, 3)" :key="x.id ?? x.scheduleId" class="ent" :class="{ plan: x.kind === 'planned', missed: x.missed }" :style="{ '--ec': x.color ?? (x.kind === 'activity' ? 'var(--c3)' : 'var(--acc)') }" @click.stop="open(x)">
              <Icon :name="icon(x)" />{{ label(x) }}
            </div>
            <div v-if="(byDay.get(localYmd(d)) ?? []).length > 3" class="tiny">+{{ (byDay.get(localYmd(d)) ?? []).length - 3 }} more</div>
          </template>
          <div v-else class="dots"><i v-for="x in (byDay.get(localYmd(d)) ?? []).slice(0, 4)" :key="x.id ?? x.scheduleId" :class="{ plan: x.kind === 'planned' }" :style="{ '--ec': x.color ?? (x.kind === 'activity' ? 'var(--c3)' : 'var(--acc)') }" /></div>
        </div>
      </div>
      </Transition>
      <div v-if="sel" :key="sel" class="spt dayfade">
        <div class="sh first"><h2>{{ fmt.date(sel, { weekday: "long", day: "numeric", month: "long" }) }}</h2><div class="grow" /><span v-if="sel <= today" @click.stop><Menu label="Log on this day" align="start" :items="[{ label: 'Log a workout', icon: 'dumbbell', run: () => router.push(`/log?date=${sel}`) }, { label: 'Log an activity', icon: 'activity', run: () => (activitySheet = {}) }]" /></span><button v-if="sel >= today" class="lnk" @click="planDay = sel"><Icon name="plus" :size="14" />Plan</button></div>
        <div class="card">
          <div v-if="!(byDay.get(sel) ?? []).length" class="tiny">{{ sel >= today ? "Nothing planned. Use Plan to put a routine on this day." : "Nothing on this day." }}</div>
          <div class="list"><div v-for="x in byDay.get(sel) ?? []" :key="x.id ?? x.scheduleId" class="li click" @click="open(x)">
            <Icon :name="icon(x)" :size="18" :style="{ color: x.color ?? 'var(--acc)' }" /><div class="grow"><div class="t" :style="x.missed ? { opacity: .5 } : undefined">{{ label(x) }}</div><div class="s">{{ x.kind === "planned" ? (x.missed ? "Missed" : "Planned") : fmt.time(x.startedAt) }}</div></div><SessionStats v-if="x.kind !== 'planned'" :x="x" /><span v-if="x.kind === 'planned'" @click.stop><Menu :items="unplanItems(x)" :label="`Options for ${x.name}`" /></span><Icon v-else name="right" class="muted" /></div></div>
        </div>
      </div>
    </div>

    <div v-else key="list">
      <SearchField v-model="qtext" class="lsearch" placeholder="Search workouts and activities" />
      <div v-if="!list.length" class="card empty"><Icon name="calendar" :size="34" /><b>Nothing yet</b>Finished workouts and activities show here.</div>
      <section v-for="[m, xs] in listGroups" :key="m"><div class="sh"><h2>{{ m }}</h2><span class="tiny">{{ xs.length }}</span></div>
        <div class="card"><div class="list"><div v-for="x in xs" :key="x.id" class="li click" @click="open(x)">
          <Icon :name="icon(x)" :size="18" :style="{ color: x.color ?? 'var(--acc)' }" />
          <div class="grow"><div class="t">{{ label(x) }}</div><div class="s">{{ fmt.date(x.startedAt, { weekday: "short", day: "numeric", month: "short" }) }} · {{ fmt.time(x.startedAt) }}</div></div>
          <SessionStats :x="x" />
        </div></div></div>
      </section>
    </div>
    </Transition>

    <ScheduleEditor v-if="planDay" :schedule="{ rule: 'once', startDate: planDay }" @close="planDay = null" />
  </div>
</template>
