<script setup lang="ts">
// The workout so far, in the app's own look: a hero with the muscles worked so far (the routine card's figure, left)
// and a ring for sets done of planned, stat tiles (time, volume, records, rep targets), then a row per exercise with its done state,
// best set (the least help, for assisted ones), PR badge and a small bar for its sets. The last tab of the running
// workout; the numbers come from workoutSoFar (shared), so the Finish screen shows the same. There (`final`) the time
// leaves the tiles (Finish shows it larger) and each row says how the exercise compares with last time. Under the tiles,
// the band's heart rate so far (Android app, Health Connect on), when it handed any over: live while running, the
// finished workout's card on Finish.
import { computed } from "vue";
import { musclesWorked, muscleName, workoutSoFar, type Trend, type Workout } from "@motus/shared";
import { useFmt } from "../core/format";
import { elapsed } from "./runtime";
import Icon from "../components/Icon.vue";
import Ring from "../components/Ring.vue";
import BodyMap from "../components/BodyMap.vue";
import LineChart from "../components/LineChart.vue";
import HeartRate from "../components/HeartRate.vue";
import { useSettings } from "../api/queries";
import { useLiveHr, hrPoints } from "../native/health";

const props = defineProps<{ w: Workout; final?: boolean; vsLast?: Record<string, Trend> }>();
const emit = defineEmits<{ open: [index: number] }>();
const fmt = useFmt();
const TREND: Record<Trend, string> = { up: "Better than last time", same: "Same as last time", down: "Below last time" };
const r = computed(() => workoutSoFar(props.w));
const secs = computed(() => elapsed(props.w));
const pct = computed(() => (r.value.setsPlanned ? r.value.setsDone / r.value.setsPlanned : 0));
// only exercises with a working set done count as worked; main muscles beat helpers (as on the routine cards)
const worked = computed(() => musclesWorked(props.w.exercises
  .filter((e) => e.status !== "skipped" && e.sets.some((s) => s.done && s.kind !== "warmup"))
  .map((e) => ({ primary: e.exercise?.primaryMuscles ?? [], secondary: e.exercise?.secondaryMuscles ?? [] }))));
const muscleLine = computed(() => {
  const m = worked.value.primary.map(muscleName);
  return m.length > 3 ? `${m.slice(0, 3).join(" · ")} · ${m.length - 3} more` : m.join(" · ");
});
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
// Records = exercises that beat a personal best; Rep targets = sets that reached the reps the routine asked for. Two tiles, so
// each label says what its number counts
const recordsSub = computed(() => r.value.records ? "New personal bests" : props.final ? "No new records" : "None yet");
const tileCount = computed(() => (props.final ? 2 : 3) + (r.value.targets ? 1 : 0));

const settings = useSettings();
const hr = useLiveHr(() => props.w.startedAt, () => !!settings.value.features.healthConnect);
const hrLatest = hr.latest, hrSamples = hr.samples;
const hrPts = computed(() => hrPoints(hrSamples.value, (x) => fmt.value.time(new Date(x).toISOString())));
// fresh: the newest reading big and how old it is; past 10 minutes the average so far takes its place
const hrSub = computed(() => hrLatest.value ? `${hrLatest.value.ago} · average ${hr.avg.value} · up to ${hr.max.value}` : `average so far · up to ${hr.max.value}`);

const rows = computed(() => r.value.perExercise.map((p, i) => {
  const e = props.w.exercises[i]!;
  const done = p.status === "done" || p.status === "partial", skipped = p.status === "skipped";
  return {
    // warm-ups aren't counted sets, but ticking one has started the exercise
    p, done, skipped, started: !done && !skipped && e.sets.some((s) => s.done),
    bestLbl: e.exercise?.tracking === "assisted" ? "Least help" : "Best",
    best: p.best ? fmt.value.set(p.best, e.exercise?.tracking) : "",
    reason: e.skipReason ?? "",
    trend: props.vsLast?.[p.id],
    fill: p.setsPlanned ? Math.min(1, p.setsDone / p.setsPlanned) : 0,
  };
}));
</script>

