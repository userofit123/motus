// Health Connect in the Android app (Settings → Features → Health Connect): reads what other apps on the phone wrote
// there (a band through Gadgetbridge, a scale, a watch) and hands it to the engine (POST /health/import), which keeps
// typed values and never adds the same thing twice. Read when the app opens or comes back to the screen, at most every
// 15 minutes, and from Settings → Integrations by hand.
import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";
import { TOPICS } from "@motus/shared";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { readJson, writeJson } from "../core/prefs";
import { accounts } from "./accounts";

/** Everything the plugin asks Health Connect for: someone who allowed an earlier version lacks the kinds added since */
export const HEALTH_KINDS = ["steps", "sleep", "weight", "sessions", "heartRate", "restingHr", "spo2", "hrv", "respiratoryRate", "distance", "activeKcal", "bodyFat", "hydration", "vo2max"] as const;
type Kind = (typeof HEALTH_KINDS)[number];
// history: Motus may read further back than 30 days; historyAvailable: this phone's Health Connect can allow that at all
// (someone who allowed Motus before past data could be asked for has historyAvailable but not history until connect() again)
export interface HealthStatus { available: "yes" | "update" | "no"; granted: Kind[]; history: boolean; historyAvailable: boolean }
/** What the plugin's read() hands over, passed to POST /health/import as it is */
export interface HealthData {
  steps: { date: string; value: number }[]; sleep: { date: string; hours: number }[]; weight: { id: string; at: string; kg: number }[];
  sessions: { id: string; type: string; title: string; start: string; end: string; avgHr?: number; distanceM?: number; steps?: number; calories?: number }[];
  // a day's resting heart rate (bpm), blood oxygen (%) and heart rate variability (ms); absent from an older app build
  restingHr?: { date: string; value: number }[]; spo2?: { date: string; value: number }[]; hrv?: { date: string; value: number }[];
  // each night in full (its stages, and the heart rate, blood oxygen and breathing read meanwhile), a day's distance
  // (metres) and active calories, the band's whole-day totals; passed on as they come, absent from an older app build
  sleepNights?: unknown[]; distance?: { date: string; value: number }[]; activeKcal?: { date: string; value: number }[];
  // body fat, water drunk, VO2 max and each day's heart rate: passed on as they come, absent from an older app build
  bodyFat?: unknown[]; hydration?: unknown[]; vo2max?: unknown[]; hrDays?: unknown[];
}
/** What POST /health/import added, and ranges: what POST /health/ranges filled in on activities and workouts recorded in
 *  Motus (the band's steps, its heart rate) */
export interface HealthResult { steps: number; sleep: number; weight: number; activities: number; restingHr?: number; spo2?: number; hrv?: number; sleepNights?: number; distance?: number; activeKcal?: number; bodyFat?: number; hydration?: number; vo2max?: number; hrDays?: number; ranges?: { steps: number; hr: number } }
// what a read added, in words (Settings → Integrations and pull to refresh say it): "3 days of steps, 2 nights of sleep,
// 2 activities with band steps, 3 sessions with heart rate"; "" when it added nothing (every part starts with its count,
// so it reads right first in a list too)
const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;
export function healthAdded(r: HealthResult): string {
  return [r.steps && `${many(r.steps, "day", "days")} of steps`, (r.sleep || r.sleepNights) && `${many(Math.max(r.sleep, r.sleepNights ?? 0), "night", "nights")} of sleep`,
    r.weight && `${r.weight} weight ${r.weight === 1 ? "entry" : "entries"}`, r.activities && many(r.activities, "activity", "activities"),
    r.restingHr && `${many(r.restingHr, "day", "days")} of resting heart rate`, r.spo2 && `${many(r.spo2, "day", "days")} of blood oxygen`,
    r.hrv && `${many(r.hrv, "day", "days")} of HRV`,
    r.distance && `${many(r.distance, "day", "days")} of distance`, r.activeKcal && `${many(r.activeKcal, "day", "days")} of active calories`,
    r.bodyFat && `${r.bodyFat} body fat ${r.bodyFat === 1 ? "entry" : "entries"}`, r.hydration && `${many(r.hydration, "day", "days")} of water`,
    r.vo2max && `${many(r.vo2max, "day", "days")} of VO2 max`,
    r.ranges?.steps && `${many(r.ranges.steps, "activity", "activities")} with band steps`,
    r.ranges?.hr && `${many(r.ranges.hr, "session", "sessions")} with heart rate`].filter(Boolean).join(", ");
}
type Range = { kind: "activity" | "workout"; id: string; start: string; end: string };
type RangeResult = { kind: "activity" | "workout"; id: string; steps?: number; covered: boolean; hr?: [number, number][] };

