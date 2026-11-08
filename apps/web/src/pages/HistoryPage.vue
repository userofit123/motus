<script lang="ts">
// outlives the page: see "where you were" below
const kept: { v: { month: number; sel: string | null } | null } = { v: null };
</script>

<script setup lang="ts">
// History (requirement 1): a month calendar of workouts, activities and planned days (click a day to list its sessions below, or an entry to open it),
// or a list. On the phone: a compact month with dots; both show the chosen day's sessions below.
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useCalendar, useSettings, useWorkouts, useActivities, loaded } from "../api/queries";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { toast } from "../core/toast";
import Menu from "../components/Menu.vue";
import { useFmt, localYmd } from "../core/format";
import { isPhone } from "../core/device";
import { activitySheet } from "../core/ui";
import Icon from "../components/Icon.vue";
import ScheduleEditor from "../components/ScheduleEditor.vue";

const route = useRoute(), router = useRouter();
const s = useSettings();
const fmt = useFmt();
const view = ref<"calendar" | "list">(route.query.view === "list" ? "list" : "calendar");
watch(view, (v) => router.replace({ query: v === "list" ? { view: "list" } : {} }));
// where you were (month, chosen day), so coming Back from something you opened from here lands on the same day;
// kept for this visit of the app only. A link to a day (?date=YYYY-MM-DD, e.g. from Home's week) opens on that day instead
const qd = typeof route.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(route.query.date) ? route.query.date : null;
const memo = qd ? { month: new Date(Number(qd.slice(0, 4)), Number(qd.slice(5, 7)) - 1, 1).getTime(), sel: qd } : kept.v;
const month = ref(memo ? new Date(memo.month) : new Date(new Date().getFullYear(), new Date().getMonth(), 1));
const first = computed(() => s.value.firstDay);
const grid = computed(() => {
  const m = month.value, start = new Date(m);
  const lead = (m.getDay() - first.value + 7) % 7;
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
const DOW = computed(() => Array.from({ length: 7 }, (_, i) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][(i + first.value) % 7]));
const calDir = ref("nx");
const shift = (n: number) => { calDir.value = n > 0 ? "nx" : "pv"; month.value = new Date(month.value.getFullYear(), month.value.getMonth() + n, 1); };
const sel = ref<string | null>(memo?.sel ?? today);
watch([month, sel], () => { kept.v = { month: month.value.getTime(), sel: sel.value }; }, { flush: "sync" });
// on the phone a sideways swipe on the month changes the month (elsewhere on the page it changes tab)
let sx = 0, sy = 0;
const calStart = (e: TouchEvent) => { sx = e.touches[0]!.clientX; sy = e.touches[0]!.clientY; };
const calEnd = (e: TouchEvent) => { const dx = e.changedTouches[0]!.clientX - sx, dy = e.changedTouches[0]!.clientY - sy; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) shift(dx < 0 ? 1 : -1); };
function open(x: any) { if (x.kind === "workout") router.push(x.status === "in_progress" ? "/workout" : `/workouts/${x.id}`); else if (x.kind === "activity") router.push(`/activities/${x.id}`); else if (x.routineId) router.push(`/routines/${x.routineId}/start?schedule=${x.scheduleId}&date=${x.date}`); else activitySheet.value = { type: x.activityType }; }
const icon = (x: any) => (x.kind === "activity" ? (["walk", "run", "cycle", "hike", "swim", "yoga"].includes(x.type) ? x.type : "activity") : x.kind === "planned" ? "calendar" : "dumbbell");
const label = (x: any) => x.name || (x.type ? x.type[0].toUpperCase() + x.type.slice(1) : "Workout");
const monthStats = computed(() => {
  const inMonth = [...byDay.value.entries()].filter(([d]) => d.slice(0, 7) === localYmd(month.value).slice(0, 7));
  const all = inMonth.flatMap(([, v]) => v);
  const w = all.filter((x) => x.kind === "workout" && x.status === "completed"), a = all.filter((x) => x.kind === "activity");
  return { workouts: w.length, activities: a.length, timeS: [...w, ...a].reduce((t, x) => t + (x.durationS ?? 0), 0), days: inMonth.filter(([, v]) => v.some((x) => x.kind !== "planned")).length };
});
const planDay = ref<string | null>(null);
const n = (k: number, one: string, many = one + "s") => `${k} ${k === 1 ? one : many}`;
const summary = computed(() => {
  const m = monthStats.value;
  if (!m.days) return "Nothing yet this month";
  return [n(m.workouts, "workout"), m.activities ? n(m.activities, "activity", "activities") : "", fmt.value.dur(m.timeS, true)].filter(Boolean).join(" · ");
});
// the schedule's exception for that date drops the planned day; the same call the old day window made
async function skipPlanned(x: any) { await api.post(`/schedules/${x.scheduleId}/exception`, { date: x.date }); invalidate(["calendar", "home"]); toast("Planned workout skipped"); }
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
      <div><h1>Calendar</h1><div class="sub">{{ view === "calendar" ? summary : n(list.length, "session") }}</div></div>
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
            <Icon :name="icon(x)" :size="18" :style="{ color: x.color ?? 'var(--acc)' }" /><div class="grow"><div class="t" :style="x.missed ? { opacity: .5 } : undefined">{{ label(x) }}</div><div class="s">{{ x.kind === "planned" ? (x.missed ? "Missed" : "Planned") : `${fmt.time(x.startedAt)} · ${fmt.dur(x.durationS, true)}${x.distanceM ? " · " + fmt.dist(x.distanceM, 1) : ""}` }}</div></div><span v-if="x.kind === 'planned' && !x.missed" @click.stop><Menu :items="[{ label: 'Skip this day', icon: 'close', run: () => skipPlanned(x) }]" /></span><Icon v-else name="right" class="muted" /></div></div>
        </div>
      </div>
    </div>

    <div v-else key="list">
      <div class="search hgap"><Icon name="search" :size="18" /><input v-model="qtext" placeholder="Search" /></div>
      <div v-if="!list.length" class="card empty"><Icon name="calendar" :size="34" /><b>Nothing yet</b>Finished workouts and activities show here.</div>
      <section v-for="[m, xs] in listGroups" :key="m"><div class="sh"><h2>{{ m }}</h2><span class="tiny">{{ xs.length }}</span></div>
        <div class="card"><div class="list"><div v-for="x in xs" :key="x.id" class="li click" @click="open(x)">
          <Icon :name="icon(x)" :size="18" :style="{ color: x.color ?? 'var(--acc)' }" />
          <div class="grow"><div class="t">{{ label(x) }}</div><div class="s">{{ fmt.date(x.startedAt, { weekday: "short", day: "numeric", month: "short" }) }} · {{ fmt.time(x.startedAt) }}</div></div>
          <div class="r tiny"><div>{{ fmt.dur(x.durationS, true) }}</div><div>{{ x.kind === "workout" ? `${x.setCount} sets · ${fmt.vol(x.volumeKg)}` : x.distanceM ? fmt.dist(x.distanceM, 1) : "" }}</div></div>
        </div></div></div>
      </section>
    </div>
    </Transition>

    <ScheduleEditor v-if="planDay" :schedule="{ rule: 'once', startDate: planDay }" @close="planDay = null" />
  </div>
</template>