<template>
  <div class="aw-ex wsf">
    <div class="exh"><div class="grow"><h3 class="wsf-h">{{ final ? "What you did" : "Summary so far" }}</h3>
      <div class="tiny">{{ r.exercisesDone }} of {{ plural(r.exercisesTotal, "exercise") }} done</div></div></div>

    <div class="card hero wbody">
      <BodyMap class="rbody" :values="{}" :highlight="worked.primary" :secondary="worked.secondary" />
      <div class="wsf-prog">
        <div class="wsf-cap">Sets done</div>
        <div class="wsf-ringrow">
          <div class="wsf-ring"><Ring aria-hidden="true" :pct="pct" :size="62" :stroke="6" /><span>{{ Math.round(pct * 100) }}%</span></div>
          <div class="wsf-big">{{ r.setsDone }}<small> of {{ r.setsPlanned }}</small></div>
        </div>
        <div class="wsf-cap">{{ muscleLine || (final ? "No sets ticked" : "Muscles show here as you tick sets") }}</div>
      </div>
    </div>

    <div class="wsf-tiles" :class="{ two: tileCount !== 3 }">
      <div v-if="!final" class="card stat wsf-tile"><div class="lbl"><span class="bi"><Icon name="clock" :size="15" /></span>Duration</div>
        <div class="val">{{ fmt.clock(secs) }}</div><div class="sub">Since {{ fmt.time(w.startedAt) }}</div></div>
      <div class="card stat wsf-tile"><div class="lbl"><span class="bi"><Icon name="layers" :size="15" /></span>Volume</div>
        <div class="val">{{ fmt.vol(r.volumeKg) }}</div><div class="sub">{{ plural(r.reps, "rep") }}</div></div>
      <div class="card stat wsf-tile" :class="{ rec: r.records }"><div class="lbl"><span class="bi"><Icon name="trophy" :size="15" /></span>Records</div>
        <div class="val">{{ r.records }}</div><div class="sub">{{ recordsSub }}</div></div>
      <div v-if="r.targets" class="card stat wsf-tile" :class="{ hit: r.targetsHit >= r.targets }"><div class="lbl"><span class="bi"><Icon name="check" :size="15" /></span>Rep targets</div>
        <div class="val">{{ r.targetsHit }}<small>/{{ r.targets }}</small></div>
        <div class="sub">Sets on target</div>
        <div class="sub">Sets that reached their reps</div></div>
    </div>

    <HeartRate v-if="final && hrSamples.length" :hr="hrSamples" />
    <div v-else-if="hrSamples.length" class="card stat wsf-hr">
      <div class="lbl"><span class="bi"><Icon name="heart" :size="15" /></span>Heart rate</div>
      <div class="val">{{ hrLatest ? hrLatest.bpm : hr.avg.value }}<small>bpm</small></div><div class="sub">{{ hrSub }}</div>
      <LineChart v-if="hrPts.length > 1" class="wsf-hrc" :points="hrPts" :height="120" :fmt="(v) => fmt.num(v, 0)" :xfmt="(t) => fmt.time(new Date(t).toISOString())" />
    </div>

    <div>
      <div class="lbl hgap">Exercises</div>
      <div class="list">
        <div v-for="(x, i) in rows" :key="x.p.id" class="li click" :class="{ skip: x.skipped }" @click="emit('open', i)">
          <span class="stt" :class="{ done: x.done, part: x.started }"><Icon v-if="x.done" name="check" :size="13" /><Icon v-else-if="x.skipped" name="skip" :size="11" /></span>
          <div class="grow wsf-main">
            <div class="wsf-name"><span class="t ellipsis">{{ x.p.name }}</span><span v-if="x.p.records" class="pr">PR</span></div>
            <div class="s wsf-sub">
              <template v-if="x.skipped"><span>Skipped</span><template v-if="x.reason"><span class="sep">·</span><span>{{ x.reason }}</span></template></template>
              <template v-else>
                <span v-if="x.best">{{ x.bestLbl }} <b>{{ x.best }}</b></span><span v-else>{{ x.started ? "Under way" : "Not started" }}</span>
                <template v-if="x.trend"><span class="sep">·</span><span class="wsf-tr" :class="{ pos: x.trend === 'up', neg: x.trend === 'down' }"><Icon v-if="x.trend !== 'same'" :name="x.trend === 'up' ? 'arrowUp' : 'arrowDown'" :size="13" />{{ TREND[x.trend] }}</span></template>
              </template>
            </div>
          </div>
          <div v-if="!x.skipped" class="r wsf-cnt">
            <div class="wsf-n">{{ x.p.setsDone }}<small>/{{ x.p.setsPlanned }}</small></div>
            <div class="pbar" :class="{ ok: x.fill >= 1 }"><i :style="{ width: `${x.fill * 100}%` }" /></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wsf { display: flex; flex-direction: column; gap: var(--spg); }
