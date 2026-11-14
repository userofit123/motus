<script setup lang="ts">
// Body: the one home for everything about your body: the numbers, how they changed and every entry. Tabs (shown only
// when there is more than one):
//  · Weight: the smoothed trend, its change over the chosen period against the period before, the weigh-ins, the trend
//    chart and the weight entries.
//  · Measurements (Body measurements feature): the latest of each tape measure and body fat with the change since the one
//    before and a sparkline of its recent entries; tap one for its chart over the period and its entries.
//  · Photos (Progress photos feature).
//  · About you (always there, last): year of birth, sex and height, edited in place (components/BodyProfile.vue). Nothing to
//    log or chart there, so the Log button and the period are hidden (one primary button per screen, and it would have
//    no meaning).
// Body is one thing, like a single exercise, so its charts live on its own page (as an exercise's live on its page), not
// in a Stats tab: Stats compares many things (routines, exercises, muscles, activity types) and covers the data that has
// no page of its own (sleep, heart). There used to be a Stats → Body tab too; it showed the same trend and charts, so it
// was folded in here and old links to it land here. Logging: the Log button here, or + → Body weight / Measurements.
// Steps, sleep, water and mood are not body measurements: they are the daily log (+ → Steps / Daily log, Home's Today
// card, Stats → Activities).
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useBody, useSettings, loaded } from "../api/queries";
import { api } from "../api/client";
import { confirm } from "../core/ask";
import { invalidate } from "../api/live";
import { useFmt, ago } from "../core/format";
import { bodySheet } from "../core/ui";
import { weightTrend, changeOver, signed } from "../core/body";
import AppSelect from "../components/AppSelect.vue";
import LineChart from "../components/LineChart.vue";
import { toast } from "../core/toast";
import { BODY_MEASURES, bodyName, bodyUnit, fromCm, statsPeriod, STATS_PERIODS, percentChange, type StatsPeriod } from "@motus/shared";
import Icon from "../components/Icon.vue";
import Sparkline from "../components/Sparkline.vue";
import DotLine from "../components/DotLine.vue";
import ProgressPhotos from "../components/ProgressPhotos.vue";
import BodyProfile from "../components/BodyProfile.vue";

const route = useRoute(), router = useRouter();
const body = useBody();
const s = useSettings();
const fmt = useFmt();
const TABS = computed(() => [["weight", "Weight"], ...(s.value.features.measurements ? [["measurements", "Measurements"]] : []), ...(s.value.features.photos ? [["photos", "Photos"]] : []), ["details", "About you"]] as [string, string][]);
const tab = ref(String(route.query.tab ?? "weight"));
// a tab whose feature was switched off falls back to weight
const cur = computed(() => (TABS.value.some(([k]) => k === tab.value) ? tab.value : "weight"));
const kind = ref(route.query.kind ? String(route.query.kind) : "");
watch([tab, kind], ([t, k]) => router.replace({ query: { ...(t !== "weight" ? { tab: t } : {}), ...(t === "measurements" && k ? { kind: k } : {}) } }));
onMounted(() => { if (route.query.add) bodySheet.value = String(route.query.add) === "1" ? true : String(route.query.add); });
const log = () => (bodySheet.value = cur.value === "measurements" ? kind.value || "tape" : true);

const all = computed(() => (body.data.value ?? []).filter((b: any) => b.kind !== "photo") as any[]);
// shown in the person's units: weight in kg/lb, tape in cm/in, body fat in %
const disp = (k: string, v: number) => { const u = bodyUnit(k); return u === "kg" ? fmt.value.fromKg(v) : u === "%" ? v : fromCm(v, fmt.value.lu); };
const unit = (k: string) => { const u = bodyUnit(k); return u === "kg" ? fmt.value.wu : u === "%" ? "%" : fmt.value.lu; };
const val = (b: any) => `${fmt.value.num(disp(b.kind, Number(b.value)), 1)} ${unit(b.kind)}`;
const signedIn = (d: number, k: string) => signed(d, unit(k));

// the period the trend, its change and the charts cover, picked as on Stats (same choices, same default) and compared
// with the one before it
const PERIODS = [...STATS_PERIODS];
const rk = ref<StatsPeriod>("3m");
const per = computed(() => statsPeriod(rk.value, new Date(), s.value.firstDay));
const within = (t: number, a?: Date | null, b?: Date | null) => (!a || t >= a.getTime()) && (!b || t < b.getTime());

