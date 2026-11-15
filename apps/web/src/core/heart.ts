// Stats → Heart's shared pieces: the zones' colours (light to hot, from the theme), the max heart rate in use, and a
// stretch of heart rate samples from the saved band records (GET /health/records, at most 40 days per request).
import { computed } from "vue";
import { HR_ZONES, maxHeartRate } from "@motus/shared";
import { api } from "../api/client";
import { useSettings } from "../api/queries";

export const ZONE_COLORS = ["color-mix(in srgb, var(--acc) 30%, var(--s2))", "color-mix(in srgb, var(--acc) 62%, var(--s2))", "var(--acc)", "var(--warn)", "var(--neg)"];
export const ZONES = HR_ZONES.map((z, i) => ({ ...z, color: ZONE_COLORS[i]! }));

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
  return (await Promise.all(parts)).flatMap((r) => r.records.flatMap((x) => x.samples ?? [])).sort((a, b) => a[0] - b[0]);
}
