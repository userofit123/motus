<script setup lang="ts">
// Settings → Integrations → Imported data: everything that came in from Health Connect, newest first, a day at a time.
// A value (steps, sleep, weight) is corrected in place; an activity opens on its own page. Deleting one keeps it deleted:
// the engine remembers it, so the next sync doesn't bring it back, and it is listed under Deleted, where it can be
// restored. A day's number is listed also when the day uses a typed one instead: it says so, with the way to use it.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useInfiniteQuery, useQuery } from "@tanstack/vue-query";
import { TOPICS, toM } from "@motus/shared";
import { api } from "../../api/client";
import { invalidate } from "../../api/live";
import { useActivityTypes, useSleep } from "../../api/queries";
import { isPhone } from "../../core/device";
import { goBack } from "../../core/leave";
import { useFmt, localYmd, activityIcon } from "../../core/format";
import { mins } from "../../core/sleep";
import { confirm, prompt } from "../../core/ask";
import { toast, toastError } from "../../core/toast";
import DotLine from "../DotLine.vue";
import Icon from "../Icon.vue";
import Menu, { type MenuItem } from "../Menu.vue";
import SessionStats from "../SessionStats.vue";
import Sheet from "../Sheet.vue";
import StepSourceRows from "../StepSourceRows.vue";
import { canStepSources, stepSources, adviceWord, useDevice, healthSupported, syncHealth, fromWhere, type StepSources } from "../../native/health";

interface Item {
  key: string; kind: "steps" | "sleep" | "weight" | "resting_hr" | "spo2" | "hrv" | "distance" | "active_kcal" | "body_fat" | "water" | "vo2max" | "activity"; date: string; at: string | null; value: number | null;
  activity: { id: string; type: string; name: string | null; startedAt: string; durationS: number; distanceM: number | null; steps: number | null; avgHr: number | null } | null;
  // typed: the day's typed value when the day uses it instead of this one (else null); walks: the walks' steps when
  // they count instead of this synced count (daySteps), so using this one would change nothing
  ref: string | null; edited: boolean; importedAt: string; typed?: number | null; walks?: number | null; worn?: boolean | null;
}
// restored: taken back and not in again yet (no deletedAt): it comes with the phone's next read
interface Deleted { key: string; kind: Item["kind"]; date: string | null; deletedAt: string | null; restored?: boolean }

type Page = { items: Item[]; cursor: string | null };
const router = useRouter();
const fmt = useFmt();
const dev = useDevice();
const types = useActivityTypes();
// filed under "health", which every import, edit and delete announces
const q = useInfiniteQuery({
  queryKey: ["health", "imports"], initialPageParam: "", staleTime: 0,
  getNextPageParam: (p: Page) => p.cursor ?? undefined,
  queryFn: ({ pageParam }) => api.get<Page>("/health/imports", { limit: 50, before: pageParam || undefined, tz: new Date().getTimezoneOffset() }),
});
const items = computed<Item[]>(() => (q.data.value?.pages ?? []).flatMap((p) => p.items));

// one list per day, as the Activity log
const days = computed(() => {
  const out: { day: string; items: Item[] }[] = [];
  for (const x of items.value) { const d = x.date.slice(0, 10); if (out.at(-1)?.day !== d) out.push({ day: d, items: [] }); out.at(-1)!.items.push(x); }
  return out;
});
const dayName = (d: string) => d === localYmd(new Date()) ? "Today" : d === localYmd(new Date(Date.now() - 86400000)) ? "Yesterday" : fmt.value.date(d, { weekday: "long", day: "numeric", month: "long", ...(d.slice(0, 4) !== String(new Date().getFullYear()) ? { year: "numeric" } : {}) });

