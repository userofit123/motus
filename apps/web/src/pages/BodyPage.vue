<script setup lang="ts">
// Body: the one home for everything about your body. Tabs (shown only when there is more than one):
//  · Weight: latest weight, smoothed trend and the weight entries.
//  · Measurements (Body measurements feature): the latest of each tape measure and body fat with the change since the one before;
//    tap one for its chart and entries.
//  · Photos (Progress photos feature).
//  · About you (always there, last): year of birth, sex and height, edited in place (components/BodyProfile.vue). Nothing to
//    log there, so the Log button is hidden (one primary button per screen, and it would have no meaning).
// Logging: the Log button here, or + → Body weight / Measurements. Stats → Body charts the same numbers
// over a chosen period and links back here. Steps, sleep, water and mood are not body measurements: they are the daily log
// (+ → Steps / Daily log, Home's Today card, Stats → Activities).
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useBody, useSettings, loaded } from "../api/queries";
import { api } from "../api/client";
import { confirm } from "../core/ask";
import { invalidate } from "../api/live";
import { useFmt, ago } from "../core/format";
import { bodySheet } from "../core/ui";
import { toast } from "../core/toast";
import { BODY_MEASURES, bodyName, bodyUnit, fromCm } from "@motus/shared";
import Icon from "../components/Icon.vue";
import LineChart from "../components/LineChart.vue";
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
const signed = (d: number, k: string) => `${d > 0 ? "+" : d < 0 ? "−" : "±"}${fmt.value.num(Math.abs(d), 1)} ${unit(k)}`;

// weight
const weights = computed(() => all.value.filter((b) => b.kind === "weight"));
const trend = computed(() => { let e: number | null = null; return weights.value.slice().reverse().map((b) => { const y = fmt.value.fromKg(Number(b.value)); e = e == null ? y : e + 0.15 * (y - e); return { x: new Date(b.measuredAt).getTime(), y: Math.round(e! * 10) / 10 }; }); });
// how far the trend moved over the last 30 days (from the last point at least 30 days old, or the first one)
const month = computed(() => { const t = trend.value; if (t.length < 2) return null; const cut = Date.now() - 30 * 86400000; const from = [...t].reverse().find((p) => p.x <= cut) ?? t[0]!; return t.at(-1)!.y - from.y; });
const more = ref(false);

// measurements: newest first per kind, in the shared list's order
const order = (k: string) => { const i = BODY_MEASURES.findIndex((m) => m.id === k); return i < 0 ? 99 : i; };
const byKind = computed(() => { const m = new Map<string, any[]>(); for (const b of all.value) if (b.kind !== "weight") m.set(b.kind, [...(m.get(b.kind) ?? []), b]); return m; });
const latest = computed(() => [...byKind.value].sort((a, b) => order(a[0]) - order(b[0])).map(([k, l]) => ({ k, b: l[0], d: l[1] ? disp(k, Number(l[0].value)) - disp(k, Number(l[1].value)) : null, n: l.length })));
const picked = computed(() => (kind.value && byKind.value.has(kind.value) ? kind.value : ""));
const pts = computed(() => (byKind.value.get(picked.value) ?? []).slice().reverse().map((b) => ({ x: new Date(b.measuredAt).getTime(), y: Math.round(disp(picked.value, Number(b.value)) * 10) / 10 })));

const entries = computed(() => { const l = cur.value === "measurements" ? byKind.value.get(picked.value) ?? [] : weights.value; return more.value ? l : l.slice(0, 20); });
const total = computed(() => (cur.value === "measurements" ? byKind.value.get(picked.value)?.length ?? 0 : weights.value.length));
async function del(id: string) { if (!(await confirm("Delete this entry?", { ok: "Delete", danger: true }))) return; await api.del(`/body/${id}`); invalidate(["body", "stats", "goals", "home"]); toast("Entry deleted"); }
// show the page once its data is in, all at once
await loaded(body);
</script>