// weight
const weights = computed(() => all.value.filter((b) => b.kind === "weight"));
// smoothed over the whole history (core/body.ts) so it doesn't restart, and jump, at the start of a period; then cut
const allW = computed(() => weights.value.slice().reverse().map((b) => ({ x: new Date(b.measuredAt).getTime(), y: fmt.value.fromKg(Number(b.value)) })));
const trend = computed(() => weightTrend(allW.value));
const bw = computed(() => allW.value.filter((q) => within(q.x, per.value.from, per.value.to)));
const bwTrend = computed(() => trend.value.filter((q) => within(q.x, per.value.from, per.value.to)));
const pbw = computed(() => (per.value.prevFrom ? allW.value.filter((q) => within(q.x, per.value.prevFrom, per.value.prevTo)) : []));
// one rule for every change (core/body.ts): last value before the period → last value in it
const bwMoved = computed(() => changeOver(trend.value, per.value.from, per.value.to));
const pMoved = computed(() => (per.value.prevFrom ? changeOver(trend.value, per.value.prevFrom, per.value.prevTo) : null));
const more = ref(false);

// measurements: newest first per kind, in the shared list's order
const order = (k: string) => { const i = BODY_MEASURES.findIndex((m) => m.id === k); return i < 0 ? 99 : i; };
const byKind = computed(() => { const m = new Map<string, any[]>(); for (const b of all.value) if (b.kind !== "weight") m.set(b.kind, [...(m.get(b.kind) ?? []), b]); return m; });
const latest = computed(() => [...byKind.value].sort((a, b) => order(a[0]) - order(b[0])).map(([k, l]) => ({ k, b: l[0], d: l[1] ? disp(k, Number(l[0].value)) - disp(k, Number(l[1].value)) : null, n: l.length })));
const picked = computed(() => (kind.value && byKind.value.has(kind.value) ? kind.value : ""));
// the row's sparkline: up to the last 10 entries, oldest first
const spark = (k: string) => (byKind.value.get(k) ?? []).slice(0, 10).reverse().map((b) => disp(k, Number(b.value)));
// the picked measurement's chart over the period, and how much it changed over it
const mPts = computed(() => (byKind.value.get(picked.value) ?? []).slice().reverse().map((b) => ({ x: new Date(b.measuredAt).getTime(), y: Math.round(disp(picked.value, Number(b.value)) * 10) / 10 })));
const mIn = computed(() => mPts.value.filter((q) => within(q.x, per.value.from, per.value.to)));
const mMoved = computed(() => changeOver(mPts.value, per.value.from, per.value.to));

const entries = computed(() => { const l = cur.value === "measurements" ? byKind.value.get(picked.value) ?? [] : weights.value; return more.value ? l : l.slice(0, 20); });
const total = computed(() => (cur.value === "measurements" ? byKind.value.get(picked.value)?.length ?? 0 : weights.value.length));
async function del(id: string) { if (!(await confirm("Delete this entry?", { ok: "Delete", danger: true }))) return; await api.del(`/body/${id}`); invalidate(["body", "stats", "goals", "home"]); toast("Entry deleted"); }
// show the page once its data is in, all at once
await loaded(body);
</script>

