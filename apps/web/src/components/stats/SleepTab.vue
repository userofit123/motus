<script setup lang="ts">
// Stats → Sleep, there only once a band has handed over sleep: last night, the averages over the chosen period, what
// stands out (only what the nights say), time asleep each night (by stage when the band told them apart), when nights
// began and ended, and the heart rate, blood oxygen and breathing while asleep. A night opens in a sheet.
// Nights come from /health/sleep; a day with only its hours of sleep (an older import, a typed number) still counts in
// the time-asleep chart and average, from Stats' daily log. A record under MIN_NIGHT_H hours is a nap or partial record,
// not a night: it keeps its bar (in grey) and its row, but every average, count and usual time leaves it out.
import { computed, ref } from "vue";
import { ymd, weekStartOf, isNightMin, MIN_NIGHT_H } from "@motus/shared";
import { useSleep, useSettings, type SleepNight } from "../../api/queries";
import { useFmt, localYmd } from "../../core/format";
import { STAGES, NO_STAGES_COLOR, NO_STAGES_SWATCH, SHORT_COLOR, SHORT_WHY, hasStages, isFull, asleepMin, inBedMin, efficiency, nightMin, nightIso, mins, typical } from "../../core/sleep";
import Icon from "../Icon.vue";
import BarChart from "../BarChart.vue";
import LineChart from "../LineChart.vue";
import Sparkline from "../Sparkline.vue";
import StageBar from "./StageBar.vue";
import NightStats from "./NightStats.vue";
import SleepSchedule from "./SleepSchedule.vue";
import NightSheet from "./NightSheet.vue";

const props = defineProps<{ from: Date | null; to: Date | null; daily: { date: string; kind: string; value: number | string }[] }>();
const fmt = useFmt();
const s = useSettings();
// the API's days: from the period's first, up to (not including) the day after it
const range = computed(() => ({ ...(props.from ? { from: ymd(props.from) } : {}), ...(props.to ? { to: ymd(props.to) } : {}) }));
const q = useSleep(range);
// the last 30 days whatever the period, for last night and how it compares
const today = new Date();
const recentRange = { from: ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30)), to: ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)) };
const recentQ = useSleep(recentRange);
// both in before anything shows, so last night's card doesn't push the rest down when it arrives
const loading = computed(() => q.isLoading.value || recentQ.isLoading.value);

const nights = computed<SleepNight[]>(() => q.data.value?.nights ?? []);
const recent = computed<SleepNight[]>(() => recentQ.data.value?.nights ?? []);
// the nights that count as nights (not naps or partial records), for every average and usual time
const full = computed(() => nights.value.filter(isFull));
const staged = computed(() => nights.value.some(hasStages));
// every day in the period with hours of sleep: a night when there is one, else the day's hours
const days = computed(() => {
  const byDay = new Map(nights.value.map((n) => [n.date, n] as const));
  const lo = range.value.from ?? "", hi = range.value.to ?? "9999";
  const out = new Map<string, { date: string; min: number; night: SleepNight | null; full?: boolean }>();
  for (const x of props.daily) {
    const d = String(x.date).slice(0, 10);
    if (x.kind !== "sleep_h" || d < lo || d >= hi) continue;
    out.set(d, { date: d, min: Math.round(Number(x.value) * 60), night: byDay.get(d) ?? null });
  }
  for (const n of nights.value) out.set(n.date, { date: n.date, min: asleepMin(n), night: n });
  return [...out.values()].filter((x) => x.min > 0).map((x) => ({ ...x, full: isNightMin(x.min) })).sort((a, b) => a.date.localeCompare(b.date));
});
// the days that were nights, and how many short records the averages leave out
const nightDays = computed(() => days.value.filter((x) => x.full));
const shortCount = computed(() => days.value.length - nightDays.value.length);

// last night: the newest of the last 30 days, when the chosen period takes it in (an older period shows only its own);
// named "Last night" when it ended today
const last = computed(() => { const n = recent.value[0]; return n && (!range.value.from || n.date >= range.value.from) && (!range.value.to || n.date < range.value.to) ? n : null; });
const lastName = computed(() => !last.value ? "" : last.value.date === localYmd(new Date()) ? "Last night" : fmt.value.date(last.value.date, { weekday: "long", day: "numeric", month: "short" }));
// in running text a percent sits right after its number, to a tenth only when the band gave one
const pc = (v: number) => `${fmt.value.num(v, Number.isInteger(v) ? 0 : 1)}%`;