const ICON = { steps: "steps", sleep: "moon", weight: "scale", resting_hr: "heartPulse", spo2: "water", hrv: "wave", distance: "walk", active_kcal: "flame", body_fat: "scale", water: "water", vo2max: "run" } as const;
const NAME = { steps: "Steps", sleep: "Sleep", weight: "Body weight", resting_hr: "Resting heart rate", spo2: "Blood oxygen", hrv: "HRV", distance: "Distance", active_kcal: "Active calories", body_fat: "Body fat", water: "Water", vo2max: "VO2 max" } as const;
// a day's heart values: whole beats and milliseconds, blood oxygen to a tenth when the band gave one
const UNIT = { resting_hr: "bpm", spo2: "%", hrv: "ms", vo2max: "ml/kg/min" } as const;
type Vital = keyof typeof UNIT;
const isVital = (k: Item["kind"]): k is Vital => k in UNIT;
const vitalNum = (k: Vital, v: number) => fmt.value.num(v, (k === "spo2" || k === "vo2max") && !Number.isInteger(v) ? 1 : 0);
const typeName = (slug: string) => (types.data.value ?? []).find((t: any) => t.slug === slug)?.name ?? slug[0]!.toUpperCase() + slug.slice(1);
const icon = (x: Item) => (x.kind === "activity" ? activityIcon(x.activity?.type) : ICON[x.kind]);
const title = (x: Item) => (x.kind === "activity" ? x.activity?.name || typeName(x.activity?.type ?? "activity") : NAME[x.kind]);
// the value in the person's units: "8,432", "7h 30m", "72.4 kg", "58 bpm", "97%", "6.42 km", "412 kcal"
const valueOf = (k: Item["kind"], v: number | null) => v == null || k === "activity" ? "-" : k === "distance" ? fmt.value.dist(v) : k === "active_kcal" ? `${fmt.value.num(v, 0)} kcal` : k === "water" ? `${fmt.value.num(v, 0)} ml` : k === "body_fat" ? `${fmt.value.num(v, 1)}%` : isVital(k) ? `${vitalNum(k, v)}${k === "spo2" ? "" : " "}${UNIT[k]}` : k === "steps" ? fmt.value.num(v, 0) : k === "sleep" ? mins(v * 60) : `${fmt.value.w(v)} ${fmt.value.wu}`;
const value = (x: Item) => valueOf(x.kind, x.value);
// the nights shown here, for their times in bed: the list's own days, oldest to newest (steps, heart values and the like
// are a whole day, which says nothing a row's title doesn't, so they have no second line)
const sleepDays = computed(() => items.value.filter((x) => x.kind === "sleep").map((x) => x.date.slice(0, 10)).sort());
const nights = useSleep(computed(() => ({ from: sleepDays.value[0], to: sleepDays.value.at(-1) })), computed(() => sleepDays.value.length > 0));
const nightOf = (x: Item) => (nights.data.value?.nights ?? []).find((n) => n.date.slice(0, 10) === x.date.slice(0, 10));
// when it was: an activity's start (and its type, when it has a name of its own), a weighing's time, a night's times in bed
const sub = (x: Item) => {
  if (x.kind === "activity" && x.activity) return [fmt.value.time(x.activity.startedAt), x.activity.name ? typeName(x.activity.type) : ""].filter(Boolean).join(" · ");
  if (x.kind === "sleep") { const n = nightOf(x); return n ? `${fmt.value.time(n.startAt)}-${fmt.value.time(n.endAt)}` : ""; }
  return x.kind === "weight" || x.kind === "body_fat" ? (x.at ? fmt.value.time(x.at) : "") : "";
};

