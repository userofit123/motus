<script setup lang="ts">
// Stats (requirement 16): progress over time overall, per routine, per exercise, per muscle group, for activities and the body.
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { GROUPS, muscleName, weekStartOf, WEEKLY_SET_RANGE } from "@motus/shared";
import { useStats, useSettings, useAchievements } from "../api/queries";
import { useFmt, localYmd } from "../core/format";
import { bodySheet } from "../core/ui";
import Icon from "../components/Icon.vue";
import LineChart from "../components/LineChart.vue";
import BarChart from "../components/BarChart.vue";
import BodyMap from "../components/BodyMap.vue";
import Sparkline from "../components/Sparkline.vue";
import Reports from "../components/Reports.vue";

const route = useRoute(), router = useRouter();
const s = useSettings();
const fmt = useFmt();
const tab = ref(String(route.query.tab ?? "overview"));
watch(tab, (t) => router.replace({ query: t === "overview" ? {} : { tab: t } }));
const RANGES: [string, string, number][] = [["4w", "4 weeks", 28], ["3m", "3 months", 91], ["6m", "6 months", 182], ["1y", "1 year", 365], ["all", "All time", 0]];
const rk = ref("3m");
const days = computed(() => RANGES.find((r) => r[0] === rk.value)![2]);
const range = computed(() => (days.value ? { from: new Date(Date.now() - days.value * 86400000).toISOString() } : {}));
const prevRange = computed(() => (days.value ? { from: new Date(Date.now() - 2 * days.value * 86400000).toISOString(), to: new Date(Date.now() - days.value * 86400000).toISOString() } : { from: "2999-01-01" }));
const st = useStats(range);
const prev = useStats(prevRange);
const ach = useAchievements();
const d = computed<any>(() => st.data.value);
const p = computed<any>(() => prev.data.value);
const TABS = computed(() => [["overview", "Overview"], ["routines", "Routines"], ["exercises", "Exercises"], ["muscles", "Muscles"], ["activities", "Activities"], ["body", "Body"], ...(s.value.features.reports ? [["reports", "Reports"]] : []), ...(s.value.features.achievements ? [["achievements", "Achievements"]] : [])]);

const totals = (x: any) => x ? {
  workouts: x.workouts.length, timeS: x.workouts.reduce((a: number, w: any) => a + w.durationS, 0) + x.activities.reduce((a: number, w: any) => a + w.durationS, 0),
  volumeKg: x.workouts.reduce((a: number, w: any) => a + w.volumeKg, 0), sets: x.workouts.reduce((a: number, w: any) => a + w.sets, 0),
  activities: x.activities.length, distM: x.activities.reduce((a: number, w: any) => a + Number(w.distanceM ?? 0), 0),
  days: new Set([...x.workouts, ...x.activities].map((w: any) => localYmd(new Date(w.startedAt)))).size,
} : null;
const T = computed(() => totals(d.value)), P = computed(() => totals(p.value));
const change = (k: string) => { const a = (T.value as any)?.[k], b = (P.value as any)?.[k]; if (!b || a == null) return ""; const pc = Math.round(((a - b) / b) * 100); return `${pc >= 0 ? "+" : ""}${pc}% vs previous`; };
// weeks in range
const weeks = computed(() => {
  if (!d.value) return [];
  const m = new Map<string, any>();
  const n = days.value ? Math.ceil(days.value / 7) : Math.max(8, Math.ceil((Date.now() - new Date(d.value.workouts[0]?.startedAt ?? Date.now()).getTime()) / 604800000) + 1);
  for (let i = Math.min(n, 104) - 1; i >= 0; i--) m.set(weekStartOf(new Date(Date.now() - i * 604800000), s.value.firstDay), { workouts: 0, sets: 0, volumeKg: 0, muscles: {} as Record<string, number>, timeS: 0 });
  for (const w of d.value.workouts) { const k = weekStartOf(new Date(w.startedAt), s.value.firstDay); const x = m.get(k); if (!x) continue; x.workouts++; x.sets += w.sets; x.volumeKg += w.volumeKg; x.timeS += w.durationS; for (const [mm, v] of Object.entries(w.muscles as Record<string, number>)) x.muscles[mm] = (x.muscles[mm] ?? 0) + v; }
  for (const a of d.value.activities) { const x = m.get(weekStartOf(new Date(a.startedAt), s.value.firstDay)); if (x) x.timeS += a.durationS; }
  return [...m].map(([k, v]) => ({ week: k, ...v }));
});
const wlabel = (k: string) => fmt.value.date(k, { day: "numeric", month: "short" });
// consistency: one square per day for the last 26 weeks
const heat = computed(() => {
  const on = new Map<string, number>();
  for (const w of [...(d.value?.workouts ?? []), ...(d.value?.activities ?? [])]) { const k = localYmd(new Date(w.startedAt)); on.set(k, (on.get(k) ?? 0) + 1); }
  const start = new Date(); start.setDate(start.getDate() - 7 * 25 - ((start.getDay() - s.value.firstDay + 7) % 7));
  return Array.from({ length: 26 * 7 }, (_, i) => { const x = new Date(start); x.setDate(start.getDate() + i); const k = localYmd(x); return { k, n: on.get(k) ?? 0, future: x > new Date() }; });
});
const dow = computed(() => { const c = [0, 0, 0, 0, 0, 0, 0]; for (const w of d.value?.workouts ?? []) c[new Date(w.startedAt).getDay()]!++; return Array.from({ length: 7 }, (_, i) => { const j = (i + s.value.firstDay) % 7; return { label: "SMTWTFS"[j]!, value: c[j]! }; }); });
const hours = computed(() => { const b = [0, 0, 0, 0, 0, 0]; for (const w of d.value?.workouts ?? []) b[Math.floor(new Date(w.startedAt).getHours() / 4)]!++; return ["0–4", "4–8", "8–12", "12–16", "16–20", "20–24"].map((l, i) => ({ label: l, value: b[i]! })); });
// exercises
const exq = ref(""), exSort = ref<"times" | "change" | "stalled">("times");
const exList = computed(() => (d.value?.exercises ?? []).filter((e: any) => e.times && e.name.toLowerCase().includes(exq.value.toLowerCase()))
  .sort((a: any, b: any) => exSort.value === "change" ? b.change - a.change : exSort.value === "stalled" ? Number(b.stalled) - Number(a.stalled) || b.times - a.times : b.times - a.times));