<template>
  <div class="page">
    <!-- no subtitle: it only repeated the tabs below, and the period and Log need the room on a phone (as on Stats). The
         period shows only where it changes something (weight with entries, or a measurement picked for its chart); hidden,
         not removed, elsewhere, as it is a little taller than Log and the tabs would jump when tapping a measurement -->
    <div class="ph"><div><h1>Body</h1></div>
      <!-- kept on every tab (hidden where it does nothing) so the header and the tabs under it never jump -->
      <div class="acts" :style="{ visibility: cur === 'weight' || cur === 'measurements' ? undefined : 'hidden' }"><AppSelect v-model="rk" :options="PERIODS" title="Period" :style="{ width: 'auto', visibility: (cur === 'weight' ? weights.length : picked) ? undefined : 'hidden' }" /><button class="btn keep" @click="log"><Icon name="plus" :size="18" />Log</button></div></div>
    <div class="tabs"><button v-for="[k, l] in TABS" :key="k" :class="{ on: cur === k }" @click="tab = k">{{ l }}</button></div>

    <template v-if="cur === 'weight' && weights.length">
      <!-- how it changed over the period: the trend and its change are only claimed from enough weigh-ins (core/body.ts) -->
      <div v-if="bw.length" class="grid g4 n3">
        <div class="card hero stat"><div class="lbl"><span class="bi"><Icon name="stats" :size="15" /></span>Trend</div><div class="val">{{ fmt.num(bwTrend.at(-1)!.y, 1) }}<small>{{ fmt.wu }}</small></div><DotLine class="sub" :parts="[`Latest ${fmt.num(bw.at(-1)!.y, 1)} ${fmt.wu}`, ago(new Date(bw.at(-1)!.x).toISOString())]" /><Sparkline :values="bwTrend.map((t) => t.y)" color="var(--onc)" /></div>
        <div class="card stat"><div class="lbl"><span class="bi"><Icon :name="bwMoved == null || bwMoved === 0 ? 'swap' : bwMoved > 0 ? 'arrowUp' : 'arrowDown'" :size="15" /></span>Change</div><div class="val">{{ bwMoved != null ? signed(bwMoved) : "-" }}<small>{{ bwMoved != null ? fmt.wu : "" }}</small></div><div class="sub">{{ pMoved != null ? `${signed(pMoved, fmt.wu)} vs previous` : "Nothing to compare with" }}</div></div>
        <div class="card stat"><div class="lbl"><span class="bi"><Icon name="calendar" :size="15" /></span>Weigh-ins</div><div class="val">{{ bw.length }}</div><div class="sub">{{ percentChange(bw.length, pbw.length) ? `${percentChange(bw.length, pbw.length)} vs previous` : "in this period" }}</div></div>
      </div>
      <div class="card" :class="{ spt: bw.length }"><div class="lbl hgap">Body weight ({{ fmt.wu }}) · smoothed trend</div>
        <div v-if="!bw.length" class="empty sm"><b>No body weight in this period</b>Pick a longer period.</div>
        <LineChart v-else :points="bwTrend" :height="220" :fmt="(v) => fmt.num(v, 1)" /></div>
    </template>
    <!-- nothing logged yet: one empty card, as on Measurements, not an Entries heading over an empty box -->
    <div v-else-if="cur === 'weight'" class="card empty"><Icon name="scale" :size="34" /><b>No body weight yet</b>Log it now and then, ideally at the same time of day, and its trend shows here.<br /><button class="btn tonal" @click="bodySheet = true">Log body weight</button></div>

    <template v-else-if="cur === 'measurements'">
      <div v-if="!latest.length" class="card empty"><Icon name="scale" :size="34" /><b>No measurements yet</b>Neck, chest, waist, arms, thighs and more, plus body fat. Log them all at once with a tape measure.<br /><button class="btn tonal" @click="bodySheet = 'tape'">Log measurements</button></div>
      <div v-else class="card flush"><div class="list">
        <div v-for="x in latest" :key="x.k" class="li click" :class="{ 'bp-on': picked === x.k }" @click="kind = picked === x.k ? '' : x.k">
          <div class="grow bp-l"><div class="t">{{ bodyName(x.k) }}</div><DotLine class="s" :parts="[ago(x.b.measuredAt), `${x.n} entr${x.n === 1 ? 'y' : 'ies'}`]" /></div>
          <div class="exspark"><Sparkline :values="spark(x.k)" style="width:100%;height:100%" /></div><div class="bp-v"><b class="num bp-nw">{{ val(x.b) }}</b><div v-if="x.d != null" class="tiny bp-nw" title="Since the entry before"><span class="num">{{ signedIn(x.d, x.k) }}</span> since last</div></div><Icon :name="picked === x.k ? 'down' : 'right'" :size="16" class="muted" />
        </div></div></div>
      <p v-if="!picked && latest.length" class="tiny spt">Tap a measurement to see its chart and entries.</p>
    </template>

    <ProgressPhotos v-else-if="cur === 'photos'" />

    <BodyProfile v-else-if="cur === 'details'" />

    <div v-if="cur === 'measurements' && picked" class="card spt"><div class="lbl hgap"><span class="grow">{{ bodyName(picked) }} ({{ unit(picked) }})</span><span v-if="mMoved != null" class="tiny"><span class="num">{{ signedIn(mMoved, picked) }}</span> in this period</span></div>
      <div v-if="!mIn.length" class="empty sm"><b>No {{ bodyName(picked).toLowerCase() }} in this period</b>Pick a longer period.</div>
      <LineChart v-else :points="mIn" :height="220" :fmt="(v) => fmt.num(v, 1)" /></div>

    <template v-if="(cur === 'weight' || picked) && entries.length">
      <div class="sh"><h2>Entries</h2></div>
      <div class="card">
        <div class="list"><div v-for="b in entries" :key="b.id" class="li"><div class="grow"><div class="t">{{ fmt.date(b.measuredAt, { day: "numeric", month: "short", year: "numeric" }) }}</div></div><b class="num">{{ val(b) }}</b><button class="ib sm plain" aria-label="Delete" @click="del(b.id)"><Icon name="trash" :size="16" /></button></div></div>
        <div v-if="total > 20 && !more" class="center spt"><button class="qb" @click="more = true">Show all {{ total }}</button></div></div>
    </template>
  </div>
</template>

<style scoped>
.bp-on { background: color-mix(in srgb, var(--acc) 8%, transparent); }
/* on a phone a number never splits from its unit, and the subtitle wraps only between its parts */
.bp-nw { white-space: nowrap; }
/* the value with its change under it, right-aligned in one column, so the row fits a phone and the sparklines line up */
.bp-v { text-align: right; min-width: 7.5em; flex: none; }
/* the label side gives way first, so a row is never wider than its card */
.bp-l { min-width: 0; }
.bp-l .s { overflow: hidden; }
</style>
