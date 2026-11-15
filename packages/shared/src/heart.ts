// Heart rate zones: the share of the person's max heart rate a beat falls in. The max is the one set in Body → About
// you, else the usual estimate from age (220 - age); without either there are no zones (a guess would mislead).

/** The five zones as shares of the max heart rate (from, up to the next one's from), the commonly used split */
export const HR_ZONES = [
  { key: "z1", name: "Very light", from: 0.5 },
  { key: "z2", name: "Light", from: 0.6 },
  { key: "z3", name: "Moderate", from: 0.7 },
  { key: "z4", name: "Hard", from: 0.8 },
  { key: "z5", name: "Maximum", from: 0.9 },
] as const;
export type HrZoneKey = (typeof HR_ZONES)[number]["key"];

/** The max heart rate to use, and whether it is the person's own or worked out from their age; null without either */
export function maxHeartRate(profile: { birthYear?: number | null; maxHr?: number | null }, now = new Date()): { bpm: number; own: boolean } | null {
  if (profile.maxHr && profile.maxHr > 0) return { bpm: profile.maxHr, own: true };
  if (profile.birthYear) return { bpm: 220 - (now.getFullYear() - profile.birthYear), own: false };
  return null;
}

/** The zone of a heart rate (index into HR_ZONES), or -1 under the first one */
export function zoneOf(bpm: number, max: number): number {
  for (let i = HR_ZONES.length - 1; i >= 0; i--) if (bpm >= HR_ZONES[i]!.from * max) return i;
  return -1;
}

/** A sample counts for the time up to the next one, at most this long (a longer gap: the band was off or not reading) */
export const SAMPLE_MAX_S = 300;

/**
 * Minutes in each zone from heart rate samples ([unix seconds, bpm], any order), each counting for the time up to the
 * next one (at most SAMPLE_MAX_S; the last one a minute). by: groups them (a day's key from its time), else one group "".
 */
export function zoneMinutes(samples: readonly (readonly [number, number])[], max: number, by: (t: number) => string = () => ""): Map<string, number[]> {
  const s = [...samples].sort((a, b) => a[0] - b[0]);
  const out = new Map<string, number[]>();
  for (let i = 0; i < s.length; i++) {
    const z = zoneOf(s[i]![1], max);
    if (z < 0) continue;
    const secs = i + 1 < s.length ? Math.min(SAMPLE_MAX_S, s[i + 1]![0] - s[i]![0]) : 60;
    const k = by(s[i]![0]), row = out.get(k) ?? out.set(k, HR_ZONES.map(() => 0)).get(k)!;
    row[z]! += secs / 60;
  }
  return out;
}

/**
 * Days whose resting heart rate stands out above the person's usual: at least `over` bpm above the average of the 28
 * days before it, with at least 7 of them read (fewer say too little). A raised resting heart rate can follow a hard
 * day, a short night or an illness coming on. days: { date: YYYY-MM-DD, value } in any order.
 */
export function highRestingDays(days: readonly { date: string; value: number }[], over = 5): { date: string; value: number; usual: number }[] {
  const s = [...days].filter((d) => d.value > 0).sort((a, b) => a.date.localeCompare(b.date));
  const out: { date: string; value: number; usual: number }[] = [];
  for (const d of s) {
    const from = new Date(Date.parse(d.date + "T12:00:00Z") - 28 * 86400000).toISOString().slice(0, 10);
    const before = s.filter((x) => x.date >= from && x.date < d.date);
    if (before.length < 7) continue;
    const usual = before.reduce((t, x) => t + x.value, 0) / before.length;
    if (d.value - usual >= over) out.push({ date: d.date, value: d.value, usual: Math.round(usual) });
  }
  return out;
}