const skipped = computed(() => (d.value?.exercises ?? []).filter((e: any) => e.skipped).sort((a: any, b: any) => b.skipped - a.skipped).slice(0, 5));
// muscles
const groupWeek = computed(() => { const w = weeks.value.at(-1)?.muscles ?? {}; return GROUPS.filter((g) => g.id !== "neck").map((g) => ({ label: g.name, value: Math.round(g.muscles.reduce((a, m) => a + (w[m] ?? 0), 0) * 10) / 10 })); });
const groupAvg = computed(() => { const ws = weeks.value.filter((w) => w.workouts); return GROUPS.filter((g) => g.id !== "neck").map((g) => ({ label: g.name, value: ws.length ? Math.round((ws.reduce((a, w) => a + g.muscles.reduce((b, m) => b + (w.muscles[m] ?? 0), 0), 0) / ws.length) * 10) / 10 : 0 })); });
const balance = computed(() => {
  const m = d.value?.muscles ?? {}; const sum = (ks: string[]) => ks.reduce((a, k) => a + (m[k] ?? 0), 0);
  return { push: sum(["chest", "shoulders", "triceps"]), pull: sum(["lats", "middle back", "biceps", "traps"]), upper: sum(["chest", "shoulders", "triceps", "lats", "middle back", "biceps", "traps", "forearms"]), lower: sum(["quadriceps", "hamstrings", "glutes", "calves", "adductors", "abductors"]) };
});
const neglected = computed(() => GROUPS.filter((g) => g.id !== "neck" && g.muscles.every((m) => !(d.value?.muscles?.[m]))).map((g) => g.name));
// activities
const actTypes = computed(() => { const m = new Map<string, any>(); for (const a of d.value?.activities ?? []) { const x = m.get(a.type) ?? { type: a.type, n: 0, s: 0, m: 0 }; x.n++; x.s += a.durationS; x.m += Number(a.distanceM ?? 0); m.set(a.type, x); } return [...m.values()].sort((a, b) => b.n - a.n); });
const actWeeks = computed(() => weeks.value.map((w) => ({ label: wlabel(w.week), value: (d.value?.activities ?? []).filter((a: any) => weekStartOf(new Date(a.startedAt), s.value.firstDay) === w.week).reduce((t: number, a: any) => t + Number(a.distanceM ?? 0), 0) / (fmt.value.du === "km" ? 1000 : 1609.344) })));
const steps = computed(() => (d.value?.daily ?? []).filter((x: any) => x.kind === "steps").map((x: any) => ({ x: new Date(x.date).getTime(), y: Number(x.value) })));
// body
const bw = computed(() => (d.value?.body ?? []).filter((b: any) => b.kind === "weight").map((b: any) => ({ x: new Date(b.measuredAt).getTime(), y: Math.round(fmt.value.fromKg(Number(b.value)) * 10) / 10 })));
const bwTrend = computed(() => { let ema: number | null = null; return bw.value.map((p: any) => { ema = ema == null ? p.y : ema + 0.15 * (p.y - ema); return { x: p.x, y: Math.round(ema! * 10) / 10 }; }); });
const measures = computed(() => { const m = new Map<string, any[]>(); for (const b of d.value?.body ?? []) if (b.kind !== "weight" && b.kind !== "photo") m.set(b.kind, [...(m.get(b.kind) ?? []), { x: new Date(b.measuredAt).getTime(), y: Number(b.value) }]); return [...m]; });
</script>

