<script setup lang="ts">
// A finished workout's or activity's band data in one card ("From your band"), from the saved band records rather than a live read: the
// heart rate's average and highest, then whatever else was saved for the time as a report's tiles (Stats → Heart's day):
// a workout's active calories and heart rate recovery (how far it fell in a minute of rest), an activity's band speed or
// pace (when the activity has none of its own) and cadence. Under them the heart rate over the session with each set
// shaded on it in the workout's colour (the rests are the gaps between; a reading names its set or "Rest"), switchable
// to the speed or pace and the cadence when the watch saved those, and the time in each heart rate zone. Only what
// there is: no records and no kept series leaves the tiles alone, nothing at all leaves no card.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { zoneMinutes, restRecovery, fromM, ymd, SAMPLE_MAX_S, type SetSpan } from "@motus/shared";
import { useFmt } from "../core/format";
import { ZONES, useMaxHr, bandRecords, bandTypesOn, type BandRecord } from "../core/heart";
import { hrPoints, fromWhere, useDevice } from "../native/health";
import Icon from "./Icon.vue";
import LineChart from "./LineChart.vue";
import StageBar from "./stats/StageBar.vue";

// from, to: the session's time (ms); samples: its heart rate ([unix seconds, bpm]); avg, max: the ones kept with it, for
// a session with no samples; sets: a workout's sets on the clock (setSpans) with their names, color their shade; kcal:
// add the band's active calories; motion: an activity's band speed shown as a pace ("pace") or a speed, ownPace: the
// activity has a pace of its own (its tile already says it, so no pace tile here)
const props = defineProps<{ from: number; to: number; samples: [number, number][]; avg?: number | null; max?: number | null;
  sets?: (SetSpan & { name: string })[]; color?: string; kcal?: boolean; motion?: "pace" | "speed"; ownPace?: boolean }>();
const router = useRouter();
const fmt = useFmt();
const maxHr = useMaxHr();
const dev = useDevice();
const range = computed(() => ({ a: new Date(props.from), b: new Date(props.to) }));
const ok = computed(() => props.to > props.from);

const ys = computed(() => props.samples.map((p) => p[1]));
const avg = computed(() => (ys.value.length ? Math.round(ys.value.reduce((t, v) => t + v, 0) / ys.value.length) : props.avg != null ? Math.round(props.avg) : null));
const max = computed(() => (ys.value.length ? Math.max(...ys.value) : props.max != null ? Math.round(props.max) : null));

// the band's active calories over the session: each record's share of it by time (a record can run past either end)
const kcalQ = useQuery({
  queryKey: computed(() => ["readings", "session", "active_kcal", props.from, props.to]),
  queryFn: () => bandRecords("active_kcal", range.value.a, range.value.b),
  enabled: computed(() => !!props.kcal && ok.value),
});
const kcal = computed(() => {
  let t = 0;
  for (const r of kcalQ.data.value ?? []) {
    const s = Date.parse(r.start), e = r.end ? Date.parse(r.end) : s, v = r.value ?? 0;
    t += e > s ? (v * Math.max(0, Math.min(e, props.to) - Math.max(s, props.from))) / (e - s) : s >= props.from && s < props.to ? v : 0;
  }
  return Math.round(t);
});

// an activity's speed and cadence, asked for only when its days have them (older servers don't know the kinds at all)
const MOTION = ["speed", "steps_cadence", "cycling_cadence"];
const motionQ = useQuery({
  queryKey: computed(() => ["readings", "session", "motion", props.from, props.to]),
  queryFn: async () => {
    const day = 86400000, has = await bandTypesOn(ymd(new Date(props.from - day)), ymd(new Date(props.to + day)));
    const want = MOTION.filter((t) => has.has(t));
    return want.length ? bandRecords(want.join(","), range.value.a, range.value.b) : [];
  },
  enabled: computed(() => !!props.motion && ok.value),
});
// one type's values over the session, [unix seconds, value]: a record's samples, else its one value at its start
const seriesOf = (type: string) => (motionQ.data.value ?? []).filter((r: BandRecord) => r.type === type)
  .flatMap((r) => r.samples ?? (r.value != null ? [[Date.parse(r.start) / 1000, r.value] as [number, number]] : []))
  .filter((p) => p[1] > 0 && p[0] * 1000 >= props.from && p[0] * 1000 < props.to).sort((a, b) => a[0] - b[0]);