const plugin = () => (globalThis as any).Capacitor?.Plugins?.MotusHealth;
export const healthSupported = () => !!plugin() && (globalThis as any).Capacitor?.getPlatform?.() === "android";

// per account on this phone: when it last read Health Connect (a server account's other phones keep their own)
const KEY = "motusHealthSync";
const key = () => accounts.active ?? "web";
export const lastSync = ref<string | null>(readJson<Record<string, string>>(KEY, {})[key()] ?? null);
const remember = (at: string) => { const all = readJson<Record<string, string>>(KEY, {}); all[key()] = at; writeJson(KEY, all); lastSync.value = at; };
// and what that read took in: each allowed kind, with what this version reads of it. A plain read goes back only to the
// last one, so a kind allowed since, or one this version reads more of, would never get its older days without this.
const READ_KEY = "motusHealthRead";
// what a version reads of a kind beyond its first: bumped when one starts handing over more (sleep: each night in
// detail, 0.1.25; heart rate: the day's heart rate, 0.1.26)
const READS: Partial<Record<Kind, number>> = { sleep: 2, heartRate: 2 };
const readsOf = (granted: readonly string[]) => HEALTH_KINDS.filter((k) => granted.includes(k)).map((k) => (READS[k] ? `${k}.${READS[k]}` : k));
const readBefore = () => readJson<Record<string, string[]>>(READ_KEY, {})[key()] ?? [];
const rememberRead = (reads: string[]) => { const all = readJson<Record<string, string[]>>(READ_KEY, {}); all[key()] = reads; writeJson(READ_KEY, all); };

export const healthStatus = async (): Promise<HealthStatus> => healthSupported() ? plugin().status() : { available: "no", granted: [], history: false, historyAvailable: false };
export const connectHealth = async (): Promise<HealthStatus> => plugin().connect();
export const openHealthSettings = () => plugin()?.openSettings();

// the first read goes back 30 days (as far as Health Connect lets a newly allowed app see); later ones overlap a day,
// since a band often hands over yesterday's sleep and steps only when it next connects. A read that takes in something
// the last one didn't (a kind allowed since, or more of one after an update) goes back as a first one does, or 90 days
// when past data is allowed; the engine keeps typed values and adds nothing twice, so the days read again stay as they are.
const FIRST_DAYS = 30, MORE_DAYS = 90, OVERLAP_MS = 86_400_000, DAY_MS = 86_400_000;
let running: Promise<HealthResult | null> | null = null;
export const syncing = ref(false);

/** Reads Health Connect and saves what's new. null: nothing allowed yet (or not the Android app).
 *  from: read from that day instead (Settings → Integrations → Import past data); it runs after a read already going. */
export async function syncHealth(o: { from?: Date } = {}): Promise<HealthResult | null> {
  if (!o.from) return running ??= read();
  while (running) await running.catch(() => null);
  return running = read(o.from);
}
async function read(past?: Date): Promise<HealthResult | null> {
  syncing.value = true;
  try {
    const st = await healthStatus();
    if (st.available !== "yes" || !st.granted.length) return null;
    const started = new Date().toISOString();
    const reads = readsOf(st.granted), before = readBefore();
    const fresh = reads.some((k) => !before.includes(k));
    const back = new Date(Date.now() - (fresh && st.history ? MORE_DAYS : FIRST_DAYS) * DAY_MS);
    // a new kind goes back to `back`, but never starts later than the usual start: a last sync older than `back` would
    // otherwise leave the days between them unread
    const usual = lastSync.value ? new Date(Date.parse(lastSync.value) - OVERLAP_MS) : null;
    const since = !usual ? back : fresh && back < usual ? back : usual;
    const from = past && past < since ? past : since;
    const data: HealthData = await plugin().read({ from: from.toISOString() });
    const r = await api.post<HealthResult>("/health/import", data);
    // a read of the past also reads up to now, so the next one may start here; never earlier than a read already done
    if (!lastSync.value || started > lastSync.value) remember(started);
    rememberRead(reads);
    // then what the band saw during activities and workouts recorded in Motus over the same days: its steps (a phone in
    // a pocket counts fewer) and heart rate. A failure here keeps the import above; the next sync asks again.
    try { r.ranges = await readRanges(from < rangesFrom() ? from : rangesFrom()); } catch (e) { console.warn("Health Connect ranges", e); }
    if (r.steps || r.sleep || r.activities || r.weight || r.restingHr || r.spo2 || r.hrv || r.sleepNights || r.distance || r.activeKcal || r.bodyFat || r.hydration || r.vo2max || r.hrDays) invalidate([...TOPICS.health]);
    if (r.ranges?.steps || r.ranges?.hr) invalidate([...TOPICS.health, "workouts"]);
    return r;
  } finally { syncing.value = false; running = null; }
}

