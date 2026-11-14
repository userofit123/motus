<script lang="ts">
// outlives the page: see "where you were" below
const kept: { v: { month: number; sel: string | null } | null } = { v: null };
</script>

<script setup lang="ts">
// History (requirement 1): a month calendar of workouts, activities and planned days (click a day to list its sessions below, or an entry to open it),
// or a list. On the phone: a compact month with dots; both show the chosen day's sessions below.
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { daysIntoWeek, weekdayOrder } from "@motus/shared";
import { useRoute, useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { api } from "../api/client";
import { useCalendar, useSettings, useWorkouts, useActivities, useHealthAvailable, useHealthDay, loaded } from "../api/queries";
import { useStepGoal } from "../core/goals";
import { asleepMin, mins } from "../core/sleep";
import Menu from "../components/Menu.vue";
import { unplanItems } from "../components/home/planActions";
import { useFmt, localYmd, activityIcon } from "../core/format";
import { isPhone } from "../core/device";
import { logSheet, activitySheet } from "../core/ui";
import Icon from "../components/Icon.vue";
import SearchField from "../components/SearchField.vue";
import ScheduleEditor from "../components/ScheduleEditor.vue";
import SessionStats from "../components/SessionStats.vue";
import NightSheet from "../components/stats/NightSheet.vue";

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
  // the engine sends workouts and activities as separate lists, so a day would show all its workouts before its activities;
  // order each day like Home's list for a day (oldest first, in order of when they happened), plans (no time of their own) after what was done
  for (const xs of m.values()) xs.sort((a, b) => (a.kind === "planned" ? 1 : 0) - (b.kind === "planned" ? 1 : 0) || (a.startedAt && b.startedAt ? a.startedAt.localeCompare(b.startedAt) : 0));
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
// The chosen day's highlight is one element (.calsel) that glides from the old day to the new one, sideways, up and down
// or diagonally, with the shared ease-out (--ease) over 200-300ms by distance; the tab pill (core/segSlide.ts) eases in-out, but the developer asked for a faster start here. A month drawn anew (another
// month, back from List) puts it in place without sliding over from the old month; so does a size change (window, entries
// loading, density), which ResizeObserver reports. Reduced motion: the CSS drops the transition, so it jumps.
let calEl: HTMLElement | null = null, calAt: { x: number; y: number } | null = null;
const calRo = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => placeSel(false)) : null;
function placeSel(slide: boolean) {
  const box = calEl?.querySelector<HTMLElement>(":scope>.calsel"), d = calEl?.querySelector<HTMLElement>(":scope>.d.sel");
  if (!box) return;
  if (!d) { box.hidden = true; calAt = null; return; }
  const x = d.offsetLeft, y = d.offsetTop;
  slide = slide && !!calAt && !box.hidden;
  const dist = calAt ? Math.hypot(x - calAt.x, y - calAt.y) : 0;
  box.style.setProperty("--csd", Math.round(Math.min(300, 200 + dist * 0.1)) + "ms");
  if (!slide) box.style.transition = "none";
  box.hidden = false;
  box.style.width = d.offsetWidth + "px"; box.style.height = d.offsetHeight + "px";
  box.style.transform = `translate(${x}px, ${y}px)`;
  if (!slide) { void box.offsetWidth; box.style.transition = ""; }
  calAt = { x, y };
}
const calRef = (el: unknown) => {
  const e = (el as HTMLElement | null) ?? null;
  if (e === calEl) return;
  if (calEl) calRo?.unobserve(calEl);
  calEl = e; calAt = null;
  if (e) { calRo?.observe(e); placeSel(false); }
};
watch(sel, () => placeSel(true), { flush: "post" });
onBeforeUnmount(() => calRo?.disconnect());
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
  const done = (x: any) => (x.kind === "workout" && x.status === "completed") || x.kind === "activity";
  const w = all.filter((x) => x.kind === "workout" && x.status === "completed"), a = all.filter((x) => x.kind === "activity");
  return { workouts: w.length, activities: a.length, timeS: [...w, ...a].reduce((t, x) => t + (x.durationS ?? 0), 0), days: inMonth.filter(([, v]) => v.some(done)).length };
});
const planDay = ref<string | null>(null);
// what a band handed over for the chosen day (its night, resting heart rate, steps and distance), as tiles at the top of
// the day's card; asked only for a day up to today, once a band has handed something over at all
const avail = useHealthAvailable();
const banded = computed(() => !!avail.data.value && Object.values(avail.data.value).some(Boolean));
const hDay = useHealthDay(computed(() => (sel.value && sel.value <= today ? sel.value : null)), banded);
const nightOpen = ref<string | null>(null);
// each day's steps as a thin bar along the bottom of its cell (M-200), so a day with only band data no longer looks empty:
// filled to the steps goal (green once reached), or without one against the shown weeks' busiest day as Home's week bars.
// Sleep gets no mark: a night spans two days, so it stays in the chosen day's tiles. Only with band data at all.
// The daily log from the grid's first day on, under the key Home's daily log uses (useDaily), so live updates reload it
const stepGoal = useStepGoal();
const dailyQ = useQuery({ queryKey: computed(() => ["activities", "daily", range.value.from]), enabled: banded,
  queryFn: () => api.get<{ date: string; kind: string; value: number | string }[]>("/daily", { from: range.value.from, tz: new Date().getTimezoneOffset() }) });
