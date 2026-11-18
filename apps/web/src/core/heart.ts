// Stats → Heart's shared pieces: the zones' colours (light to hot, from the theme), the max heart rate in use, and a
// stretch of heart rate samples from the saved band records (GET /health/records, at most 40 days per request), and a
// workout's or activity's own stretch of them.
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { HR_ZONES, maxHeartRate, duration, eachSample } from "@motus/shared";
import { api } from "../api/client";
import { useSettings } from "../api/queries";

export const ZONE_COLORS = ["color-mix(in srgb, var(--acc) 30%, var(--s2))", "color-mix(in srgb, var(--acc) 62%, var(--s2))", "var(--acc)", "var(--warn)", "var(--neg)"];
export const ZONES = HR_ZONES.map((z, i) => ({ ...z, color: ZONE_COLORS[i]! }));

/**
 * A time-in-zones bar's parts (StageBar) from the minutes in each zone (zoneMinutes, light to hot): each with where it
 * starts as zoneOf counts it (the first whole bpm at the zone's share of the max, "130+"), so the legend reads against a
 * chart that rises to 130 (M-277). Minutes stay unrounded, so a short spike at 130 still shows Moderate ("<1m").
 */
export const zoneParts = (m: number[], max: number) =>
  ZONES.map((z, i) => ({ key: z.key, name: z.name, color: z.color, from: `${Math.ceil(z.from * max)}+`, min: m[i] ?? 0 }));

/** The minutes the samples cover (each counts as eachSample says), in or under the zones: what "the rest" is measured against */
export const coveredMinutes = (samples: readonly (readonly [number, number])[]) => {
  let secs = 0;
  eachSample(samples, (_t, _bpm, s) => (secs += s));
  return secs / 60;
};

/**
 * The one line under a time-in-zones bar: only the time at the first zone's start or more is in the bar, so a resting
 * day's hours aren't in it and its shares are of that time alone. total: the legend's whole minutes added up, so the two
 * agree (0: only seconds, "<1m"); when: its time ("today", "during this workout"); below: whether the readings also
 * cover time under the zones (covered minutes - minutes in zones > 1), so time with no readings isn't called lower; max:
 * the max heart rate, for the first zone's start, which is what "lower" means.
 */
export const zoneNote = (total: number, when: string, below: boolean, max: number) =>
  `Your heart rate was in a zone for ${total ? duration(total * 60, true) : "<1m"} ${when}${below ? `; the rest of the time it was below ${Math.ceil(ZONES[0]!.from * max)} bpm` : ""}.`;

/** The max heart rate in use (Body → About you), null when neither it nor a year of birth is set */
export function useMaxHr() {
  const s = useSettings();
  return computed(() => maxHeartRate(s.value.profile ?? {}));
}

type HrRecord = { samples?: [number, number][] };
const SPAN_MS = 40 * 86400000;
/** Every heart rate sample ([unix seconds, bpm]) saved over [from, to), asked for in stretches of 40 days at most */
export async function hrSamples(from: Date, to: Date): Promise<[number, number][]> {
  const parts: Promise<{ records: HrRecord[] }>[] = [];
  for (let a = from.getTime(); a < to.getTime(); a += SPAN_MS)
    parts.push(api.get<{ records: HrRecord[] }>("/health/records", { type: "heart_rate", from: new Date(a).toISOString(), to: new Date(Math.min(to.getTime(), a + SPAN_MS)).toISOString() }));
  // a second another record already has (two apps writing the band's readings, or the same records sent from two
  // phones) is one reading, so a chart's points, averages and counts don't count it twice; a record's own readings all stay
  const taken = new Set<number>(), out: [number, number][] = [];
  for (const r of (await Promise.all(parts)).flatMap((x) => x.records)) {
    const mine = (r.samples ?? []).filter((q) => !taken.has(q[0]));
    for (const q of mine) taken.add(q[0]);
    out.push(...mine);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** A saved band record as GET /health/records hands it out: its time, and an amount or reading, or samples ([unix seconds, value]); origin: the app that wrote it */
export type BandRecord = { type: string; start: string; end?: string; value?: number; samples?: [number, number][]; origin?: string };
/** The saved records of these types (comma separated) over [from, to), at most 40 days */
export const bandRecords = (types: string, from: Date, to: Date) =>
  api.get<{ records: BandRecord[] }>("/health/records", { type: types, from: from.toISOString(), to: to.toISOString() }).then((r) => r.records);
/** Which record types were saved on the days [from, to) (YYYY-MM-DD, to not included), so a screen asks only for what there is */
export const bandTypesOn = async (from: string, to: string) =>
  new Set((await api.get<{ days: { date: string; types: Record<string, number> }[] }>("/health/records/days", { from, to })).days.flatMap((d) => Object.keys(d.types)));

/**
 * A workout's or activity's heart rate from the saved band records over its time (under a "readings" key, so a change
 * to them reloads it), else the series kept with it when it was saved (older ones, before every record was kept).
 */
export function useSessionSamples(from: () => number | null, to: () => number | null, kept: () => [number, number][] | null | undefined) {
  const q = useQuery({
    queryKey: computed(() => ["readings", "session", "heart_rate", from(), to()]),
    queryFn: () => hrSamples(new Date(from()!), new Date(to()!)),
    enabled: computed(() => from() != null && to() != null && to()! > from()!),
    retry: false,
  });
  return computed<[number, number][]>(() => (q.data.value?.length ? q.data.value : kept() ?? []));
}
