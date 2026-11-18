// Stats → Heart's shared pieces: the zones' colours (light to hot, from the theme), the max heart rate in use, and a
// stretch of heart rate samples from the saved band records (GET /health/records, at most 40 days per request), and a
// workout's or activity's own stretch of them.
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { HR_ZONES, maxHeartRate } from "@motus/shared";
import { api } from "../api/client";
import { useSettings } from "../api/queries";
import { mins } from "./sleep";

export const ZONE_COLORS = ["color-mix(in srgb, var(--acc) 30%, var(--s2))", "color-mix(in srgb, var(--acc) 62%, var(--s2))", "var(--acc)", "var(--warn)", "var(--neg)"];
export const ZONES = HR_ZONES.map((z, i) => ({ ...z, color: ZONE_COLORS[i]! }));

/**
 * The line under a time-in-zones bar (M-277): only the time at half the max or more is in a zone, so a resting day's
 * hours aren't in the bar and its shares are of that time alone; this says how long that was and where each zone
 * starts in bpm, so "Very light 7m" reads against a chart that rises to 130. Each start as zoneOf counts it (the first
 * whole bpm at the zone's share of the max). total: the bar's minutes; when: its time ("today", "during this workout").
 */
export function zoneNote(max: number, total: number, when: string): string {
  const at = ZONES.map((z) => Math.ceil(z.from * max));
  return `Your heart rate was ${at[0]} bpm or more (half your max) for ${mins(total)} ${when}. Zones start at: ${ZONES.map((z, i) => `${z.name} ${at[i]}`).join(", ")} bpm.`;
}

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