// averages over the period
const avg = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null);
const avgAsleep = computed(() => avg(nightDays.value.map((x) => x.min)));
const bed = computed(() => typical(full.value.map((n) => nightMin(n.startAt))));
// waking after noon still counts as the same night's morning
const wake = computed(() => typical(full.value.map((n) => { const a = nightMin(n.startAt), b = nightMin(n.endAt); return b < a ? b + 1440 : b; })));
const deepPct = computed(() => { const ns = full.value.filter((n) => n.deepMin != null && n.asleepMin); return ns.length ? Math.round((ns.reduce((t, n) => t + n.deepMin!, 0) / ns.reduce((t, n) => t + n.asleepMin, 0)) * 100) : null; });
const avgBed = computed(() => avg(full.value.map(inBedMin)));
const avgEff = computed(() => avg(full.value.map(efficiency)));
const clock = (m: number) => fmt.value.time(nightIso(m));
// where bedtimes (or wake times) usually fall: the middle half from 5 nights on, else the earliest to the latest; one
// night says nothing about a habit, so it only says so
type Typical = NonNullable<ReturnType<typeof typical>>;
const span = (t: Typical) => (t.lo === t.hi ? `at ${clock(t.at)}` : clock(t.lo) + "-" + clock(t.hi));
// a tile's line as its words and its times, the times kept whole so a narrow tile breaks before them, not inside them;
// with 2-4 nights only the earliest to the latest, since any word beside it no longer fits a phone's tile on one line
const spread = (t: Typical) => (t.n === 1 ? ["from 1 night", ""] : [t.n >= 5 ? "usually" : "", span(t)]);
const schedule = computed(() => bed.value && wake.value && bed.value.n > 1 ? `${bed.value.n >= 5 ? "Usual times shaded: to bed" : "To bed"} ${span(bed.value)} · up ${span(wake.value)}` : "");
// the tiles there are data for: time asleep always, then bedtime, wake time, and deep sleep or else time in bed
const tiles = computed(() => 1 + (bed.value ? 1 : 0) + (wake.value ? 1 : 0) + (deepPct.value != null || avgBed.value != null ? 1 : 0));

// nightly time asleep: a bar a night, stacked deep / light / REM when the band told them apart (a night it didn't, or a
// day with only its hours, in its own colour beside them, named in the legend); over two months of nights the bars would be hairlines, so it
// becomes the average night of each week (of its nights: a week of only short records has no bar). A short record keeps
// its bar, in grey and named in the legend, so it is seen but not read as a night
const BAND: [number, number] = [7, 9];
const perWeek = computed(() => days.value.length > 62);
const mixed = computed(() => staged.value && nightDays.value.some((x) => !x.night || !hasStages(x.night)));
const bars = computed(() => {
  const part = (n: SleepNight | null, min: number) => {
    if (!staged.value) return undefined;
    if (!n || !hasStages(n)) return [{ value: min / 60, color: NO_STAGES_COLOR, hatch: true }];
    // the stages scaled to the time asleep shown (the day's own number, when it was typed in)
    const sum = Math.max(1, (n.deepMin ?? 0) + (n.lightMin ?? 0) + (n.remMin ?? 0));
    return STAGES.filter((st) => st.key !== "awakeMin").map((st) => ({ value: ((n[st.key] ?? 0) / sum) * (min / 60), color: st.color }));
  };
  // the month under its first day, so "30 1 3" says where October ends; a night's tip gives its bedtime to getting up
  const month = (d: string) => fmt.value.date(d, { month: "short" });
  if (!perWeek.value) return days.value.map((x) => {
    const full = fmt.value.date(x.date, { day: "numeric", month: "short" }), n = x.night;
    const tip = fmt.value.date(x.date, { weekday: "short", day: "numeric", month: "short" }) + (n ? ` · ${fmt.value.time(n.startAt)}-${fmt.value.time(n.endAt)}` : "") + (x.full ? "" : " · short record");
    return { label: full.split(" ")[0]!, full, group: month(x.date), tip, value: x.min / 60, ...(x.full ? { parts: part(n, x.min) } : { color: SHORT_COLOR }), id: n ? x.date : undefined };
  });
  const wk = new Map<string, number[]>();
  for (const x of nightDays.value) { const k = weekStartOf(new Date(x.date + "T12:00"), s.value.firstDay); wk.set(k, [...(wk.get(k) ?? []), x.min]); }
  return [...wk].map(([k, ms]) => { const full = fmt.value.date(k, { day: "numeric", month: "short" }); return { label: full.split(" ")[0]!, full, group: month(k), tip: `week of ${full}`, value: avg(ms)! / 60 }; });
});
// without stages the nights' plain bars are named too, once a short record's grey sits beside them
const legend = computed(() => [...(staged.value ? STAGES.slice(0, 3).map((st) => ({ name: st.name, color: st.color as string })) : shortCount.value ? [{ name: "Night", color: "var(--acc)" }] : []),
  ...(mixed.value ? [{ name: "No stages", color: NO_STAGES_SWATCH }] : []), ...(shortCount.value ? [{ name: "Short record", color: SHORT_COLOR }] : [])]);