const mean = (xs: [number, number][]) => xs.reduce((t, p) => t + p[1], 0) / xs.length;
// speed comes in metres a second: as a pace (time per km or mile) or a speed (km or miles an hour); a pace leaves out
// standing still (under about 1 km/h), which would be an endless pace
const speed = computed(() => seriesOf("speed"));
const asPace = (mps: number) => 1 / fromM(mps, fmt.value.du);
const paced = computed(() => (props.motion === "pace" ? speed.value.filter((p) => p[1] >= 0.3) : speed.value));
const cadence = computed(() => { const s = seriesOf("steps_cadence"); return s.length ? { pts: s, unit: "steps/min", icon: "steps" } : (() => { const c = seriesOf("cycling_cadence"); return c.length ? { pts: c, unit: "rpm", icon: "refresh" } : null; })(); });

// recovery over the rests, from the samples
const recovery = computed(() => (props.sets?.length ? restRecovery(props.samples, props.sets) : null));

type Tile = { key: string; icon: string; label: string; value: string; unit: string; sub: string };
const tiles = computed(() => {
  const out: Tile[] = [], f = fmt.value;
  if (avg.value != null) out.push({ key: "hr", icon: "heart", label: "Heart rate", value: String(avg.value), unit: "bpm", sub: max.value != null ? `average · up to ${max.value}` : "average" });
  if (props.kcal && kcal.value > 0) out.push({ key: "kcal", icon: "flame", label: "Active calories", value: f.num(kcal.value, 0), unit: "kcal", sub: "during the workout" });
  const r = recovery.value;
  if (r) out.push({ key: "rec", icon: "heartPulse", label: "Recovery", value: `${r.drop > 0 ? "-" : r.drop < 0 ? "+" : ""}${Math.abs(r.drop)}`, unit: "bpm", sub: "in 1 min of rest" });
  if (paced.value.length && !(props.motion === "pace" && props.ownPace))
    out.push(props.motion === "pace"
      ? { key: "spd", icon: "timer", label: "Pace", value: f.clock(asPace(mean(paced.value))), unit: `/${f.du}`, sub: "average" }
      : { key: "spd", icon: "gauge", label: "Speed", value: f.num(fromM(mean(paced.value) * 3600, f.du), 1), unit: `${f.du}/h`, sub: "average" });
  const c = cadence.value;
  if (c) out.push({ key: "cad", icon: c.icon, label: "Cadence", value: f.num(mean(c.pts), 0), unit: c.unit, sub: "average" });
  return out;
});
// named for where it all came from, as the activity's tiles say it: "From your watch"
const title = computed(() => `From ${fromWhere(true, dev.value)}`);
const label = (x: Tile) => [x.label, x.value, x.unit, x.sub].filter(Boolean).join(" ");

// the curves on offer: the heart rate, then the speed or pace and the cadence when there are two or more of each
const t = (ms: number) => fmt.value.time(new Date(ms).toISOString());
// a reading in a set names it, one after it "Rest"
const where = (ms: number) => { const s = ms / 1000, x = props.sets?.find((z) => s >= z.a && s <= z.b);
  return x ? x.name : props.sets?.some((z) => z.restB != null && s > z.b && s <= z.restB) ? "Rest" : ""; };