const path = (x: Item) => `/health/imports/${encodeURIComponent(x.key)}`;
const changed = () => invalidate([...TOPICS.health]);
// typed in the person's units and kept in kg, whole steps, hours of sleep, bpm, % and ms, metres and whole kcal
async function edit(x: Item) {
  if (x.kind === "activity") { if (x.activity) router.push(`/activities/${x.activity.id}`); return; }
  const shown = x.value == null ? "" : x.kind === "weight" ? fmt.value.w(x.value) : x.kind === "distance" ? String(Math.round(fmt.value.distNum(x.value) * 100) / 100)
    : String(x.kind === "steps" || x.kind === "active_kcal" || x.kind === "water" ? Math.round(x.value) : Math.round(x.value * 10) / 10);
  const v = await prompt(x.kind === "weight" ? `Body weight (${fmt.value.wu})` : x.kind === "distance" ? `Distance (${fmt.value.du})` : x.kind === "active_kcal" ? "Active calories (kcal)" : x.kind === "water" ? "Water (ml)" : x.kind === "body_fat" ? "Body fat (%)"
    : isVital(x.kind) ? `${NAME[x.kind]} (${UNIT[x.kind]})` : x.kind === "sleep" ? "Sleep (h)" : "Steps", { value: shown.replace(/,/g, "") });
  if (v == null || v.trim() === "") return;
  const n = Number(v.trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return toast("Type a number", { kind: "err" });
  try {
    await api.put(path(x), { value: x.kind === "weight" ? fmt.value.toKg(n) : x.kind === "distance" ? Math.round(toM(n, fmt.value.du)) : x.kind === "steps" || x.kind === "active_kcal" || x.kind === "water" ? Math.round(n) : n });
    changed(); toast(`${NAME[x.kind]} saved`);
  } catch (e) { toastError(e); }
}
async function del(x: Item) {
  const act = x.kind === "activity";
  if (!(await confirm(act ? "Delete this activity?" : "Delete this entry?", { text: "It won't come back on the next sync.", ok: "Delete", danger: true }))) return;
  try { await api.del(path(x)); changed(); toast(act ? "Activity deleted" : "Entry deleted"); } catch (e) { toastError(e); }
}
// Where a day's steps came from (the Android app only): each app that wrote steps to Health Connect that day, read from
// Health Connect as it is now, and which one Motus counts, so a day that looks wrong can be checked on the phone
// kept is the steps Motus holds for the day, so a day Health Connect no longer has (Motus can only read so far back: without the history permission, 30 days before it was first allowed) says so
// instead of "no steps" next to a row that shows some
const origin = ref<{ day: string; kept: number | null; data: StepSources | null; error: string | null } | null>(null);
const showOrigin = (x: Item) => loadOrigin(x.date.slice(0, 10), x.value);
async function loadOrigin(day: string, kept: number | null) {
  origin.value = { day, kept, data: null, error: null };
  try { const data = await stepSources(day); if (origin.value?.day === day) origin.value.data = data; }
  catch (e) { if (origin.value?.day === day) origin.value.error = (e as Error)?.message || "Health Connect could not be read"; }
}
// What was deleted, newest deletion first, so a deletion (also one made on another device) can be taken back
const deleted = useQuery({ queryKey: ["health", "imports", "deleted"], staleTime: 0, queryFn: () => api.get<{ items: Deleted[] }>("/health/imports/deleted") });
const delTitle = (x: Deleted) => (x.kind === "activity" ? "Activity" : NAME[x.kind]);
const delIcon = (x: Deleted) => (x.kind === "activity" ? "activity" : ICON[x.kind]);
// every row the same: the data's day when it has one (a day's number; a reading's or session's is gone with it), then
// when it was deleted ("Friday 13 November · deleted 15 November", "Deleted 15 November"); a restore says so below
const delParts = (x: Deleted) => {
  const when = x.deletedAt ? `deleted ${fmt.value.date(x.deletedAt, { day: "numeric", month: "long" })}` : "";
  return x.date ? [dayName(x.date), when].filter(Boolean) : when ? [when[0]!.toUpperCase() + when.slice(1)] : [];
};
const delSub = (x: Deleted) => delParts(x).join(" · ");
const NEXT_SYNC = "Restored - comes back with your phone's next sync";
// On the phone the read starts right away (that day's, from the evening before for a night that began then; a reading
// or session has no day, so the usual read): it says once it's back, as Use synced value in the daily log does.
// Elsewhere (a computer, a browser) no read starts here, so it says it comes with the phone's next sync.
async function restore(x: Deleted) {
  try {
    await api.post(`/health/imports/${encodeURIComponent(x.key)}/restore`);
    changed();
    if (!healthSupported()) return toast(NEXT_SYNC);
    toast("Restored");
    await syncHealth(x.date ? { from: new Date(new Date(x.date + "T00:00").getTime() - 86_400_000) } : {});
    changed();
    const back = await deleted.refetch();
    toast((back.data?.items ?? []).some((d) => d.key === x.key) ? NEXT_SYNC : "It's back");
  } catch (e) { toastError(e); }
}
const originDay = (d: string) => { const n = dayName(d); return n === "Today" || n === "Yesterday" ? n.toLowerCase() : n; };
// the day uses its typed value instead of this one: make it use this one (the typed one stays, for the way back in the daily log)
async function use(x: Item) {
  // as the daily log says it: "Using your watch's value", or Health Connect's for a day no band, watch or ring counted
  try { await api.post(`${path(x)}/use`); changed(); toast(`Using ${fromWhere(x.kind === "water" ? false : x.worn ?? undefined, dev.value)}'s value`); } catch (e) { toastError(e); }
}
// what the day uses instead of this value, in the daily log's word for it ("Used"): a typed value (the default when there
// is one), or for steps the walks in Motus when they are more. Short, so it stays one line beside the value at 360px.
const notUsed = (x: Item) => x.typed != null ? `Typed ${valueOf(x.kind, x.typed)} used` : x.walks != null ? `Walks ${valueOf(x.kind, x.walks)} used` : "";
const menu = (x: Item): MenuItem[] => [
  x.kind === "activity" ? { label: "Open", icon: "right", run: () => edit(x) } : { label: "Edit", icon: "edit", run: () => edit(x) },
  { label: "Use this value", icon: "check", hidden: x.typed == null || x.walks != null, run: () => use(x) },
  { label: "Step sources", icon: "info", hidden: x.kind !== "steps" || !canStepSources(), run: () => showOrigin(x) },
  { label: "Delete", icon: "trash", danger: true, sep: true, run: () => del(x) },
];
</script>

<template>
  <!-- on a computer the page's header stays "Settings" (it would move the section list), so the screen names itself here -->
  <div v-if="!isPhone" class="sh first"><h2>Imported data</h2><button class="lnk" @click="goBack(router, '/settings/integrations')"><Icon name="left" :size="14" />Integrations</button></div>
  <p class="muted" style="margin:0">What Motus read from Health Connect. Tap a value to correct it or an activity to open it. Anything you delete isn't imported again unless you restore it under Deleted.</p>
  <div v-if="q.isLoading.value" class="card" style="opacity:.4;min-height:120px" />
  <div v-else-if="q.isError.value" class="card empty sm"><b>Couldn't load the imported data</b>{{ (q.error.value as Error)?.message }}<br /><button class="btn tonal" @click="q.refetch()">Try again</button></div>
  <div v-else-if="!items.length" class="card empty sm"><b>Nothing imported yet</b>Steps, sleep, weight, body fat, heart data, distance, calories, water and workouts from Health Connect will be listed here after the first sync.</div>
  <template v-for="d in days" :key="d.day">
    <div class="sh"><h2>{{ dayName(d.day) }}</h2></div>
    <div class="card"><div class="list">
      <div v-for="x in d.items" :key="x.key" class="li click" role="button" tabindex="0" @click="edit(x)" @keydown.enter.self="edit(x)">
        <span class="bi sg"><Icon :name="icon(x)" :size="16" /></span>
        <div class="grow"><div class="t">{{ title(x) }}<span v-if="x.edited" class="mchip hi-chip">Edited</span></div><div v-if="sub(x)" class="s">{{ sub(x) }}</div>
          <div v-if="notUsed(x)" class="s">{{ notUsed(x) }}</div></div>
        <SessionStats v-if="x.kind === 'activity' && x.activity" :x="{ kind: 'activity', durationS: x.activity.durationS, distanceM: x.activity.distanceM, steps: x.activity.steps, type: x.activity.type, source: 'health_connect' }" />
        <b v-else class="num">{{ value(x) }}</b>
        <span @click.stop><Menu :items="menu(x)" :label="`Options for ${title(x)}`" /></span>
      </div>
    </div></div>
  </template>
  <Sheet v-if="origin" title="Where these steps came from" @close="origin = null">
    <p class="muted hgap">Steps each app saved to Health Connect for {{ originDay(origin.day) }}. When your {{ adviceWord(dev) }} counted, Motus uses only its total.</p>
    <div v-if="origin.error" class="empty sm"><b>Couldn't read Health Connect</b>{{ origin.error }}<br /><button class="btn tonal" @click="loadOrigin(origin.day, origin.kept)">Try again</button></div>
    <div v-else-if="!origin.data" class="empty sm">Reading Health Connect…</div>
    <div v-else-if="!origin.data.sources.length && origin.kept" class="empty sm"><b>No longer in Health Connect</b>Motus can't read this day from Health Connect any more. It kept the {{ fmt.num(origin.kept, 0) }} steps it read before.</div>
    <div v-else-if="!origin.data.sources.length" class="empty sm"><b>No steps that day</b>No app wrote steps to Health Connect for this day.</div>
    <template v-else>
      <StepSourceRows :sources="origin.data.sources" :phone-name="origin.data.phoneName" :used="origin.data.used"
        :total="{ icon: 'layers', label: `Health Connect's total`, value: origin.data.total, used: !origin.data.used,
                  sub: origin.data.sources.length > 1 ? 'Steps two apps both counted are only counted once' : origin.data.used ? 'All apps together' : `No ${adviceWord(dev)} counted this day` }" />
    </template>
  </Sheet>
  <div v-if="q.hasNextPage.value" class="center"><button class="qb" :disabled="q.isFetchingNextPage.value" @click="q.fetchNextPage()">{{ q.isFetchingNextPage.value ? "Loading…" : "Show older" }}</button></div>
  <template v-if="deleted.data.value?.items.length">
    <div class="sh"><h2>Deleted</h2></div>
    <div class="card"><div class="list">
      <div v-for="x in deleted.data.value.items" :key="x.key" class="li">
        <span class="bi sg"><Icon :name="delIcon(x)" :size="16" /></span>
        <div class="grow"><div class="t">{{ delTitle(x) }}</div><DotLine v-if="delSub(x)" class="s" :parts="delParts(x)" />
          <div v-if="x.restored" class="s">{{ NEXT_SYNC }}</div></div>
        <button v-if="!x.restored" class="qb acc" :aria-label="`Restore ${delTitle(x)}, ${delSub(x)}`" @click="restore(x)">Restore</button>
      </div>
    </div></div>
  </template>
</template>

<style scoped>
.hi-chip { margin-inline-start: 6px; }
</style>
