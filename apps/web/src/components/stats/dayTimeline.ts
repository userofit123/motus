// One day at a glance (the Calendar's day card, M-244): what the band saved for the day, on one timeline from midnight
// to midnight: the night that ended that morning (its stages when they were saved), the steps by hour and the heart
// rate. Each part is asked under the same key its Stats day asks it under (Sleep's night, Steps' hours, Heart's
// samples), so opening that tab from here finds it loaded, and a sync reloads both. Only the parts that hold something
// come back; `has` is false when none does, so the card draws no empty chart. Which parts there are comes from the day's
// summary (a night, steps, a heart rate), there before the hours and readings load, so the card has its loaded height
// from the start and doesn't grow as they come in or shrink and grow again on the next day.
import { computed, type Ref } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import { api } from "../../api/client";
import type { HealthDay } from "../../api/queries";
import { hrSamples } from "../../core/heart";
import { nightSegments, hasStages, LANES, type Seg, type SleepRecord } from "../../core/sleep";
import { midnight, nextMidnight } from "./daySessions";
const iso = (ms: number) => new Date(ms).toISOString();
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
// a day's heart rate as one reading per 5 minutes (their average), as Stats → Heart's day draws it
const BUCKET_S = 300;

export interface DayTimeline {
  from: number; to: number;
  /** the night's stretches inside the day (stages, or one "asleep" stretch when only its times were saved) */
  sleep: Seg[];
  /** the night's part inside the day and its stage rows (empty when the band saved no stages), from the day's summary,
   *  which is there before the stretches load, so the card keeps its height while they do */
  night: { a: number; b: number; rows: Seg["k"][] } | null;
  /** steps in each hour, from its start (ms) */
  steps: { a: number; value: number }[];
  /** heart rate, one point per 5 minutes with readings ([ms, bpm]) */
  hr: [number, number][];
  /** whether the Steps and Heart rate lanes are drawn: the summary says the day has them and they are loading (still
   *  empty), or they loaded with something; one only goes when it loaded empty (a day synced before Motus kept the
   *  band's records, with only its totals) */
  lanes: { steps: boolean; heart: boolean };
}

export function useDayTimeline(date: Ref<string>, day: Ref<HealthDay | null | undefined>, enabled: Ref<boolean>) {
  const from = computed(() => midnight(date.value)), to = computed(() => nextMidnight(date.value));
  const night = computed(() => (day.value?.date === date.value ? day.value.sleep : null));
  const on = (x: () => boolean) => computed(() => enabled.value && day.value?.date === date.value && x());
  const t0 = computed(() => (night.value ? Date.parse(night.value.startAt) : 0)), t1 = computed(() => (night.value ? Date.parse(night.value.endAt) : 0));
  const sleepQ = useQuery({ queryKey: computed(() => ["readings", "night", "sleep", date.value, t0.value]), enabled: on(() => !!night.value), retry: false,
    queryFn: () => api.get<{ records: SleepRecord[] }>("/health/records", { type: "sleep", from: iso(t0.value - 3600_000), to: iso(t1.value + 3600_000) }) });
  const hourQ = useQuery({ queryKey: computed(() => ["readings", "hourly", "steps", date.value]), enabled: on(() => (day.value?.steps ?? 0) > 0), retry: false, placeholderData: keepPreviousData,
    queryFn: () => api.get<{ hours: { at: string; sum?: number }[] }>("/health/records/hourly", { type: "steps", from: iso(from.value), to: iso(to.value), zone }) });
  const hrQ = useQuery({ queryKey: computed(() => ["readings", "day", "heart_rate", date.value]), enabled: on(() => true), retry: false, placeholderData: keepPreviousData,
    queryFn: () => hrSamples(new Date(from.value), new Date(to.value)) });

  const tl = computed<DayTimeline>(() => {
    const lo = from.value, hi = to.value, n = night.value;
    // the night's part after midnight; a night without saved records drawn as one stretch asleep over its times
    let sleep: Seg[] = [], nt: DayTimeline["night"] = null;
    if (n && t1.value > lo && t0.value < hi) {
      const segs = sleepQ.data.value ? nightSegments(sleepQ.data.value.records, n.startAt, n.endAt) : [];
      // a staged night keeps its rows while its stretches load (drawing nothing in them yet, not one "asleep" bar across
      // them); when they can't be fetched or none came back, it is drawn as a night without stages (one striped lane)
      const staged = hasStages(n) && (sleepQ.isPending.value || segs.length > 0);
      sleep = (segs.length ? segs : staged ? [] : [{ a: t0.value, b: t1.value, k: "asleep" as const }])
        .filter((s) => s.b > lo && s.a < hi).map((s) => ({ ...s, a: Math.max(s.a, lo), b: Math.min(s.b, hi) }));
      // only the stages the night has, by its minutes, and any stretch's own ("asleep" sitting in Light's row). A stage
      // the minutes leave out (under a minute, rounded to none) but a stretch has gets its row when the stretches load:
      // rare, and dropping the stretch would hide a time awake that happened
      const has = new Set(staged ? sleep.map((s) => (s.k === "asleep" ? "light" : s.k)) : []);
      const min: Record<string, number | null | undefined> = { awake: n.awakeMin, rem: n.remMin, light: n.lightMin, deep: n.deepMin };
      const rows = staged ? LANES.map((l) => l.k).filter((k) => (min[k] ?? 0) > 0 || has.has(k)) : [];
      nt = { a: Math.max(t0.value, lo), b: Math.min(t1.value, hi), rows: staged && !rows.length ? ["light"] : rows };
    }
    // a placeholder (the day before's) is never drawn on this day
    const sums = new Map<number, number>();
    if (!hourQ.isPlaceholderData.value) for (const h of hourQ.data.value?.hours ?? []) { const t = Date.parse(h.at); if (t >= lo && t < hi) sums.set(t, (sums.get(t) ?? 0) + (h.sum ?? 0)); }
    const steps = [...sums].filter(([, v]) => v > 0).map(([a, value]) => ({ a, value: Math.round(value) })).sort((x, y) => x.a - y.a);
    const raw = hrQ.isPlaceholderData.value ? [] : hrQ.data.value?.length ? hrQ.data.value : day.value?.hr?.series ?? [];
    const m = new Map<number, [number, number]>();
    for (const [ts, v] of raw) { if (ts * 1000 < lo || ts * 1000 >= hi) continue; const k = Math.floor(ts / BUCKET_S) * BUCKET_S, b = m.get(k); if (b) { b[0] += v; b[1]++; } else m.set(k, [v, 1]); }
    const hr = [...m].sort((a, b) => a[0] - b[0]).map(([k, [s, c]]) => [k * 1000, Math.round(s / c)] as [number, number]);
    const hrs = hr.length > 1 ? hr : [];
    // a lane the summary promises stays while its query loads (or shows the day before's), so the height doesn't change
    const same = day.value?.date === date.value;
    const loading = (q: { isPending: Ref<boolean>; isPlaceholderData: Ref<boolean> }) => q.isPending.value || q.isPlaceholderData.value;
    const lanes = { steps: steps.length > 0 || (same && (day.value?.steps ?? 0) > 0 && loading(hourQ)), heart: hrs.length > 0 || (same && !!day.value?.hr && loading(hrQ)) };
    return { from: lo, to: hi, sleep, night: nt, steps, hr: hrs, lanes };
  });
  const has = computed(() => !!tl.value.night || tl.value.lanes.steps || tl.value.lanes.heart);
  return { tl, has };
}