// Sessions are asked about over a fixed look-back, not since the last sync: a band hands its heart rate over when it next
// connects, which can be days after the session, so a window that follows the sync would never ask again. The engine
// leaves out sessions that already have what they need, so this stays cheap.
const RANGES_DAYS = 30, SETTLE_MS = 3 * DAY_MS, CHECKED_KEY = "motusHealthChecked", CHECKED_MAX = 400;
const rangesFrom = () => new Date(Date.now() - RANGES_DAYS * DAY_MS);
// Sessions the band had nothing for, once they ended more than 3 days ago (it has synced by then, or never will), so a
// session without band data isn't read from Health Connect on every sync. Kept per account on this phone.
const checkedIds = () => new Set(readJson<Record<string, string[]>>(CHECKED_KEY, {})[key()] ?? []);
const rememberChecked = (ids: string[]) => {
  if (!ids.length) return;
  const all = readJson<Record<string, string[]>>(CHECKED_KEY, {});
  all[key()] = [...new Set([...(all[key()] ?? []), ...ids])].slice(-CHECKED_MAX);
  writeJson(CHECKED_KEY, all);
};

async function readRanges(from: Date): Promise<{ steps: number; hr: number } | undefined> {
  if (typeof plugin()?.readRanges !== "function") return undefined; // an app build from before
  const got = await api.get<{ ranges: Range[] }>("/health/ranges", { from: from.toISOString() });
  const checked = checkedIds();
  const ranges = (got.ranges ?? []).filter((x) => !checked.has(x.id));
  if (!ranges.length) return undefined;
  const { results } = await plugin().readRanges({ ranges }) as { results: RangeResult[] };
  if (!results?.length) return undefined;
  const settled = new Set(ranges.filter((x) => Date.now() - Date.parse(x.end) > SETTLE_MS).map((x) => x.id));
  const out = await api.post<{ steps: number; hr: number }>("/health/ranges", { results });
  // marked only after the server took the results, and only for a session the band had neither heart rate nor steps for
  rememberChecked(results.filter((x) => settled.has(x.id) && !x.hr?.length && !(x.covered && x.steps)).map((x) => x.id));
  return out;
}

const EVERY_MS = 15 * 60_000;
let watching = false;
/** Reads on open and whenever the app comes back, while the feature is on (on() says so at that moment). */
export function watchHealth(on: () => boolean) {
  if (!healthSupported() || watching) return;
  watching = true;
  const maybe = () => {
    if (!on() || document.visibilityState !== "visible") return;
    if (lastSync.value && Date.now() - Date.parse(lastSync.value) < EVERY_MS) return;
    void syncHealth().catch(() => { /* shown in Settings → Integrations when synced by hand */ });
  };
  document.addEventListener("visibilitychange", maybe);
  setTimeout(maybe, 3000);
}

// Live heart rate while a workout or a recording runs: the band's readings since the session started, read straight from
// Health Connect every minute while the app is on screen (and at once when it comes back). The band hands them over only
// when Gadgetbridge syncs with it, so the newest is often a few minutes old: shown with its age, and not at all past 10
// minutes. One reader per session, shared by every screen that shows it (the page and the bar at the bottom).
export type HrSample = [number, number]; // [unix seconds, bpm]
const LIVE_EVERY_MS = 60_000, LIVE_FRESH_S = 10 * 60, LIVE_OVERLAP_S = 10 * 60;
interface LiveReader { since: string; samples: Ref<HrSample[]>; users: number; timer: ReturnType<typeof setInterval> | null; busy: boolean; polled: number }
const readers = new Map<string, LiveReader>();
// what "2 min ago" says moves on its own, a little faster than the readings come in
const liveNow = ref(Date.now());
let nowTimer: ReturnType<typeof setInterval> | null = null;
const canLive = () => healthSupported() && typeof plugin()?.latestHr === "function"; // an app build from before has none

