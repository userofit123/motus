<script setup lang="ts">
// Settings → Integrations → Imported data: everything that came in from Health Connect, newest first, a day at a time.
// A value (steps, sleep, weight) is corrected in place; an activity opens on its own page. Deleting one keeps it deleted:
// the engine remembers it, so the next sync doesn't bring it back.
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useInfiniteQuery } from "@tanstack/vue-query";
import { TOPICS, toM } from "@motus/shared";
import { api } from "../../api/client";
import { invalidate } from "../../api/live";
import { useActivityTypes } from "../../api/queries";
import { isPhone } from "../../core/device";
import { goBack } from "../../core/leave";
import { useFmt, localYmd, activityIcon } from "../../core/format";
import { confirm, prompt } from "../../core/ask";
import { toast, toastError } from "../../core/toast";
import Icon from "../Icon.vue";
import Menu, { type MenuItem } from "../Menu.vue";
import SessionStats from "../SessionStats.vue";

interface Item {
  key: string; kind: "steps" | "sleep" | "weight" | "resting_hr" | "spo2" | "hrv" | "distance" | "active_kcal" | "activity"; date: string; at: string | null; value: number | null;
  activity: { id: string; type: string; name: string | null; startedAt: string; durationS: number; distanceM: number | null; steps: number | null; avgHr: number | null } | null;
  ref: string | null; edited: boolean; importedAt: string;
}

type Page = { items: Item[]; cursor: string | null };
const router = useRouter();
const fmt = useFmt();
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

const ICON = { steps: "steps", sleep: "moon", weight: "scale", resting_hr: "heart", spo2: "water", hrv: "heartPulse", distance: "map", active_kcal: "flame" } as const;
const NAME = { steps: "Steps", sleep: "Sleep", weight: "Body weight", resting_hr: "Resting heart rate", spo2: "Blood oxygen", hrv: "HRV", distance: "Distance", active_kcal: "Active calories" } as const;
// a day's heart values: whole beats and milliseconds, blood oxygen to a tenth when the band gave one
const UNIT = { resting_hr: "bpm", spo2: "%", hrv: "ms" } as const;
type Vital = keyof typeof UNIT;
const isVital = (k: Item["kind"]): k is Vital => k in UNIT;
const vitalNum = (k: Vital, v: number) => fmt.value.num(v, k === "spo2" && !Number.isInteger(v) ? 1 : 0);
const typeName = (slug: string) => (types.data.value ?? []).find((t: any) => t.slug === slug)?.name ?? slug[0]!.toUpperCase() + slug.slice(1);
const icon = (x: Item) => (x.kind === "activity" ? activityIcon(x.activity?.type) : ICON[x.kind]);
const title = (x: Item) => (x.kind === "activity" ? x.activity?.name || typeName(x.activity?.type ?? "activity") : NAME[x.kind]);
// the value in the person's units: "8,432", "7.5 h", "72.4 kg", "58 bpm", "97%", "6.42 km", "412 kcal"
const value = (x: Item) => x.value == null ? "-" : x.kind === "distance" ? fmt.value.dist(x.value) : x.kind === "active_kcal" ? `${fmt.value.num(x.value, 0)} kcal` : isVital(x.kind) ? `${vitalNum(x.kind, x.value)}${x.kind === "spo2" ? "" : " "}${UNIT[x.kind]}` : x.kind === "steps" ? fmt.value.num(x.value, 0) : x.kind === "sleep" ? `${fmt.value.num(x.value, 1)} h` : `${fmt.value.w(x.value)} ${fmt.value.wu}`;
// when it was: an activity's start (and its type, when it has a name of its own), a weighing's time, a night's end;
// a day's steps and heart values are the whole day
const sub = (x: Item) => x.kind === "activity" && x.activity ? [fmt.value.time(x.activity.startedAt), x.activity.name ? typeName(x.activity.type) : ""].filter(Boolean).join(" · ")
  : x.kind === "steps" || x.kind === "distance" || x.kind === "active_kcal" || isVital(x.kind) ? "Whole day" : x.at ? fmt.value.time(x.at) : x.kind === "sleep" ? "Night" : "-";

