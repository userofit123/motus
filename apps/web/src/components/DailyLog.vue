<script setup lang="ts">
// The daily log: steps (Steps feature) and sleep, water and mood (Sleep, water and mood feature), one value a day.
// Kept apart from body measurements on purpose: these are about the day, not the body. Filed under activity.
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { useSettings } from "../api/queries";
import { localYmd, useFmt } from "../core/format";
import { mins } from "../core/sleep";
import { savedToast, savedError, toast } from "../core/toast";
import { healthSupported, syncHealth, fromWhere, useDevice } from "../native/health";
import { DAILY_KINDS } from "@motus/shared";
import Icon from "./Icon.vue";
import { useStepGoal } from "../core/goals";

// day: which day the boxes write to; history: the last week below, for the sheet (Home's block leaves it off)
const props = defineProps<{ day?: string; history?: boolean }>();
const s = useSettings();
const dev = useDevice();
const stepGoal = useStepGoal();
const fmt = useFmt();
const from = localYmd(new Date(Date.now() - 8 * 86400000));
interface Row { date: string; kind: string; value: number | string | null; source: string | null; band?: boolean; waiting?: boolean; logged?: number | null; walked?: number; worn?: boolean }
const q = useQuery({ queryKey: ["activities", "daily", from], queryFn: () => api.get<Row[]>("/daily", { from, tz: new Date().getTimezoneOffset() }) });
const day = computed(() => props.day ?? localYmd(new Date()));
const row = (k: string, d: string) => (q.data.value ?? []).find((x) => x.kind === k && String(x.date).slice(0, 10) === d);
const num = (v: unknown) => (v == null ? null : Number(v));
// typed: the person's own number (source "manual", null on old rows). band: Health Connect brought the day in; its value
// stands until one is typed over it, which the band then never changes (the engine keeps typed values), so a typed value
// on a band's day offers the way back; waiting: gone back, until the band's next read of the day brings its value
const typed = (r?: Row) => !!r && !r.waiting && (r.source == null || r.source === "manual");
const fromBand = (k: string, d = day.value) => { const r = row(k, d); return !!r?.band && !r.waiting && !typed(r); };
const overBand = (k: string) => { const r = row(k, day.value); return !!r?.band && typed(r); };
const waiting = (k: string) => !!row(k, day.value)?.waiting;
// where the day's value came from, in words: "your band", or "Health Connect" when no band, watch or ring counted it
// (only steps can be such a day here; a value typed over it keeps the word, for the way back)
// water comes from an app you log drinks in, never from a band, so it always says Health Connect
const wornOf = (k: string, d = day.value) => (k === "water_ml" ? false : row(k, d)?.worn);
const where = (k: string) => fromWhere(wornOf(k), dev.value);
// Home's block asks only for what the band doesn't bring: steps and sleep from a band show in their own Home blocks, so
// a kind the band filled in on any recent day is left out there (also before today's value arrives); the sheet keeps all
const banded = computed(() => new Set((q.data.value ?? []).filter((r) => r.band && !typed(r)).map((r) => r.kind)));
const KINDS = computed(() => DAILY_KINDS.filter((k) => s.value.features[k.feature] && (props.history || !banded.value.has(k.id))));
// value: what the day counts (for steps: the typed count, else the recorded walks); the box shows only what was entered
// (logged), and the walks' total shows as a hint under it: "From activities" while it's the day's count, "Recorded" once a
// typed count replaces it, so it never reads as added on top
const val = (k: string, d = day.value) => num(row(k, d)?.value);
const entered = (k: string) => { const r = row(k, day.value); return num(k === "steps" && r ? r.logged : r?.value); };
const walked = computed(() => num(row("steps", day.value)?.walked) ?? 0);
const steps = computed(() => val("steps"));
const showGoal = computed(() => !!stepGoal.value && KINDS.value.some((k) => k.id === "steps"));
// whole numbers read with their thousands separator in the box as everywhere else ("2,434"), so it is a text box that
// takes digits; sleep is two boxes, hours and minutes, as the app writes it ("7h 48m")
const whole = (k: string) => k === "steps" || k === "water_ml";
const boxText = (k: string) => { const v = entered(k); return v == null ? "" : whole(k) ? fmt.value.num(v, 0) : String(v); };
const sleepH = computed(() => { const v = entered("sleep_h"); return v == null ? "" : String(Math.floor(Math.round(v * 60) / 60)); });
const sleepM = computed(() => { const v = entered("sleep_h"); return v == null ? "" : String(Math.round(v * 60) % 60); });
const focused = ref<string | null>(null);
async function put(k: string, value: number | null) {
  const band = fromBand(k);
  try {
    await api.put("/daily", { date: day.value, kind: k, value });
    invalidate(["activities", "stats", "goals", "home"]);
    savedToast(band && value != null ? "Updates stopped" : "Saved");
  } catch (e) { savedError(e); }
}
function set(k: string, e: Event) {
  const t = (e.target as HTMLInputElement).value.trim();
  if (t === "") return put(k, null);
  // whole numbers: every separator dropped, whatever the locale writes; others take a decimal comma too
  const v = whole(k) ? Number(t.replace(/\D/g, "")) : Number(t.replace(",", "."));
  if (!Number.isFinite(v) || v < 0 || (whole(k) && !/\d/.test(t))) { (e.target as HTMLInputElement).value = boxText(k); return; }
  return put(k, v);
}
function setSleep(e: Event) {
  const box = (e.target as HTMLInputElement).closest(".dl-hm")!.querySelectorAll("input");
  const h = box[0]!.value.trim(), m = box[1]!.value.trim();
  if (h === "" && m === "") return put("sleep_h", null);
  const hv = Number(h || 0), mv = Number(m || 0);
  if (!Number.isFinite(hv) || !Number.isFinite(mv) || hv < 0 || mv < 0 || hv + mv / 60 > 24) { box[0]!.value = sleepH.value; box[1]!.value = sleepM.value; return; }
  return put("sleep_h", Math.round((hv + mv / 60) * 100) / 100);
}
// back to the band's value: sleep comes back at once from the night the band recorded; otherwise the typed value goes and
// the band's comes with its next read of that day, which the Android app does right away
// the words say "synced", not the source, so the row's line fits on one line at phone width whichever it was
async function useBand(k: string) {
  try {
    const r = await api.put<{ restored?: boolean }>("/daily", { date: day.value, kind: k, band: true });
    invalidate(["activities", "stats", "goals", "home"]);
    if (r.restored) return toast("Synced value back");
    // the phone reads the band's day now; only say it is back when the read actually brought it
    if (healthSupported() && s.value.features.healthConnect) {
      // from the evening before: that day's night began then
      await syncHealth({ from: new Date(new Date(day.value + "T00:00").getTime() - 86_400_000) });
      const back = await q.refetch();
      if (!(back.data ?? []).find((x) => x.kind === k && String(x.date).slice(0, 10) === day.value)?.waiting) return toast("Synced value back");
    }
    toast("The synced value comes back with your phone's next sync");
  } catch (e) { savedError(e); }
}
// the week before the chosen day, newest first, only days with something logged
const week = computed(() => Array.from({ length: 7 }, (_, i) => localYmd(new Date(new Date(day.value + "T12:00").getTime() - (i + 1) * 86400000)))
  .map((d) => ({ d, v: KINDS.value.map((k) => val(k.id, d)), b: KINDS.value.map((k) => fromBand(k.id, d)), w: KINDS.value.map((k) => wornOf(k.id, d) !== false) }))
  .filter((x) => x.v.some((v) => v != null)));