const hrPts = computed(() => hrPoints(props.samples, (ms) => [t(ms), where(ms)].filter(Boolean).join(" · ")));
type Curve = { key: string; name: string; points: { x: number; y: number; label: string }[]; fmt: (v: number) => string };
const curves = computed(() => {
  const f = fmt.value, out: Curve[] = [];
  if (hrPts.value.length > 1) out.push({ key: "hr", name: "Heart rate", points: hrPts.value, fmt: (v) => f.num(v, 0) });
  const pts = (xs: [number, number][], y: (v: number) => number) => hrPoints(xs.map((p) => [p[0], y(p[1])] as [number, number]), t);
  if (paced.value.length > 1) out.push(props.motion === "pace"
    ? { key: "spd", name: "Pace", points: pts(paced.value, asPace), fmt: (v) => f.clock(v) }
    : { key: "spd", name: "Speed", points: pts(paced.value, (v) => fromM(v * 3600, f.du)), fmt: (v) => f.num(v, 1) });
  if (cadence.value && cadence.value.pts.length > 1) out.push({ key: "cad", name: "Cadence", points: pts(cadence.value.pts, (v) => v), fmt: (v) => f.num(v, 0) });
  return out;
});
const pick = ref("hr");
const curve = computed(() => curves.value.find((c) => c.key === pick.value) ?? curves.value[0] ?? null);
const unitOf = (k: string) => (k === "hr" ? "bpm" : k === "cad" ? cadence.value?.unit ?? "" : props.motion === "pace" ? `/${fmt.value.du}` : `${fmt.value.du}/h`);
const shade = computed(() => (curve.value?.key === "hr" ? (props.sets ?? []).map((x) => ({ a: x.a * 1000, b: x.b * 1000, name: x.name, color: props.color })) : undefined));

// minutes in each zone, from the samples
const zones = computed(() => {
  if (!maxHr.value || props.samples.length < 2) return [];
  const m = zoneMinutes(props.samples, maxHr.value.bpm).get("") ?? [];
  return ZONES.map((z, i) => ({ key: z.key, name: z.name, color: z.color, min: Math.round(m[i] ?? 0) }));
});
const zoned = computed(() => zones.value.some((z) => z.min > 0));
</script>

<template>
  <div v-if="tiles.length || curve" class="card wkc">
    <div class="lbl hgap">{{ title }}</div>
    <div v-if="tiles.length" class="wstats rows2" :class="{ n4: tiles.length === 4 }">
      <div v-for="x in tiles" :key="x.key" class="ws" role="group" :aria-label="label(x)">
        <div class="wlb"><Icon :name="x.icon" :size="14" />{{ x.label }}</div>
        <div class="wv">{{ x.value }} <small>{{ x.unit }}</small></div>
        <div class="wd">{{ x.sub }}</div>
      </div>
    </div>
    <div v-if="curve" class="csec">
      <div v-if="curves.length > 1" class="seg block hgap"><button v-for="c in curves" :key="c.key" :class="{ on: curve.key === c.key }" @click="pick = c.key">{{ c.name }}</button></div>
      <div class="lbl hgap">{{ curve.name }} ({{ unitOf(curve.key) }})</div>
      <LineChart :points="curve.points" :height="150" :fmt="curve.fmt" :xfmt="t" :domain="[from, to]" :gap="SAMPLE_MAX_S * 1000" :shade="shade" />
      <div v-if="shade?.length" class="bmlegend sh-leg"><span><i class="sh-hr" />Heart rate</span><span><i :style="{ background: color }" />Sets</span><span><i class="sh-rest" />Rests</span></div>
    </div>
    <div v-if="zoned" class="csec"><div class="lbl hgap">Time in heart rate zones · max {{ maxHr!.bpm }} bpm{{ maxHr!.own ? "" : " from your age" }}</div><StageBar :parts="zones" /></div>
    <div v-else-if="!maxHr && samples.length > 1" class="tiny csec"><button class="lnk inl" @click="router.push('/body?tab=details')">Set your year of birth or max heart rate</button> to see the time in heart rate zones.</div>
  </div>
</template>

<style scoped>
.sh-leg { margin-top: var(--hg); }
.sh-leg .sh-hr { background: var(--acc); }
/* a rest is the chart's own background between two sets */
.sh-leg .sh-rest { background: var(--s2); }
</style>