const stepsOf = computed(() => {
  const m = new Map<string, number>();
  if (!banded.value) return m;
  for (const r of dailyQ.data.value ?? []) { const d = String(r.date).slice(0, 10), n = Number(r.value); if (r.kind === "steps" && n > 0 && d >= range.value.from && d <= range.value.to && d <= today) m.set(d, n); }
  return m;
});
const stepTop = computed(() => stepGoal.value?.target || Math.max(1, ...stepsOf.value.values()));
const stepBars = computed(() => new Map([...stepsOf.value].map(([d, n]) => {
  const g = stepGoal.value?.target, ok = !!g && n >= g;
  return [d, { pct: Math.min(100, (n / stepTop.value) * 100), ok,
    label: ok ? `${fmt.value.num(n, 0)} steps, goal reached` : g ? `${fmt.value.num(n, 0)} of ${fmt.value.num(g, 0)} steps` : `${fmt.value.num(n, 0)} steps` }];
})));
const dayTiles = computed(() => {
  const d = hDay.data.value;
  if (!d || d.date !== sel.value) return [];
  const out: { key: string; icon: string; label: string; value: string; unit: string; sub: string; open?: () => void }[] = [];
  // a night's detail opens it; a day with only its sleep hours (synced before nights came in, or typed) shows those
  if (d.sleep) { const n = d.sleep; out.push({ key: "sleep", icon: "moon", label: "Sleep", value: mins(asleepMin(n)), unit: "", sub: `${fmt.value.time(n.startAt)}-${fmt.value.time(n.endAt)}`, open: () => (nightOpen.value = n.date) }); }
  else if (d.sleepH) out.push({ key: "sleep", icon: "moon", label: "Sleep", value: mins(d.sleepH * 60), unit: "", sub: "" });
  if (d.restingHr != null) out.push({ key: "rhr", icon: "heart", label: "Resting", value: String(Math.round(d.restingHr)), unit: "bpm", sub: d.hrv != null ? `HRV ${Math.round(d.hrv)} ms` : "" });
  const dist = d.distanceM ? fmt.value.dist(d.distanceM, 1) : "";
  if (d.steps) out.push({ key: "steps", icon: "steps", label: "Steps", value: fmt.value.num(d.steps, 0), unit: "", sub: dist });
  else if (dist) { const i = dist.lastIndexOf(" "); out.push({ key: "dist", icon: "walk", label: "Distance", value: dist.slice(0, i), unit: dist.slice(i + 1), sub: "" }); }
  return out;
});
// a workout's average heart rate from a band, after its time in the row's line
const hrOf = (x: any) => (x.kind !== "planned" && x.avgHr ? Math.round(Number(x.avgHr)) : null);
// the shown month's totals, as stat tiles at the end of the calendar (they follow the month you are looking at); the
// tiles of Home's This week and Stats' month reports, in their order (Activities in Volume's place), without a change column: the calendar loads only this month
const monthTiles = computed(() => {
  const m = monthStats.value;
  return [
    { key: "workouts", icon: "dumbbell", label: "Workouts", value: String(m.workouts) },
    { key: "time", icon: "clock", label: "Time", value: fmt.value.dur(m.timeS, true) },
    { key: "activities", icon: "walk", label: "Activities", value: String(m.activities) },
    { key: "days", icon: "calendar", label: "Active days", value: String(m.days) },
  ];
});
const monthTitle = computed(() => (localYmd(month.value).slice(0, 7) === today.slice(0, 7) ? "This month" : month.value.toLocaleDateString(undefined, { month: "long", year: "numeric" })));
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
    <div class="ph tabbed">
      <h1>Calendar</h1>
      <div class="acts">
        <div class="seg"><button :class="{ on: view === 'calendar' }" @click="view = 'calendar'">Calendar</button><button :class="{ on: view === 'list' }" @click="view = 'list'">List</button></div>
      </div>
    </div>

    <Transition name="sw" mode="out-in">
    <div v-if="view === 'calendar'" key="cal">
      <div class="calnav">
        <div class="calm">
          <button class="ib sm plain" aria-label="Previous month" @click="shift(-1)"><Icon name="left" :size="18" /></button>
          <b>{{ month.toLocaleDateString(undefined, { month: "long", year: "numeric" }) }}</b>
          <button class="ib sm plain" aria-label="Next month" @click="shift(1)"><Icon name="right" :size="18" /></button>
        </div>
        <div class="calx">
          <button v-if="localYmd(month).slice(0, 7) !== today.slice(0, 7)" class="fchip acc" @click="month = new Date(new Date().getFullYear(), new Date().getMonth(), 1); sel = today">Today</button>
          <button v-if="!isPhone && (!sel || sel < today)" class="qb acc" @click="planDay = today"><Icon name="plus" :size="16" />Plan a workout</button>
        </div>
      </div>
      <Transition :name="calDir" mode="out-in">
      <div :key="month.getTime()" :ref="calRef" class="cal" :class="{ stps: stepsOf.size }" @touchstart.passive="calStart" @touchend.passive="calEnd">
        <i class="calsel" aria-hidden="true" hidden />
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
          <template v-for="b in [stepBars.get(localYmd(d))]" :key="0"><i v-if="b" class="stp" :class="{ ok: b.ok }" role="img" :aria-label="b.label" :title="b.label"><b :style="{ width: b.pct + '%' }" /></i></template>
        </div>
      </div>
      </Transition>
      <div v-if="sel" :key="sel" class="spt dayfade">
        <div class="sh first"><h2>{{ fmt.date(sel, { weekday: "long", day: "numeric", month: "long" }) }}</h2><div class="grow" /><span v-if="sel <= today" @click.stop><Menu label="Log on this day" align="start" :items="[{ label: 'Log a workout', icon: 'dumbbell', run: () => (logSheet = { date: sel ?? undefined }) }, { label: 'Log an activity', icon: 'activity', run: () => (activitySheet = {}) }]" /></span><button v-if="sel >= today" class="lnk" @click="planDay = sel"><Icon name="plus" :size="14" />Plan</button></div>
        <!-- the band's numbers for the day as a report's tiles, then the day's sessions under a faint line -->
        <div class="card" :class="{ wkc: dayTiles.length }">
          <div v-if="dayTiles.length" class="wstats dtiles">
            <div v-for="x in dayTiles" :key="x.key" class="ws" :class="{ click: x.open }" :role="x.open ? 'button' : 'group'" :tabindex="x.open ? 0 : undefined" :aria-label="[x.label, x.value, x.unit, x.sub].filter(Boolean).join(' ')" @click="x.open?.()" @keydown.enter="x.open?.()">
              <div class="wlb"><Icon :name="x.icon" :size="14" />{{ x.label }}</div>
              <div class="wv">{{ x.value }} <small v-if="x.unit">{{ x.unit }}</small></div>
              <div class="wd">{{ x.sub }}</div>
            </div>
          </div>
          <div :class="{ dsess: dayTiles.length }">
          <div v-if="!(byDay.get(sel) ?? []).length" class="tiny">{{ sel >= today ? "Nothing planned. Use Plan to put a routine on this day." : "Nothing on this day." }}</div>
          <div class="list"><div v-for="x in byDay.get(sel) ?? []" :key="x.id ?? x.scheduleId" class="li click" @click="open(x)">
            <Icon :name="icon(x)" :size="18" :style="{ color: x.color ?? 'var(--acc)' }" /><div class="grow"><div class="t" :style="x.missed ? { opacity: .5 } : undefined">{{ label(x) }}</div><div class="s">{{ x.kind === "planned" ? (x.missed ? "Missed" : "Planned") : fmt.time(x.startedAt) }}<template v-if="hrOf(x)"> · <span class="hr"><Icon name="heart" :size="12" />{{ hrOf(x) }} bpm</span></template></div></div><SessionStats v-if="x.kind !== 'planned'" :x="x" /><span v-if="x.kind === 'planned'" @click.stop><Menu :items="unplanItems(x)" :label="`Options for ${x.name}`" /></span><Icon v-else name="right" class="muted" /></div></div>
          </div>
        </div>
      </div>
      <!-- the month's totals, after everything else; List needs none, each of its months has its count beside its name -->
      <div class="card wkc spt">
        <div class="ch"><span class="bi"><Icon name="calendar" :size="15" /></span><span class="t grow">{{ monthTitle }}</span></div>
        <div class="wstats n4 plain">
          <div v-for="x in monthTiles" :key="x.key" class="ws" role="group" :aria-label="`${x.label} ${x.value}`">
            <div class="wlb"><Icon :name="x.icon" :size="14" />{{ x.label }}</div>
            <div class="wv">{{ x.value }}</div>
          </div>
        </div>
      </div>
    </div>

    <div v-else key="list">
      <SearchField v-model="qtext" class="lsearch" placeholder="Search workouts and activities" />
      <div v-if="!list.length" class="card empty"><Icon name="calendar" :size="34" /><b>Nothing yet</b>Finished workouts and activities show here.</div>
      <section v-for="[m, xs] in listGroups" :key="m"><div class="sh"><h2>{{ m }}</h2><span class="tiny">{{ xs.length }}</span></div>
        <div class="card"><div class="list"><div v-for="x in xs" :key="x.id" class="li click" @click="open(x)">
          <Icon :name="icon(x)" :size="18" :style="{ color: x.color ?? 'var(--acc)' }" />
          <div class="grow"><div class="t">{{ label(x) }}</div><div class="s">{{ fmt.date(x.startedAt, { weekday: "short", day: "numeric", month: "short" }) }} · {{ fmt.time(x.startedAt) }}<template v-if="hrOf(x)"> · <span class="hr"><Icon name="heart" :size="12" />{{ hrOf(x) }} bpm</span></template></div></div>
          <SessionStats :x="x" />
        </div></div></div>
      </section>
    </div>
    </Transition>

    <NightSheet v-if="nightOpen" :date="nightOpen" @close="nightOpen = null" />
    <ScheduleEditor v-if="planDay" :schedule="{ rule: 'once', startDate: planDay }" @close="planDay = null" />
  </div>