<template>
  <div class="page">
    <div class="ph"><div><h1>Body</h1><div class="sub">Weight{{ s.features.measurements ? ", measurements" : "" }}{{ s.features.photos ? ", photos" : "" }}, about you</div></div>
      <div class="acts"><button v-if="cur === 'weight' || cur === 'measurements'" class="btn keep" @click="log"><Icon name="plus" :size="18" />Log</button></div></div>
    <div class="tabs"><button v-for="[k, l] in TABS" :key="k" :class="{ on: cur === k }" @click="tab = k">{{ l }}</button></div>

    <template v-if="cur === 'weight'">
      <div class="grid g2">
        <div class="card stat"><div class="lbl">Latest</div><div class="val">{{ weights.length ? fmt.w(weights[0].value) : "-" }}<small>{{ fmt.wu }}</small></div><div class="sub">{{ weights.length ? ago(weights[0].measuredAt) : "Not logged yet" }}</div></div>
        <div class="card stat"><div class="lbl">Trend</div><div class="val">{{ trend.length ? fmt.num(trend.at(-1)!.y, 1) : "-" }}<small>{{ fmt.wu }}</small></div><div class="sub">{{ month != null ? `${signed(month, "weight")} over 30 days` : "Smoothed, so one day's water weight doesn't swing it" }}</div></div>
      </div>
      <div class="card spt"><div class="lbl hgap">Body weight ({{ fmt.wu }}) · smoothed trend</div>
        <div v-if="!trend.length" class="empty sm"><b>No body weight yet</b>Log it now and then, ideally at the same time of day.</div>
        <LineChart v-else :points="trend" :height="220" :fmt="(v) => fmt.num(v, 1)" /></div>
    </template>

    <template v-else-if="cur === 'measurements'">
      <div v-if="!latest.length" class="card empty"><Icon name="scale" :size="34" /><b>No measurements yet</b>Neck, chest, waist, arms, thighs and more, plus body fat. Log them all at once with a tape measure.<br /><button class="btn tonal" @click="bodySheet = 'tape'">Log measurements</button></div>
      <div v-else class="card flush"><div class="list">
        <div v-for="x in latest" :key="x.k" class="li click" :class="{ 'bp-on': picked === x.k }" @click="kind = picked === x.k ? '' : x.k">
          <div class="grow"><div class="t">{{ bodyName(x.k) }}</div><div class="s">{{ ago(x.b.measuredAt) }} · {{ x.n }} entr{{ x.n === 1 ? "y" : "ies" }}</div></div>
          <span v-if="x.d != null" class="tiny num">{{ signed(x.d, x.k) }}</span><b class="num">{{ val(x.b) }}</b><Icon :name="picked === x.k ? 'down' : 'right'" :size="16" class="muted" />
        </div></div></div>
      <div v-if="picked" class="card spt"><div class="lbl hgap">{{ bodyName(picked) }} ({{ unit(picked) }})</div><LineChart :points="pts" :height="180" :fmt="(v) => fmt.num(v, 1)" /></div>
      <p v-else-if="latest.length" class="tiny spt">Tap a measurement to see its chart and entries.</p>
    </template>

    <ProgressPhotos v-else-if="cur === 'photos'" />

    <BodyProfile v-else-if="cur === 'details'" />

    <template v-if="cur === 'weight' || picked">
      <div class="sh"><h2>Entries</h2></div>
      <div class="card"><div v-if="!entries.length" class="tiny">No entries yet.</div>
        <div class="list"><div v-for="b in entries" :key="b.id" class="li"><div class="grow"><div class="t">{{ fmt.date(b.measuredAt, { day: "numeric", month: "short", year: "numeric" }) }}</div></div><b class="num">{{ val(b) }}</b><button class="ib sm plain" aria-label="Delete" @click="del(b.id)"><Icon name="trash" :size="16" /></button></div></div>
        <div v-if="total > 20 && !more" class="center spt"><button class="qb" @click="more = true">Show all {{ total }}</button></div></div>
    </template>
  </div>
</template>

<style scoped>
.bp-on { background: color-mix(in srgb, var(--acc) 8%, transparent); }
</style>