<template>
  <div class="page wide">
    <div class="ph"><div><h1>Stats</h1></div>
      <div class="acts"><select v-model="rk" style="width:auto"><option v-for="[k, l] in RANGES" :key="k" :value="k">{{ l }}</option></select></div></div>
    <div class="tabs"><button v-for="[k, l] in TABS" :key="k" :class="{ on: tab === k }" @click="tab = k!">{{ l }}</button></div>
    <div v-if="!d" class="empty">Loading…</div>

    <template v-else-if="tab === 'overview'">
      <div class="grid g4">
        <div class="card hero stat"><div class="lbl"><span class="bi"><Icon name="dumbbell" :size="15" /></span>Workouts</div><div class="val">{{ T!.workouts }}</div><div class="sub">{{ change("workouts") || `${T!.days} active days` }}</div><Sparkline :values="weeks.map((w) => w.workouts)" color="var(--onc)" /></div>
        <div class="card stat"><div class="lbl"><span class="bi"><Icon name="clock" :size="15" /></span>Time</div><div class="val">{{ Math.round(T!.timeS / 3600) }}<small>h</small></div><div class="sub">{{ change("timeS") || "workouts and activities" }}</div><Sparkline :values="weeks.map((w) => w.timeS)" /></div>
        <div class="card stat"><div class="lbl"><span class="bi"><Icon name="layers" :size="15" /></span>Volume</div><div class="val">{{ fmt.vol(T!.volumeKg) }}</div><div class="sub">{{ change("volumeKg") || `${T!.sets} sets` }}</div><Sparkline :values="weeks.map((w) => w.volumeKg)" /></div>
        <div class="card stat"><div class="lbl"><span class="bi"><Icon name="walk" :size="15" /></span>Activities</div><div class="val">{{ T!.activities }}</div><div class="sub">{{ fmt.dist(T!.distM, 1) }}</div></div>
      </div>
      <div class="grid g2" style="margin-top:var(--spg)">
        <div class="card"><div class="lbl" style="margin-bottom:8px">Workouts per week · goal {{ s.weeklyGoal }}</div><BarChart :bars="weeks.slice(-16).map((w) => ({ label: wlabel(w.week).split(' ')[0]!, value: w.workouts, dim: w.workouts < s.weeklyGoal }))" :goal="s.weeklyGoal" :height="170" /></div>
        <div class="card"><div class="lbl" style="margin-bottom:8px">Consistency · last 6 months</div>
          <div class="heat"><i v-for="c in heat" :key="c.k" :title="`${c.k}: ${c.n}`" :style="c.future ? { opacity: 0 } : c.n ? { background: `color-mix(in srgb, var(--acc) ${Math.min(100, 45 + c.n * 30)}%, var(--s2))` } : undefined" /></div>
          <div class="grid g2" style="margin-top:14px;gap:12px"><div><div class="tiny" style="margin-bottom:4px">By weekday</div><BarChart :bars="dow" :height="90" /></div><div><div class="tiny" style="margin-bottom:4px">By time of day</div><BarChart :bars="hours" :height="90" /></div></div>
        </div>
      </div>
      <div class="card" style="margin-top:var(--spg)"><div class="lbl" style="margin-bottom:8px">Average workout length (min)</div><LineChart :points="d.workouts.map((w: any) => ({ x: new Date(w.startedAt).getTime(), y: Math.round(w.durationS / 60), id: w.id, label: w.name }))" :height="160" @pick="(id) => router.push(`/workouts/${id}`)" /></div>
    </template>

    <template v-else-if="tab === 'routines'">
      <div v-if="!d.routines.length" class="card empty"><b>No routine workouts in this period</b></div>
      <div class="grid g2">
        <div v-for="r in d.routines" :key="r.routineId" class="card click" @click="router.push(`/routines/${r.routineId}`)">
          <div class="row"><span class="dot" :style="r.color ? { background: r.color } : undefined" /><b class="grow">{{ r.name }}</b><span class="tiny">{{ r.times }}×</span></div>
          <div class="grid g3 keep" style="margin:10px 0;gap:8px">
            <div><div class="lbl">Average</div><div style="font-weight:600">{{ fmt.dur(r.avgDurationS, true) }}</div></div>
            <div><div class="lbl">Planned</div><div style="font-weight:600">{{ r.estimateS ? fmt.dur(r.estimateS, true) : "—" }}</div></div>
            <div><div class="lbl">Skipped</div><div style="font-weight:600">{{ Math.round(r.skipRate * 100) }}%</div></div>
          </div>
          <LineChart :points="r.trend.map((t: any) => ({ x: new Date(t.at).getTime(), y: fmt.fromKg(t.volumeKg) }))" :height="110" :fmt="(v) => fmt.num(v / 1000, 1) + 'k'" />
        </div>
      </div>
    </template>

    <template v-else-if="tab === 'exercises'">
      <div class="row wrap" style="margin-bottom:12px"><div class="search" style="flex:1 1 220px;max-width:360px"><Icon name="search" :size="18" /><input v-model="exq" placeholder="Find an exercise" /></div>
        <div class="seg"><button :class="{ on: exSort === 'times' }" @click="exSort = 'times'">Most done</button><button :class="{ on: exSort === 'change' }" @click="exSort = 'change'">Most improved</button><button :class="{ on: exSort === 'stalled' }" @click="exSort = 'stalled'">Stalled</button></div></div>
      <div class="card"><div class="list">
        <div v-for="e in exList" :key="e.exerciseId" class="li click" @click="router.push(`/exercises/${e.exerciseId}?tab=charts`)">
          <div class="grow"><div class="t">{{ e.name }} <span v-if="e.stalled" class="mchip" title="No progress in the last 4 sessions">stalled</span></div><div class="s">{{ e.times }}× · last {{ fmt.date(e.lastAt) }}{{ e.bestE1rm ? ` · best 1RM ${fmt.wu_(e.bestE1rm)}` : "" }}</div></div>
          <div class="exspark"><Sparkline :values="e.trend.map((t: any) => t.e1rm || t.reps)" style="width:100%;height:100%" /></div>
          <div class="r tiny" style="width:56px" :class="e.change > 0.005 ? 'pos' : e.change < -0.005 ? 'neg' : ''">{{ e.change ? `${e.change > 0 ? "+" : ""}${Math.round(e.change * 100)}%` : "" }}</div>
        </div>
      </div></div>
      <template v-if="skipped.length"><div class="sh"><h2>Most skipped</h2></div><div class="card"><div v-for="e in skipped" :key="e.exerciseId" class="row tiny" style="padding:4px 0"><span class="grow" style="color:var(--tx)">{{ e.name }}</span>skipped {{ e.skipped }}×</div></div></template>
    </template>

    <template v-else-if="tab === 'muscles'">
      <div class="grid g2">
        <div class="card"><div class="lbl" style="margin-bottom:8px">Sets per muscle in this period</div><BodyMap :values="d.muscles" :height="240" legend />
          <div class="grid g2 keep" style="margin-top:12px;gap:6px 28px"><div v-for="[m, n] in Object.entries(d.muscles).sort((a: any, b: any) => b[1] - a[1])" :key="m" class="row tiny"><span class="grow" style="color:var(--tx)">{{ muscleName(m) }}</span>{{ Math.round(Number(n)) }}</div></div></div>
        <div class="col" style="gap:var(--spg)">
          <div class="card"><div class="lbl" style="margin-bottom:10px">Working sets this week · target {{ WEEKLY_SET_RANGE[0] }}–{{ WEEKLY_SET_RANGE[1] }} per group</div><BarChart :bars="groupWeek" horizontal :band="WEEKLY_SET_RANGE" /></div>
          <div class="card"><div class="lbl" style="margin-bottom:10px">Average per training week</div><BarChart :bars="groupAvg" horizontal /></div>
          <div class="card"><div class="lbl" style="margin-bottom:8px">Balance</div>
            <div class="row tiny" style="margin-bottom:6px"><span style="width:60px">Push</span><div class="pbar grow"><i :style="{ width: (balance.push / Math.max(1, balance.push + balance.pull)) * 100 + '%' }" /></div><span style="width:60px;text-align:end">Pull</span></div>
            <div class="row tiny"><span style="width:60px">Upper</span><div class="pbar grow"><i :style="{ width: (balance.upper / Math.max(1, balance.upper + balance.lower)) * 100 + '%' }" /></div><span style="width:60px;text-align:end">Lower</span></div>
            <div v-if="neglected.length" class="tiny" style="margin-top:10px">Not trained in this period: {{ neglected.join(", ") }}</div></div>
        </div>
      </div>
    </template>

    <template v-else-if="tab === 'activities'">
      <div v-if="!d.activities.length && !steps.length" class="card empty"><Icon name="walk" :size="34" /><b>No activities in this period</b></div>
      <div class="grid g3"><div v-for="t in actTypes" :key="t.type" class="card stat"><div class="lbl" style="text-transform:capitalize">{{ t.type }}</div><div class="val">{{ t.m ? fmt.dist(t.m, 1) : fmt.dur(t.s, true) }}</div><div class="sub">{{ t.n }} sessions · {{ fmt.dur(t.s, true) }}{{ t.m && t.s ? " · " + fmt.pace(t.s, t.m) : "" }}</div></div></div>
      <div v-if="d.activities.length" class="card" style="margin-top:var(--spg)"><div class="lbl" style="margin-bottom:8px">Distance per week ({{ fmt.du }})</div><BarChart :bars="actWeeks.slice(-16).map((w) => ({ ...w, label: w.label.split(' ')[0]! }))" :height="160" :fmt="(v) => fmt.num(v, 1)" /></div>
      <div v-if="steps.length" class="card" style="margin-top:var(--spg)"><div class="lbl" style="margin-bottom:8px">Daily steps · goal {{ s.stepGoal.toLocaleString() }}</div><LineChart :points="steps" :height="160" :fmt="(v) => fmt.num(v, 0)" /></div>
    </template>

    <template v-else-if="tab === 'body'">
      <div class="row" style="margin-bottom:12px"><div class="grow" /><button class="btn tonal s" @click="bodySheet = true"><Icon name="plus" :size="16" />Log</button><button class="qb" @click="router.push('/body')">All entries</button></div>
      <div class="card"><div class="lbl" style="margin-bottom:8px">Body weight ({{ fmt.wu }}) · smoothed trend</div>
        <div v-if="!bw.length" class="empty" style="padding:24px"><b>No body weight yet</b></div>
        <LineChart v-else :points="bwTrend" :height="220" :fmt="(v) => fmt.num(v, 1)" />
        <div v-if="bw.length" class="tiny" style="margin-top:6px">Latest {{ bw.at(-1)!.y }} {{ fmt.wu }} · trend {{ bwTrend.at(-1)!.y }} {{ fmt.wu }}{{ bwTrend.length > 7 ? ` · ${bwTrend.at(-1)!.y - bwTrend.at(-8)!.y >= 0 ? "+" : ""}${fmt.num(bwTrend.at(-1)!.y - bwTrend.at(-8)!.y, 1)} over the last 7 entries` : "" }}</div></div>
      <div v-if="s.features.measurements" class="grid g2" style="margin-top:var(--spg)"><div v-for="[k, pts] in measures" :key="k" class="card"><div class="lbl" style="margin-bottom:8px;text-transform:capitalize">{{ k.replace("_", " ") }}</div><LineChart :points="pts" :height="140" /></div></div>
    </template>

    <Reports v-else-if="tab === 'reports'" />

    <template v-else-if="tab === 'achievements'">
      <div class="grid g4"><div v-for="a in ach.data.value ?? []" :key="a.id" class="card tight" :style="!a.reached ? { opacity: .55 } : undefined"><Icon name="trophy" :style="{ color: a.reached ? '#e9b52f' : 'var(--tx2)' }" /><div style="font-weight:600;margin-top:6px">{{ a.name }}</div><div class="pbar" style="margin-top:8px;height:5px"><i :style="{ width: a.progress * 100 + '%' }" /></div></div></div>
    </template>
  </div>
</template>