const path = (x: Item) => `/health/imports/${encodeURIComponent(x.key)}`;
const changed = () => invalidate([...TOPICS.health]);
// typed in the person's units and kept in kg, whole steps, hours of sleep, bpm, % and ms, metres and whole kcal
async function edit(x: Item) {
  if (x.kind === "activity") { if (x.activity) router.push(`/activities/${x.activity.id}`); return; }
  const shown = x.value == null ? "" : x.kind === "weight" ? fmt.value.w(x.value) : x.kind === "distance" ? String(Math.round(fmt.value.distNum(x.value) * 100) / 100)
    : String(x.kind === "steps" || x.kind === "active_kcal" ? Math.round(x.value) : Math.round(x.value * 10) / 10);
  const v = await prompt(x.kind === "weight" ? `Body weight (${fmt.value.wu})` : x.kind === "distance" ? `Distance (${fmt.value.du})` : x.kind === "active_kcal" ? "Active calories (kcal)"
    : isVital(x.kind) ? `${NAME[x.kind]} (${UNIT[x.kind]})` : x.kind === "sleep" ? "Sleep (h)" : "Steps", { value: shown.replace(/,/g, "") });
  if (v == null || v.trim() === "") return;
  const n = Number(v.trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return toast("Type a number", { kind: "err" });
  try {
    await api.put(path(x), { value: x.kind === "weight" ? fmt.value.toKg(n) : x.kind === "distance" ? Math.round(toM(n, fmt.value.du)) : x.kind === "steps" || x.kind === "active_kcal" ? Math.round(n) : n });
    changed(); toast(`${NAME[x.kind]} saved`);
  } catch (e) { toastError(e); }
}
async function del(x: Item) {
  const act = x.kind === "activity";
  if (!(await confirm(act ? "Delete this activity?" : "Delete this entry?", { text: "It won't come back on the next sync.", ok: "Delete", danger: true }))) return;
  try { await api.del(path(x)); changed(); toast(act ? "Activity deleted" : "Entry deleted"); } catch (e) { toastError(e); }
}
const menu = (x: Item): MenuItem[] => [
  x.kind === "activity" ? { label: "Open", icon: "right", run: () => edit(x) } : { label: "Edit", icon: "edit", run: () => edit(x) },
  { label: "Delete", icon: "trash", danger: true, sep: true, run: () => del(x) },
];
</script>

<template>
  <!-- on a computer the page's header stays "Settings" (it would move the section list), so the screen names itself here -->
  <div v-if="!isPhone" class="sh first"><h2>Imported data</h2><button class="lnk" @click="goBack(router, '/settings/integrations')"><Icon name="left" :size="14" />Integrations</button></div>
  <p class="muted" style="margin:0">What Motus read from Health Connect. Tap a value to correct it or an activity to open it. Anything you delete isn't imported again.</p>
  <div v-if="q.isLoading.value" class="card" style="opacity:.4;min-height:120px" />
  <div v-else-if="q.isError.value" class="card empty sm"><b>Couldn't load the imported data</b>{{ (q.error.value as Error)?.message }}<br /><button class="btn tonal" @click="q.refetch()">Try again</button></div>
  <div v-else-if="!items.length" class="card empty sm"><b>Nothing imported yet</b>Steps, sleep, weight, heart data, distance, calories and workouts from Health Connect will be listed here after the first sync.</div>
  <template v-for="d in days" :key="d.day">
    <div class="sh"><h2>{{ dayName(d.day) }}</h2></div>
    <div class="card"><div class="list">
      <div v-for="x in d.items" :key="x.key" class="li click" role="button" tabindex="0" @click="edit(x)" @keydown.enter.self="edit(x)">
        <span class="bi sg"><Icon :name="icon(x)" :size="16" /></span>
        <div class="grow"><div class="t">{{ title(x) }}<span v-if="x.edited" class="mchip hi-chip">Edited</span></div><div class="s">{{ sub(x) }}</div></div>
        <SessionStats v-if="x.kind === 'activity' && x.activity" :x="{ kind: 'activity', durationS: x.activity.durationS, distanceM: x.activity.distanceM, steps: x.activity.steps }" />
        <b v-else class="num">{{ value(x) }}</b>
        <span @click.stop><Menu :items="menu(x)" :label="`Options for ${title(x)}`" /></span>
      </div>
    </div></div>
  </template>
  <div v-if="q.hasNextPage.value" class="center"><button class="qb" :disabled="q.isFetchingNextPage.value" @click="q.fetchNextPage()">{{ q.isFetchingNextPage.value ? "Loading…" : "Show older" }}</button></div>
</template>

<style scoped>
.hi-chip { margin-inline-start: 6px; }
</style>
