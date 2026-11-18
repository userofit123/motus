<script setup lang="ts">
// A finished workout's or activity's band data in one card ("Heart rate", "From your band" under it), from the saved band records rather than a live read: the
// heart rate's average and highest, then whatever else was saved for the time as a report's tiles (Stats → Heart's day):
// a workout's active calories and heart rate recovery (how far it fell in a minute of rest), an activity's band speed or
// pace (when the activity has none of its own) and cadence. Under them the heart rate over the session with each set
// shaded on it in the workout's colour and each rest after one in a quieter grey (a reading names its set or "Rest"), switchable
// to the speed or pace and the cadence when the watch saved those, and the time in each heart rate zone. Only what
// there is: no records and no kept series leaves the tiles alone, nothing at all leaves no card.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { zoneMinutes, restRecovery, fromM, ymd, SAMPLE_MAX_S, type SetSpan } from "@motus/shared";
import { useFmt } from "../core/format";
import { useMaxHr, zoneNote, zoneParts, coveredMinutes, bandRecords, bandTypesOn, type BandRecord } from "../core/heart";
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

// the band's active calories over the session: each record's share of it by time (a record can run past either end),
// one app's (the most): two apps writing the same band's calories (or the phone's estimate beside the band's) would
// count them twice; a record sent twice under two ids (same app, start and end) counts once
const kcalQ = useQuery({
  queryKey: computed(() => ["readings", "session", "active_kcal", props.from, props.to]),
  queryFn: () => bandRecords("active_kcal", range.value.a, range.value.b),
  enabled: computed(() => !!props.kcal && ok.value),
  retry: false,
});
const kcal = computed(() => {
  const byApp = new Map<string, number>(), seen = new Set<string>();
  for (const r of kcalQ.data.value ?? []) {
    const k = `${r.origin ?? ""}|${r.start}|${r.end ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const s = Date.parse(r.start), e = r.end ? Date.parse(r.end) : s, v = r.value ?? 0;
    const t = e > s ? (v * Math.max(0, Math.min(e, props.to) - Math.max(s, props.from))) / (e - s) : s >= props.from && s < props.to ? v : 0;
    byApp.set(r.origin ?? "", (byApp.get(r.origin ?? "") ?? 0) + t);
  }
  return Math.round(Math.max(0, ...byApp.values()));
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
  retry: false,
});
// one type's values over the session, [unix seconds, value]: a record's samples, else its one value at its start
// (a second another record already has, from a second app or sent twice, is one reading)
const seriesOf = (type: string) => {
  const taken = new Set<number>();
  return (motionQ.data.value ?? []).filter((r: BandRecord) => r.type === type)
    .flatMap((r) => {
      const mine = (r.samples ?? (r.value != null ? [[Date.parse(r.start) / 1000, r.value] as [number, number]] : [])).filter((p) => !taken.has(p[0]));
      for (const p of mine) taken.add(p[0]);
      return mine;
    })
    .filter((p) => p[1] > 0 && p[0] * 1000 >= props.from && p[0] * 1000 < props.to).sort((a, b) => a[0] - b[0]);
};
const mean = (xs: [number, number][]) => xs.reduce((t, p) => t + p[1], 0) / xs.length;
// speed comes in metres a second: as a pace (time per km or mile) or a speed (km or miles an hour); a pace leaves out
// standing still (under about 1 km/h), which would be an endless pace
const speed = computed(() => seriesOf("speed"));
const asPace = (mps: number) => 1 / fromM(mps, fmt.value.du);
const paced = computed(() => (props.motion === "pace" ? speed.value.filter((p) => p[1] >= 0.3) : speed.value));
const cadence = computed(() => { const s = seriesOf("steps_cadence"); return s.length ? { pts: s, unit: "steps/min" } : (() => { const c = seriesOf("cycling_cadence"); return c.length ? { pts: c, unit: "rpm" } : null; })(); });

// recovery over the rests, from the samples: a fall of 20 bpm or more in the first minute is the commonly cited good one
const GOOD_DROP = 20;
const recovery = computed(() => (props.sets?.length ? restRecovery(props.samples, props.sets) : null));

type Tile = { key: string; icon: string; label: string; value: string; unit: string; sub: string; tone?: string };
const tiles = computed(() => {
  const out: Tile[] = [], f = fmt.value;
  if (avg.value != null) out.push({ key: "hr", icon: "heart", label: "Average", value: String(avg.value), unit: "bpm", sub: max.value != null ? `up to ${max.value}` : "during the session" });
  if (props.kcal && kcal.value > 0) out.push({ key: "kcal", icon: "flame", label: "Active calories", value: f.num(kcal.value, 0), unit: "kcal", sub: "during the workout" });
  const r = recovery.value;
  if (r) out.push({ key: "rec", icon: "heartDown", label: "Recovery", value: String(Math.abs(r.drop)), unit: "bpm",
    sub: r.drop > 0 ? "drop in 1 min of rest" : r.drop < 0 ? "rise in 1 min of rest" : "no drop in 1 min of rest", tone: r.drop >= GOOD_DROP ? "pos" : undefined });
  if (paced.value.length && !(props.motion === "pace" && props.ownPace))
    out.push(props.motion === "pace"
      ? { key: "spd", icon: "timer", label: "Average pace", value: f.clock(asPace(mean(paced.value))), unit: `/${f.du}`, sub: "while moving" }
      : { key: "spd", icon: "speed", label: "Average speed", value: f.num(fromM(mean(paced.value) * 3600, f.du), 1), unit: `${f.du}/h`, sub: "while moving" });
  const c = cadence.value;
  if (c) out.push({ key: "cad", icon: "cadence", label: "Average cadence", value: f.num(mean(c.pts), 0), unit: c.unit, sub: "while moving" });
  return out;
});
// where it all came from, under the title, in the same words as the activity's tiles ("From your watch")
const source = computed(() => `From ${fromWhere(true, dev.value)}`);
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
// each set in the workout's colour and each rest after one in a quiet grey with no strip, so the two tell apart
const REST_COLOR = "var(--tx2)";
const shade = computed(() => (curve.value?.key === "hr" ? (props.sets ?? []).flatMap((x) => [{ a: x.a * 1000, b: x.b * 1000, name: x.name, color: props.color },
  ...(x.restB != null && x.restB > x.b ? [{ a: x.b * 1000, b: x.restB * 1000, name: "Rest", color: REST_COLOR, soft: true }] : [])]) : undefined));
const rested = computed(() => !!shade.value?.some((z) => z.soft));

// minutes in each zone, from the samples
const zones = computed(() => {
  if (!maxHr.value || props.samples.length < 2) return [];
  const m = zoneMinutes(props.samples, maxHr.value.bpm).get("") ?? [];
  return zoneParts(m, maxHr.value.bpm);
});
const zoned = computed(() => zones.value.some((z) => z.min > 0));
// under the bar, as Stats → Heart's day: how long the session was in a zone at all, and whether the readings also
// cover time below the zones (a workout comes with its sets, an activity without)
const zNote = computed(() => { const total = zones.value.reduce((t, z) => t + Math.round(z.min), 0); return zoneNote(total, props.sets ? "during this workout" : "during this activity", coveredMinutes(props.samples) - zones.value.reduce((t, z) => t + z.min, 0) > 1, maxHr.value!.bpm); });
</script>

<template>
  <div v-if="tiles.length || curve" class="card wkc">
    <div class="lbl">Heart rate</div>
    <div class="tiny hgap">{{ source }}</div>
    <div v-if="tiles.length" class="wstats rows2" :class="{ n4: tiles.length === 4 }">
      <div v-for="x in tiles" :key="x.key" class="ws" role="group" :aria-label="label(x)">
        <div class="wlb"><Icon :name="x.icon" :size="14" />{{ x.label }}</div>
        <div class="wv" :class="x.tone">{{ x.value }} <small>{{ x.unit }}</small></div>
        <div class="wd">{{ x.sub }}</div>
      </div>
    </div>
    <div v-if="curve" class="csec">
      <div v-if="curves.length > 1" class="seg block hgap"><button v-for="c in curves" :key="c.key" :class="{ on: curve.key === c.key }" @click="pick = c.key">{{ c.name }}</button></div>
      <!-- the switch above names the curve, so only its unit here -->
      <div class="lbl hgap">{{ curves.length > 1 ? unitOf(curve.key) : `${curve.name} (${unitOf(curve.key)})` }}</div>
      <LineChart :points="curve.points" :height="150" :fmt="curve.fmt" :xfmt="t" :domain="[from, to]" :gap="SAMPLE_MAX_S * 1000" :shade="shade" />
      <div v-if="shade?.length" class="bmlegend sh-leg"><span><i class="sh-hr" />Heart rate</span><span><i :style="{ background: color }" />Sets</span><span v-if="rested"><i class="sh-rest" />Rests</span></div>
    </div>
    <div v-if="zoned" class="csec"><div class="lbl hgap">Time in heart rate zones · max {{ maxHr!.bpm }} bpm{{ maxHr!.own ? "" : " from your age" }}</div><StageBar :parts="zones" /><div class="tiny zn-line">{{ zNote }}</div></div>
    <div v-else-if="!maxHr && samples.length > 1" class="tiny csec"><button class="lnk inl" @click="router.push('/body?tab=details')">Set your year of birth or max heart rate</button> to see the time in heart rate zones.</div>
  </div>
</template>

<style scoped>
.sh-leg { margin-top: var(--hg); }
.zn-line { margin-top: var(--hg); }
.sh-leg .sh-hr { background: var(--acc); }
/* a rest is a quiet grey span behind the line (the chart draws it at 16%; a touch stronger here so the dot shows) */
.sh-leg .sh-rest { background: color-mix(in srgb, var(--tx2) 35%, transparent); }
</style>