const anyBand = computed(() => week.value.some((w) => w.b.some(Boolean)));
// the grey numbers' sources: "your band" for those a band counted, "Health Connect" for the rest (water, unworn days);
// both named when both show, so a band user's grey steps and logged water each find theirs
const greyFrom = computed(() => {
  const grey = week.value.flatMap((w) => w.w.filter((_, i) => w.b[i]));
  const band = grey.some(Boolean), hc = grey.some((x) => !x);
  return band && hc ? `${fromWhere(true, dev.value)} and Health Connect` : fromWhere(band, dev.value);
});
// a cell is just the number, as the rows write it: "2,434", "7h 48m"; the unit, when it needs one, is in the header.
// A band's value is grey (as the rows say "From your band"), so typed and band values tell apart without a mark that
// would crowd the columns at phone width
const show = (k: string, v: number | null) => (v == null ? "-" : k === "sleep_h" ? mins(v * 60) : fmt.value.num(v, whole(k) ? 0 : 1));
</script>

<template>
  <div>
    <!-- a row per value, as the measurement rows: icon and name on the left, the box on the right, so every box lines up
         whatever the name's length or a line under it. The line under says where a value came from: the band, or typed
         over the band's (with the way back) -->
    <div class="list">
      <div v-for="k in KINDS" :key="k.id" class="li"><Icon :name="k.icon" :size="18" class="muted" />
        <div class="grow"><div class="t">{{ k.name }}<span v-if="k.unit" class="tiny"> ({{ k.unit }})</span></div>
          <div v-if="fromBand(k.id)" class="s">{{ focused === k.id ? "Typing stops updates" : `From ${where(k.id)}` }}</div>
          <div v-else-if="waiting(k.id)" class="s">Waiting for your phone's next sync</div>
          <div v-else-if="overBand(k.id)" class="s dl-src"><span>Typed in</span><span class="sep">·</span><button class="lnk inl" @click="useBand(k.id)">Use synced value</button></div>
          <div v-else-if="k.id === 'steps' && walked > 0" class="s">{{ entered('steps') != null ? "Recorded" : "From activities" }}: {{ fmt.num(walked, 0) }}</div></div>
        <div v-if="k.id === 'sleep_h'" class="dl-hm">
          <input class="num-in" type="text" inputmode="numeric" placeholder="h" aria-label="Sleep hours" :value="sleepH" @focus="focused = k.id" @blur="focused = null" @change="setSleep" />
          <input class="num-in" type="text" inputmode="numeric" placeholder="m" aria-label="Sleep minutes" :value="sleepM" @focus="focused = k.id" @blur="focused = null" @change="setSleep" />
        </div>
        <input v-else class="num-in" type="text" :inputmode="whole(k.id) ? 'numeric' : 'decimal'" :aria-label="k.name" :value="boxText(k.id)" @focus="focused = k.id" @blur="focused = null" @change="set(k.id, $event)" />
      </div>
    </div>
    <div v-if="showGoal" class="dl-goal"><div class="dl-bar"><i :style="{ width: Math.min(100, ((steps ?? 0) / stepGoal!.target) * 100) + '%' }" /></div>
      <span class="tiny">{{ fmt.num(steps ?? 0, 0) }} of {{ fmt.num(stepGoal!.target, 0) }} steps</span></div>
    <template v-if="history && week.length">
      <div class="lbl dl-wk">Last 7 days</div>
      <!-- a real table with a header row, like the app's other tables (Rep maxes, Next time), so each column says
           what it is; a unit sits in the header so the cells stay short and every column fits at phone width -->
      <table class="sets dl-tbl">
        <thead><tr><th>Day</th><th v-for="k in KINDS" :key="k.id">{{ k.name }}<span v-if="k.unit && k.id !== 'mood' && k.id !== 'sleep_h'" class="dl-u">{{ ` (${k.unit})` }}</span></th></tr></thead>
        <tbody><tr v-for="w in week" :key="w.d"><td class="dl-d">{{ fmt.date(w.d + "T12:00", { weekday: "short", day: "numeric" }) }}</td>
          <td v-for="(k, i) in KINDS" :key="k.id" :class="{ muted: w.v[i] == null || w.b[i] }">{{ show(k.id, w.v[i]!) }}</td></tr></tbody>
      </table>
      <div v-if="anyBand" class="tiny muted dl-leg">Grey numbers are from {{ greyFrom }}.</div>
    </template>
  </div>