async function pollLive(r: LiveReader, force = false) {
  // moving between pages hands the reader on (page to bar and back): no second read within a few seconds of the last
  if (r.busy || document.visibilityState !== "visible" || (!force && Date.now() - r.polled < 20_000)) return;
  r.busy = true; r.polled = Date.now();
  try {
    // from a little before the newest reading held (a later sync can hand over a few minutes it missed), merged by time
    const last = r.samples.value.at(-1)?.[0];
    const from = last ? new Date(Math.max(Date.parse(r.since), (last - LIVE_OVERLAP_S) * 1000)).toISOString() : r.since;
    const { samples } = (await plugin().latestHr({ since: from })) as { samples?: HrSample[] };
    if (!samples?.length) return;
    const all = new Map(r.samples.value.map((p) => [p[0], p[1]] as const));
    for (const [t, bpm] of samples) if (bpm > 0) all.set(t, bpm);
    if (all.size !== r.samples.value.length || samples.some(([t, b]) => all.get(t) !== b)) r.samples.value = [...all].sort((a, b) => a[0] - b[0]);
  } catch { /* no permission or Health Connect busy: try again next minute */ }
  finally { r.busy = false; }
}
const onVisible = () => { if (document.visibilityState === "visible") { liveNow.value = Date.now(); for (const r of readers.values()) if (r.users) void pollLive(r, true); } };

function attach(since: string): LiveReader {
  let r = readers.get(since);
  if (!r) { r = { since, samples: ref<HrSample[]>([]), users: 0, timer: null, busy: false, polled: 0 }; readers.set(since, r); }
  if (r.users++ === 0) { void pollLive(r); r.timer = setInterval(() => void pollLive(r!, true), LIVE_EVERY_MS); }
  if (readers.size && !nowTimer) { nowTimer = setInterval(() => (liveNow.value = Date.now()), 15_000); document.addEventListener("visibilitychange", onVisible); }
  return r;
}
function detach(r: LiveReader) {
  if (--r.users > 0) return;
  if (r.timer) clearInterval(r.timer); r.timer = null;
  // kept while nobody shows it (the page hands it to the bar and back, a workout and a recording may both run), so its
  // readings stay; only the oldest idle ones go once there are more than a few
  for (const [k, x] of readers) if (readers.size > 3 && !x.users) readers.delete(k);
  if (![...readers.values()].some((x) => x.users) && nowTimer) { clearInterval(nowTimer); nowTimer = null; document.removeEventListener("visibilitychange", onVisible); }
}

/** The band's heart rate since `start` (ISO) while `on` is true (the session runs, the Health Connect feature is on).
 *  samples: every reading so far; latest: the newest when at most 10 minutes old, with how old it is ("2 min ago").
 *  Empty and null outside the Android app, without permission, or before the first reading arrives. */
export function useLiveHr(start: () => string | null | undefined, on: () => boolean) {
  const empty = ref<HrSample[]>([]);
  const cur = shallowRef<LiveReader | null>(null);
  watch(() => (on() && canLive() ? start() ?? null : null), (since) => {
    if (cur.value?.since === since) return;
    if (cur.value) detach(cur.value);
    cur.value = since ? attach(since) : null;
  }, { immediate: true });
  onScopeDispose(() => { if (cur.value) detach(cur.value); cur.value = null; });
  const samples = computed(() => (cur.value ?? { samples: empty }).samples.value);
  const latest = computed(() => {
    const p = samples.value.at(-1); if (!p) return null;
    const ageS = Math.max(0, liveNow.value / 1000 - p[0]);
    return ageS > LIVE_FRESH_S ? null : { bpm: p[1], at: p[0], ago: ageS < 60 ? "just now" : `${Math.floor(ageS / 60)} min ago` };
  });
  const avg = computed(() => (samples.value.length ? Math.round(samples.value.reduce((t, p) => t + p[1], 0) / samples.value.length) : null));
  const max = computed(() => (samples.value.length ? samples.value.reduce((m, p) => Math.max(m, p[1]), 0) : null));
  return { samples, latest, avg, max };
}

/** Heart-rate readings as chart points: a band reads every few seconds, so an hour is over a thousand points; they're
 *  averaged down to at most `most` (the line looks the same and the tooltip stays quick). */
export function hrPoints(hr: readonly HrSample[] | null | undefined, label: (ms: number) => string, most = 240) {
  const all = hr ?? [], step = Math.max(1, Math.ceil(all.length / most));
  const out: { x: number; y: number; label: string }[] = [];
  for (let i = 0; i < all.length; i += step) {
    const part = all.slice(i, i + step), x = part[0]![0] * 1000;
    out.push({ x, y: Math.round(part.reduce((t, p) => t + p[1], 0) / part.length), label: label(x) });
  }
  return out;
}