const hours = (v: number) => mins(v * 60);

// heart rate, blood oxygen and breathing while asleep, a night at a time, each only when the band read it
const TRENDS = [
  { id: "hr", name: "Heart rate while asleep", unit: "bpm", v: (n: SleepNight) => n.avgHr, lo: (n: SleepNight) => n.minHr },
  { id: "spo2", name: "Blood oxygen while asleep", unit: "%", v: (n: SleepNight) => n.avgSpo2, lo: (n: SleepNight) => n.minSpo2 },
  { id: "resp", name: "Breathing rate while asleep", unit: "breaths/min", v: (n: SleepNight) => n.respRate, lo: () => null },
] as const;
const trends = computed(() => TRENDS.map((t) => {
  const ns = full.value.filter((n) => t.v(n) != null);
  // a point's tip names its night as the other charts' tips do ("Sat 7 Nov")
  const pts = ns.map((n) => ({ x: new Date(n.date + "T12:00").getTime(), y: Number(t.v(n)), id: n.date, label: fmt.value.date(n.date, { weekday: "short", day: "numeric", month: "short" }) }));
  const u = (n: number) => t.unit === "%" ? pc(Math.round(n * 10) / 10) : `${fmt.value.num(n, 0)} ${t.unit}`;
  const lows = ns.map((n) => t.lo(n)).filter((x): x is number => x != null);
  const mean = avg(pts.map((p) => p.y));
  return { ...t, pts, f: (v: number) => fmt.value.num(v, 0), line: pts.length ? [`Latest ${u(pts.at(-1)!.y)}`, `average ${u(mean!)}`, lows.length ? `lowest ${u(Math.min(...lows))}` : ""].filter(Boolean).join(" · ") : "" };
}).filter((t) => t.pts.length > 1));

// what stands out, as a report's highlights (what on the left, its number on the right), each only when the nights are
// there to say it
type Insight = { icon: string; t: string; s?: string; rv?: string; tone?: "pos" | "neg" };
const signed = (m: number) => `${m < 0 ? "-" : "+"}${mins(Math.abs(m))}`;
const insights = computed(() => {
  const out: Insight[] = [];
  const l = last.value, r = recent.value;
  // said of last night only: an older night (the newest in a while) has its own card and sheet; a short record isn't a
  // night to compare (its card says so), and the 30-day usual is of nights only
  const rf = r.filter(isFull);
  if (l && lastName.value === "Last night" && isFull(l)) {
    const before = rf.filter((n) => n.date !== l.date);
    if (before.length >= 5) {
      const usual = avg(before.map(asleepMin))!, diff = asleepMin(l) - usual;
      out.push(Math.abs(diff) < 10 ? { icon: "moon", t: "As long as your 30-day average", s: `${mins(usual)} a night`, rv: mins(asleepMin(l)) }
        : { icon: "moon", t: `${diff < 0 ? "Shorter" : "Longer"} than your 30-day average`, s: `${mins(usual)} a night`, rv: signed(diff), tone: diff < 0 ? "neg" : "pos" });
      const hrs = before.map((n) => n.avgHr).filter((x): x is number => x != null);
      if (l.avgHr != null && hrs.length >= 5) {
        const d = Math.round(l.avgHr - avg(hrs)!);
        if (Math.abs(d) >= 3) out.push({ icon: "heart", t: `Heart rate while asleep ${d > 0 ? "above" : "below"} your average`, s: d > 0 ? "can follow a hard day, a late meal or a cold coming on" : undefined, rv: `${d > 0 ? "+" : "-"}${Math.abs(d)} bpm`, tone: d > 0 ? "neg" : "pos" });
      }
    }
    if (l.deepMin != null && l.asleepMin) out.push({ icon: "layers", t: "Deep sleep last night", s: deepPct.value != null && full.value.length > 3 ? `${deepPct.value}% on average` : undefined, rv: `${Math.round((l.deepMin / l.asleepMin) * 100)}%` });
    if ((l.awakeMin ?? 0) >= 30) out.push({ icon: "timer", t: "Awake during the night", rv: mins(l.awakeMin!) });
    if (l.minSpo2 != null && l.minSpo2 < 90) out.push({ icon: "water", t: "Blood oxygen dipped during the night", s: "its lowest reading", rv: pc(l.minSpo2) });
  }
  // the last 7 nights' bedtimes, earliest to latest
  const week = rf.filter((n) => n.date > ymd(new Date(Date.now() - 7 * 86400000)));
  if (week.length >= 4) {
    const bs = week.map((n) => nightMin(n.startAt)), spread = Math.max(...bs) - Math.min(...bs);
    out.push(spread <= 30 ? { icon: "clock", t: "Bedtime steady", s: "earliest to latest, last 7 days", rv: mins(Math.max(1, spread)), tone: "pos" }
      : { icon: "clock", t: "Bedtime varied", s: "earliest to latest, last 7 days", rv: mins(spread), tone: spread >= 90 ? "neg" : undefined });
  }
  // over the period: nights under 7 hours, and weekend nights (going to bed on a Friday or Saturday) against the rest
  const nd = nightDays.value;
  if (nd.length >= 5) {
    const under = nd.filter((x) => x.min < 420).length;
    if (under) out.push({ icon: "stats", t: "Nights under 7 hours", s: "most adults need 7-9", rv: `${under} of ${nd.length}`, tone: under > nd.length / 2 ? "neg" : undefined });
  }
  const wkend = full.value.filter((n) => [5, 6].includes(new Date(n.startAt).getDay())), wkday = full.value.filter((n) => ![5, 6].includes(new Date(n.startAt).getDay()));
  if (wkend.length >= 2 && wkday.length >= 4) {
    const d = avg(wkend.map(asleepMin))! - avg(wkday.map(asleepMin))!;
    if (Math.abs(d) >= 30) out.push({ icon: "calendar", t: `${d > 0 ? "Longer" : "Shorter"} on weekends`, s: "than on weeknights", rv: signed(d) });
  }
  return out;
});