</template>

<style scoped>
.dl-goal { display: flex; align-items: center; gap: var(--cpx); margin-top: var(--hg); }
.dl-bar { flex: 1; height: 6px; border-radius: 3px; background: var(--s2); overflow: hidden; }
.dl-bar i { display: block; height: 100%; background: var(--acc); border-radius: inherit; }
.dl-wk { margin-top: var(--spg); }
/* hours and minutes side by side, the units in the label ("Sleep (hours and minutes)") as in the other rows, so the minutes box
   ends on the same right edge as every other box */
.dl-hm { display: flex; align-items: center; gap: var(--tdy); flex: none; }
/* wide enough for two digits ("30") inside the input's 14px side padding and border */
.li .dl-hm input.num-in { width: calc(2ch + 32px); }
/* the name uppercase as in the other tables, the unit beside it small and as written ("WATER (ml)") */
.dl-tbl { margin-top: var(--tdy); }
.dl-tbl th { white-space: nowrap; }
.dl-u { text-transform: none; letter-spacing: 0; font-weight: 500; }
.dl-tbl .dl-d { white-space: nowrap; }
.dl-tbl td { white-space: nowrap; }
.dl-leg { margin-top: var(--tdy); }
/* "Typed in · Use synced value": the dot its own element, spaced by the gap, so it never ends a line */
.dl-src { display: flex; align-items: baseline; column-gap: .25em; }
</style>