</template>

<style scoped>
/* the day's sessions a block-padding below the band's tiles, under a faint line, as a report's highlights */
.dsess { margin-top: var(--cpy); border-top: 1px solid var(--ol); }
.dsess .li:last-child { border-bottom: 0; padding-bottom: 0; }
.dsess > .tiny { padding-top: var(--cpy); }
.dtiles .ws.click { border-radius: var(--r-sm); cursor: pointer; }
/* a workout's heart rate in its row's line: the small heart in the line's colour, beside its number */
.hr { display: inline-flex; align-items: center; gap: 2px; white-space: nowrap; }
.hr svg { flex: none; }
/* a day's steps: a thin bar on the cell's bottom edge, out of the way of its entries and dots; the track (the cell's width
   inside its padding) has no colour of its own, so a short bar reads as few steps and none as no steps */
/* the month's cells keep room for it under their entries, all alike, so a full day's last entry never sits on it */
.cal.stps .d { padding-bottom: 15px; }
html.phone .cal.stps .d { padding-bottom: 8px; }
.cal .stp { position: absolute; left: 6px; right: 6px; bottom: 6px; height: 3px; pointer-events: none; }
.cal .stp b { display: block; height: 100%; min-width: 3px; border-radius: 2px; background: color-mix(in srgb, var(--acc) 50%, transparent); }
.cal .stp.ok b { background: color-mix(in srgb, var(--pos) 50%, transparent); }
/* on the phone the day's number and dots are centred, so the bar grows from the middle */
html.phone .cal .stp { bottom: 3px; height: 2px; display: flex; justify-content: center; }
</style>