// the nights in the period, newest first: a week of them, then all on request
const showAll = ref(false);
const list = computed(() => showAll.value ? nights.value : nights.value.slice(0, 7));
const open = ref<string | null>(null);
</script>

<template>
  <div v-if="q.isError.value" class="card empty"><Icon name="info" :size="34" /><b>Couldn't load your sleep</b>{{ (q.error.value as Error | null)?.message }}<br /><button class="btn tonal" @click="q.refetch()">Try again</button></div>
  <div v-else-if="loading" class="empty">Loading…</div>
  <template v-else>
    <!-- last night: its numbers as a report's tiles, then its stages; opens the night -->
    <div v-if="last" class="card wkc click sl-last" role="button" tabindex="0" @click="open = last.date" @keydown.enter="open = last.date">
      <div class="ch"><span class="bi"><Icon name="moon" :size="15" /></span><span class="t grow">{{ lastName }}</span><span class="tiny">{{ fmt.time(last.startAt) }}-{{ fmt.time(last.endAt) }}</span></div>
      <NightStats :night="last" />
      <div v-if="hasStages(last) || last.awakeMin" class="sl-stages"><StageBar :night="last" /></div>
      <div v-if="!isFull(last)" class="tiny sl-line">{{ SHORT_WHY }}</div>
    </div>

    <div v-if="!days.length" class="card empty"><Icon name="moon" :size="34" /><b>No sleep in this period</b>Pick a longer period, or wear your band to bed.</div>
    <template v-else>
      <!-- the period's averages, as Overview's tiles -->
      <div class="grid g4" :class="tiles < 4 ? `n${tiles}` : ''">
        <div class="card hero stat"><div class="lbl"><span class="bi"><Icon name="moon" :size="15" /></span>Time asleep</div><div class="val">{{ avgAsleep != null ? mins(avgAsleep) : "-" }}</div><div class="sub">{{ nightDays.length ? `average of ${nightDays.length} ${nightDays.length === 1 ? "night" : "nights"}` : "only short records" }}</div><Sparkline v-if="nightDays.length > 1" :values="nightDays.map((x) => x.min)" color="var(--onc)" /></div>
        <div v-if="bed" class="card stat"><div class="lbl"><span class="bi"><Icon name="clock" :size="15" /></span>Bedtime</div><div class="val">{{ clock(bed.at) }}</div><div class="sub">{{ spread(bed)[0] }} <span class="nw">{{ spread(bed)[1] }}</span></div></div>
        <div v-if="wake" class="card stat"><div class="lbl"><span class="bi"><Icon name="bell" :size="15" /></span>Wake time</div><div class="val">{{ clock(wake.at) }}</div><div class="sub">{{ spread(wake)[0] }} <span class="nw">{{ spread(wake)[1] }}</span></div></div>
        <div v-if="deepPct != null" class="card stat"><div class="lbl"><span class="bi"><Icon name="layers" :size="15" /></span>Deep sleep</div><div class="val">{{ deepPct }}<small>%</small></div><div class="sub">of time asleep</div></div>
        <div v-else-if="avgBed != null" class="card stat"><div class="lbl"><span class="bi"><Icon name="timer" :size="15" /></span>In bed</div><div class="val">{{ mins(avgBed) }}</div><div class="sub">{{ Math.round(avgEff! * 100) }}% of it asleep</div></div>
      </div>

      <div v-if="insights.length" class="card wkc spt">
        <div class="ch"><span class="bi"><Icon name="sparkle" :size="15" /></span><span class="t grow">What stands out</span></div>
        <div class="list sl-ins">
          <div v-for="(x, i) in insights" :key="i" class="li">
            <Icon :name="x.icon" :size="18" :class="x.tone ?? 'muted'" />
            <div class="grow"><div class="t">{{ x.t }}</div><div v-if="x.s" class="s">{{ x.s }}</div></div>
            <b v-if="x.rv" class="r rv" :class="x.tone">{{ x.rv }}</b>
          </div>
        </div>
      </div>

      <div class="card spt">
        <div class="lbl hgap">{{ perWeek ? "Average time asleep per night, by week" : "Time asleep per night" }} (h) · target {{ BAND[0] }}-{{ BAND[1] }}</div>
        <BarChart :bars="bars" :band="BAND" :height="170" :fmt="hours" @pick="(d) => (open = d)" />
        <div v-if="legend.length && !perWeek" class="bmlegend sl-leg"><span v-for="k in legend" :key="k.name"><i :style="{ background: k.color }" />{{ k.name }}</span></div>
        <div v-if="nights.length || shortCount" class="tiny sl-line">{{ [nights.length ? "Time asleep leaves out the time awake in bed." : "", shortCount ? `${shortCount} short ${shortCount === 1 ? "record" : "records"} (under ${MIN_NIGHT_H} hours) left out of the averages.` : ""].filter(Boolean).join(" ") }}</div>
      </div>

      <div v-if="full.length > 1" class="card spt">
        <div class="lbl hgap">Bedtime and wake time</div>
        <SleepSchedule :nights="full" :bed="bed" :wake="wake" @pick="(d) => (open = d)" />
        <div v-if="schedule" class="tiny sl-line">{{ schedule }}</div>
      </div>

      <div v-if="trends.length" class="grid g2 spt"><div v-for="t in trends" :key="t.id" class="card"><div class="lbl hgap">{{ t.name }} ({{ t.unit }})</div>
        <LineChart :points="t.pts" :height="140" :fmt="t.f" @pick="(d) => (open = d)" /><div class="tiny sl-line">{{ t.line }}</div></div></div>

      <template v-if="nights.length">
        <div class="sh"><h2>Nights</h2><span class="tiny">{{ nights.length }}</span></div>
        <div class="card"><div class="list">
          <div v-for="n in list" :key="n.date" class="li click" role="button" tabindex="0" @click="open = n.date" @keydown.enter="open = n.date">
            <span class="bi sg"><Icon name="moon" :size="16" /></span>
            <div class="grow"><div class="t">{{ fmt.date(n.date, { weekday: "short", day: "numeric", month: "short" }) }}</div><div class="s">{{ fmt.time(n.startAt) }}-{{ fmt.time(n.endAt) }} · {{ isFull(n) ? `${mins(inBedMin(n))} in bed` : "short record" }}</div></div>
            <b class="num" :class="{ muted: !isFull(n) }">{{ mins(asleepMin(n)) }}</b>
          </div>
        </div></div>
        <div v-if="nights.length > 7 && !showAll" class="center spt"><button class="qb" @click="showAll = true">Show all {{ nights.length }} nights</button></div>
      </template>
    </template>
    <NightSheet v-if="open" :date="open" @close="open = null" />
  </template>
</template>

<style scoped>
/* last night's stages a block-padding below its tiles, under a faint line, as a report's highlights */
.sl-last { margin-bottom: var(--spg); }
.sl-stages { margin-top: var(--cpy); padding-top: var(--cpy); border-top: 1px solid var(--ol); }
/* the highlights as a report's: the last row without its line, the number in the row's tone */
.sl-ins .li:last-child { border-bottom: 0; padding-bottom: 0; }
.sl-ins .li:first-child { padding-top: 0; }
.sl-ins .grow { min-width: 0; }
.rv { font-variant-numeric: tabular-nums; white-space: nowrap; }
.sl-line { margin-top: 6px; }
.nw { white-space: nowrap; }
.sl-leg { margin-top: var(--hg); }
</style>