.wsf .exh { margin-bottom: 0; }
.wsf-h { cursor: default; }

/* the hero is a real .card.hero.wbody (Home's accent look, figure left as on the routine cards), so every look styles it */
.wsf-prog { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: var(--tdy); }
.wsf-cap { font-size: var(--fs-sm); color: color-mix(in srgb, var(--onc) 75%, transparent); }
.wsf-ringrow { display: flex; flex-wrap: wrap; align-items: center; gap: var(--tdy) var(--cpx); }
.wsf-ring { position: relative; flex: none; display: grid; }
.wsf-ring span { position: absolute; inset: 0; display: grid; place-items: center; font-size: var(--fs-sm); font-weight: 700; font-variant-numeric: tabular-nums; }
.wsf-big { font-size: var(--fs-h1); font-weight: 700; letter-spacing: -.5px; line-height: 1.1; font-variant-numeric: tabular-nums; }
.wsf-big small { font-size: var(--fs); font-weight: 500; letter-spacing: 0; color: color-mix(in srgb, var(--onc) 70%, transparent); }

/* stat tiles: the app's .card.stat, three across, or two across when there are two or four tiles; the value shrinks with the
   row like the phone stat cards (app.css) instead of being cut off, measured on the row so it also fits the desktop column */
.wsf-tiles { display: grid; gap: var(--hg); grid-template-columns: repeat(3, minmax(0, 1fr)); container-type: inline-size; }
.wsf-tiles.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.wsf-tile { min-height: 0; }
.wsf-tile .lbl { font-size: var(--fs-sm); gap: 6px; }
.wsf-tile .val { font-size: clamp(var(--fs-lg), 5.2cqi, var(--fs-val)); margin-top: var(--tdy); }
.wsf-tile.rec { border-color: color-mix(in srgb, var(--acc) 45%, var(--ol)); background: color-mix(in srgb, var(--acc) 7%, var(--s1)); }
.wsf-tile .val small { font-size: var(--fs-sm); font-weight: 500; color: var(--tx2); margin-inline-start: 0; } /* "19/19" like the exercise rows */
.wsf-tile.hit .val { color: var(--pos); }
.wsf-tile.hit .bi { background: var(--pos); color: var(--on); }
.wsf-tile.rec .bi { background: var(--acc); color: var(--on); }

/* heart rate: a stat tile as wide as the row of tiles, its line under the numbers */
.wsf-hr { min-height: 0; container-type: inline-size; }
.wsf-hr .lbl { font-size: var(--fs-sm); gap: 6px; }
/* the tiles' value size (5.2% of the row, which is as wide as this card) */
.wsf-hr .val { font-size: clamp(var(--fs-lg), 5.2cqi, var(--fs-val)); margin-top: var(--tdy); }
.wsf-hrc { margin-top: var(--tdy); }

/* exercise rows: done state on the left, best set in full colour, sets as a small bar on the right */
.wsf-main { min-width: 0; }
.wsf-name { display: flex; align-items: center; gap: 8px; min-width: 0; }
.wsf-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 0 6px; }
.wsf-sub b { color: var(--tx); font-weight: 600; font-variant-numeric: tabular-nums; }
.wsf-tr { display: inline-flex; align-items: center; gap: 3px; }
.wsf-cnt { width: 52px; display: flex; flex-direction: column; align-items: stretch; gap: var(--tdy); }
.wsf-n { font-weight: 600; font-size: var(--fs); font-variant-numeric: tabular-nums; }
.wsf-n small { font-size: var(--fs-sm); font-weight: 500; color: var(--tx2); }
.wsf-cnt .pbar { height: 5px; }
.stt:not(.done) { color: var(--tx2); }
.li.skip .t { text-decoration: line-through; opacity: .6; }
</style>
