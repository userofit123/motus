// Health Connect in the Android app (Settings → Features → Health Connect): reads what other apps on the phone wrote
// there (a band through Gadgetbridge, a scale, a watch) and hands it to the engine (POST /health/import), which keeps
// typed values and never adds the same thing twice. Read while the app is on screen, as often as Settings → Integrations
// → Read Health Connect says (this phone's choice), on pull to refresh, and from Settings → Integrations by hand.
import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { TOPICS, cleanWornDevice, HEALTH_DELETED_MAX, type WornDevice } from "@motus/shared";
import { api } from "../api/client";
import { invalidate, queryClient } from "../api/live";
import { readJson, writeJson, readStr, writeStr } from "../core/prefs";
import { accounts } from "./accounts";

/** Everything the plugin asks Health Connect for: someone who allowed an earlier version lacks the kinds added since */
export const HEALTH_KINDS = ["steps", "sleep", "weight", "sessions", "heartRate", "restingHr", "spo2", "hrv", "respiratoryRate", "distance", "activeKcal", "bodyFat", "hydration", "vo2max", "elevation", "floors"] as const;
type Kind = (typeof HEALTH_KINDS)[number];
// history: Motus may read further back than 30 days; historyAvailable: this phone's Health Connect can allow that at all
// (someone who allowed Motus before past data could be asked for has historyAvailable but not history until connect() again)
export interface HealthStatus { available: "yes" | "update" | "no"; granted: Kind[]; history: boolean; historyAvailable: boolean }
/** What the plugin's read() hands over, passed to POST /health/import as it is */
export interface HealthData {
  // worn (steps, distance, active calories): whether a band, watch or ring counted the day; absent from an older app build
  steps: { date: string; value: number; worn?: boolean }[]; sleep: { date: string; hours: number }[]; weight: { id: string; at: string; kg: number }[];
  sessions: { id: string; type: string; title: string; start: string; end: string; avgHr?: number; distanceM?: number; steps?: number; calories?: number }[];
  // a day's resting heart rate (bpm), blood oxygen (%) and heart rate variability (ms); absent from an older app build
  restingHr?: { date: string; value: number }[]; spo2?: { date: string; value: number }[]; hrv?: { date: string; value: number }[];
  // each night in full (its stages, and the heart rate, blood oxygen and breathing read meanwhile), a day's distance
  // (metres) and active calories, the band's whole-day totals; passed on as they come, absent from an older app build
  sleepNights?: unknown[]; distance?: { date: string; value: number; worn?: boolean }[]; activeKcal?: { date: string; value: number; worn?: boolean }[];
  // body fat, water drunk, VO2 max and each day's heart rate: passed on as they come, absent from an older app build
  bodyFat?: unknown[]; hydration?: unknown[]; vo2max?: unknown[]; hrDays?: unknown[];
  // the watch, band or ring behind the newest day one counted (kind: watch, band, ring, chestStrap or unknown; name: its
  // maker and model when Health Connect has them); not used by the engine any more, which keeps each day's kind (the
  // device on each steps, distance and active calories day) and works out the person's from those (GET /health/device)
  device?: { kind: string; name?: string };
}
/** What POST /health/import added, and ranges: what POST /health/ranges filled in on activities and workouts recorded in
 *  Motus (the band's steps, its heart rate) */
export interface HealthResult { steps: number; sleep: number; weight: number; activities: number; restingHr?: number; spo2?: number; hrv?: number; sleepNights?: number; distance?: number; activeKcal?: number; bodyFat?: number; hydration?: number; vo2max?: number; hrDays?: number; ranges?: RangesAdded }
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
    r.ranges?.steps && `${many(r.ranges.steps, "activity", "activities")} with ${deviceWord(deviceNow())} steps`,
    r.ranges?.hr && `${many(r.ranges.hr, "session", "sessions")} with heart rate`,
    r.ranges?.band && `${many(r.ranges.band, "activity", "activities")} with data from ${fromWhere(true, deviceNow())}`].filter(Boolean).join(", ");
}
type Range = { kind: "activity" | "workout"; id: string; start: string; end: string };
type RangeResult = { kind: "activity" | "workout"; id: string; steps?: number; covered: boolean; bandOnly?: boolean; hr?: [number, number][]; bandFields?: boolean };
// band: activities given what the band measured during them (distance, active calories, climb); absent from an older engine
type RangesAdded = { steps: number; hr: number; band?: number };

/** One day's steps per Health Connect app, and which Motus used (Imported data → a steps day → Where these steps came
 *  from). used: the band app whose count is the day's, null when no band counted (Health Connect's total is used). */
export interface StepSource { app: string; label?: string; steps: number; band: boolean; phone?: boolean; device: string }
export interface StepSources { date: string; total: number; used: string | null; phoneName?: string; sources: StepSource[] }
export const canStepSources = () => healthSupported() && typeof plugin()?.stepSources === "function"; // an app build from before has none
export const stepSources = (date: string): Promise<StepSources> => plugin().stepSources({ date });
/** An activity's steps per Health Connect app for its time, read as the sync reads them (the activity's ⋮ → Step
 *  sources). used: the worn device's app the sync takes, null when none counted. covered: its data stands for the whole
 *  time (synced past it, worn throughout). */
// why: why a worn device's data doesn't stand for the whole time: "after" (no step record after it yet: not synced) or
// "before" (none from before it); an older app build may send others
export interface SpanSource extends StepSource { deviceName?: string; covered: boolean; heartRate?: boolean; why?: string }
export interface ActivitySources { used: string | null; phoneName?: string; sources: SpanSource[] }
export const canActivitySources = () => healthSupported() && typeof plugin()?.activitySources === "function"; // an app build from before has none
export const activitySources = (start: string, end: string): Promise<ActivitySources> => plugin().activitySources({ start, end });
// the names Health Connect's own screen shows for the apps that write steps most often (the phone's name is used where
// it is the phone's own counting)
const APP_NAMES: [string, string][] = [
  ["nodomain.freeyourgadget.gadgetbridge", "Gadgetbridge"], ["com.xiaomi.wearable", "Mi Fitness"], ["com.xiaomi.hm.health", "Zepp Life"],
  ["com.huami.watch.hmwatchmanager", "Zepp"], ["com.huami.midong", "Amazfit"], ["com.google.android.apps.fitness", "Google Fit"],
  ["com.fitbit.FitbitMobile", "Fitbit"], ["com.garmin.android.apps.connectmobile", "Garmin Connect"], ["com.huawei.health", "Huawei Health"],
  ["com.sec.android.app.shealth", "Samsung Health"], ["com.mi.health", "Mi Health"], ["com.ouraring.oura", "Oura"],
];
/** A step source's name in plain words: "This phone (Robin)" for the phone's own counting, else the app's name. */
export function sourceName(s: StepSource, phoneName?: string): string {
  if (s.phone && (s.app === "android" || s.app.startsWith("com.android.healthconnect") || s.app.startsWith("com.google.android.healthconnect")))
    return phoneName ? `This phone (${phoneName})` : "This phone";
  return APP_NAMES.find(([p]) => s.app === p || s.app.startsWith(p + "."))?.[1] ?? s.label ?? s.app;
}

/** The worn device in words, by its kind (useDevice): "watch", "band", "ring", "chest strap", or "device" when it isn't
 *  known (none yet, or one that doesn't say, as many through Gadgetbridge) */
export const deviceWord = (k: WornDevice | null | undefined) => (k === "chestStrap" ? "chest strap" : k ?? "device");
/** The same for advice ("wear your watch or band to bed"): both kinds while it isn't known */
export const adviceWord = (k: WornDevice | null | undefined) => (k ? deviceWord(k) : "watch or band");
// the kind of the person's worn device, worked out by the engine from the days it counted (not a setting: an automatic
// write to settings could undo what the person changed on another device); filed under "health", so a read refreshes it
const DEVICE_KEY = ["health", "device"] as const;
const fetchDevice = () => api.get<{ kind: unknown }>("/health/device").then((r) => cleanWornDevice(r?.kind)).catch(() => null);
/** The kind of the person's worn device, for deviceWord and fromWhere (null while not known) */
export function useDevice(): Ref<WornDevice | null> {
  const q = useQuery({ queryKey: DEVICE_KEY, queryFn: fetchDevice, staleTime: 5 * 60_000 });
  return computed(() => q.data.value ?? null);
}
// the same once, outside a screen (a toast after a read)
const deviceNow = () => queryClient.getQueryData<WornDevice | null>(DEVICE_KEY) ?? null;

/** Where a day's steps, distance or active calories came from, in words: "your watch" (by the kind, deviceWord) when a
 *  band, watch or ring counted it (worn; a value from before Motus knew, or from an older app, counts as one), else
 *  "Health Connect" */
export const fromWhere = (worn: boolean | undefined, kind: WornDevice | null | undefined) => (worn === false ? "Health Connect" : `your ${deviceWord(kind)}`);

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
// detail, 0.1.25; heart rate: the day's heart rate, 0.1.26; steps, distance and active calories: one app's count a day,
// not the band's plus the phone's in between, so days saved too high are read again and corrected; then whether a band
// counted each day, so days no band counted stop saying "from your band"; then a band's day is the band's own total, not
// with the phone's own step counting added in where the band had none, so days saved too high are read again and lowered;
// then the band's records added up by Motus itself, as Health Connect's per-app total dropped steps where the band's own
// records overlap (a day read 4,821 where the band showed 5,036), so days saved too low are read again and raised)
const READS: Partial<Record<Kind, number>> = { sleep: 2, heartRate: 2, steps: 5, distance: 5, activeKcal: 5 };
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
 *  from: read from that day instead (Settings → Integrations → Import past data); it runs after a read already going.
 *  recent: a look in the minute-by-minute stretch after a session (watchHealth), which asks about the last day's sessions
 *  only, unless the whole look-back wasn't asked about for a while (readRanges). */
export async function syncHealth(o: { from?: Date; recent?: boolean } = {}): Promise<HealthResult | null> {
  if (!o.from) return running ??= read(undefined, o.recent);
  while (running) await running.catch(() => null);
  return running = read(o.from);
}
/** The oldest day of the last 60 waiting for the band's value (GET /daily marks it), or null; a failure reads as none. */
async function oldestWaiting(): Promise<Date | null> {
  try {
    const from = new Date(Date.now() - 60 * DAY_MS).toISOString().slice(0, 10);
    const days = (await api.get<{ date: string; waiting?: boolean }[]>("/daily", { from, tz: new Date().getTimezoneOffset() }))
      .filter((x) => x.waiting).map((x) => String(x.date).slice(0, 10)).sort();
    return days.length ? new Date(days[0] + "T00:00") : null;
  } catch { return null; }
}
async function read(past?: Date, recent = false): Promise<HealthResult | null> {
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
    // a day whose typed value went back to the band's ("Use band value", maybe on another device) waits for a read of
    // that day, which the usual overlap may no longer reach; from the day before, as the usual overlap does, so the
    // night that ends on that day (it began the evening before) is read whole
    const w = await oldestWaiting(), wait = w && new Date(w.getTime() - DAY_MS);
    const start = wait && wait < since ? wait : since;
    const from = past && past < start ? past : start;
    // Health Connect's changes list from here on, taken before the read so what is written meanwhile counts as new
    await markChanges();
    let r: HealthResult;
    try {
      const data: HealthData = await plugin().read({ from: from.toISOString() });
      r = await api.post<HealthResult>("/health/import", data);
    } catch (e) {
      // the changes list already moved past what this read missed: without the mark the next look reads in full
      mark = null;
      throw e;
    }
    // a read of the past also reads up to now, so the next one may start here; never earlier than a read already done
    if (!lastSync.value || started > lastSync.value) remember(started);
    rememberRead(reads);
    // the kind may have changed with the days just read (also when no count did), and the toast below names it
    await queryClient.fetchQuery({ queryKey: DEVICE_KEY, queryFn: fetchDevice, staleTime: 0 });
    // then what the band saw during activities and workouts recorded in Motus over the same days: its steps (a phone in
    // a pocket counts fewer) and heart rate. A failure here keeps the import above; the next sync asks again.
    try { r.ranges = await readRanges(from < rangesFrom() ? from : rangesFrom(), recent); } catch (e) { console.warn("Health Connect ranges", e); }
    // and every record as Health Connect has it (M-238): the readings behind the numbers above, kept for later. A failure
    // keeps the rest; the next read carries on from where this one got to.
    try { await syncRecords(`${[...st.granted].sort().join(",")}${st.history ? "+history" : ""}`); } catch (e) { console.warn("Health Connect records", e); }
    if (r.steps || r.sleep || r.activities || r.weight || r.restingHr || r.spo2 || r.hrv || r.sleepNights || r.distance || r.activeKcal || r.bodyFat || r.hydration || r.vo2max || r.hrDays) invalidate([...TOPICS.health]);
    if (r.ranges?.steps || r.ranges?.hr || r.ranges?.band) invalidate([...TOPICS.health, "workouts"]);
    return r;
  } finally { syncing.value = false; running = null; }
}

// Sessions are asked about over a fixed look-back, not since the last sync: a band hands its heart rate over when it next
// connects, which can be days after the session, so a window that follows the sync would never ask again. The engine
// leaves out sessions that already have what they need, so this stays cheap.
const RANGES_DAYS = 30, SETTLE_MS = 3 * DAY_MS, CHECKED_KEY = "motusHealthChecked", CHECKED_MAX = 400;
// bumped when the app reads the band's side differently, so the last 30 days are asked about once more, also activities
// that already have the band's steps (recheck) and ones remembered as checked: 2, steps only from a band, watch or ring
// (an older build took the app with the most steps, often the phone's own counter, and called it the band's); 3, an app
// build that takes a worn device's data as whole when its step records reach past the activity on both sides,
// a hole in its step records being standing still (told by activitySources, which came in the same build)
const RANGES_KEY = "motusHealthRanges";
const rangesVersion = () => (typeof plugin()?.activitySources === "function" ? 3 : 2);
const rangesFrom = () => new Date(Date.now() - RANGES_DAYS * DAY_MS);
/** Whether a session started inside the look-back that syncs and pull to refresh ask about (older ones are never checked) */
export const inRangesWindow = (startedAt: string) => Date.parse(startedAt) >= rangesFrom().getTime();
// Sessions the band had nothing for, once they ended more than 3 days ago (it has synced by then, or never will), so a
// session without band data isn't read from Health Connect on every sync. Kept per account on this phone.
const checkedIds = () => new Set(readJson<Record<string, string[]>>(CHECKED_KEY, {})[key()] ?? []);
const rememberChecked = (ids: string[]) => {
  if (!ids.length) return;
  const all = readJson<Record<string, string[]>>(CHECKED_KEY, {});
  all[key()] = [...new Set([...(all[key()] ?? []), ...ids])].slice(-CHECKED_MAX);
  writeJson(CHECKED_KEY, all);
};

// Every session in the look-back can be dozens of sessions, each read from Health Connect, too much for each look in the
// minute-by-minute stretch after one: those ask about the last day's sessions only (the one just finished among them),
// and the whole look-back at most this often. A pending recheck always reads it whole, so it isn't marked done early.
const ALL_RANGES_MS = 10 * 60_000;
let allRangesAt = 0;
async function readRanges(all: Date, recent = false): Promise<RangesAdded | undefined> {
  if (typeof plugin()?.readRanges !== "function") return undefined; // an app build from before
  const versions = readJson<Record<string, number>>(RANGES_KEY, {});
  const version = rangesVersion(), recheck = (versions[key()] ?? 0) < version;
  const quick = recent && !recheck && Date.now() - allRangesAt < ALL_RANGES_MS;
  const from = quick ? new Date(Date.now() - DAY_MS) : all;
  const out = await readRangesFrom(from, recheck, version);
  if (!quick) allRangesAt = Date.now();
  return out;
}
async function readRangesFrom(from: Date, recheck: boolean, version: number): Promise<RangesAdded | undefined> {
  // band: this phone's app build reads what the band measured during an activity, so every activity without those
  // numbers yet is asked about (also ones that already have heart rate); an older build would be asked about them on
  // every sync for nothing. Told by the build: the changes list came in the same one.
  const band = canChanges();
  const got = await api.get<{ ranges: Range[] }>("/health/ranges", { from: from.toISOString(), ...(recheck ? { recheck: 1 } : {}), ...(band ? { band: 1 } : {}) });
  const checked = recheck ? new Set<string>() : checkedIds();
  const done = () => { if (recheck) writeJson(RANGES_KEY, { ...readJson<Record<string, number>>(RANGES_KEY, {}), [key()]: version }); };
  const ranges = (got.ranges ?? []).filter((x) => !checked.has(x.id));
  if (!ranges.length) { done(); return undefined; }
  const { results } = await plugin().readRanges({ ranges }) as { results: RangeResult[] };
  if (!results?.length) { done(); return undefined; }
  const settled = new Set(ranges.filter((x) => Date.now() - Date.parse(x.end) > SETTLE_MS).map((x) => x.id));
  const out = await api.post<RangesAdded>("/health/ranges", { results, ...(recheck ? { recheck: true } : {}) });
  // marked only after the server took the results, and only for a session the band had no heart rate for: one it covered
  // has its steps and band numbers in by then (the engine took them, or never will), and would otherwise stay listed for
  // its heart rate and be read again on every sync until it falls out of the 30 days
  rememberChecked(results.filter((x) => settled.has(x.id) && !x.hr?.length).map((x) => x.id));
  done();
  return out;
}

// How often Motus reads while it is on screen, chosen per phone (Health Connect is the phone's): minutes, or "pull" for
// only on pull to refresh and Sync now. 10 minutes by default: close to the 15 it always was, and a look in between
// costs one call when nothing is new.
export type ReadEvery = "1" | "10" | "30" | "60" | "pull";
// spelled out as "Every minute", "Every hour" and the schedule editor; they fit the 56% of a phone's width a field next
// to a row's text gets
export const READ_EVERY: { value: ReadEvery; label: string; hint?: string }[] = [
  { value: "1", label: "Every minute" }, { value: "10", label: "Every 10 minutes" }, { value: "30", label: "Every 30 minutes" },
  { value: "60", label: "Every hour" }, { value: "pull", label: "Only on refresh", hint: "When you pull down to refresh or tap Sync now" },
];
const EVERY_KEY = "motusHealthEvery";
const stored = readStr(EVERY_KEY, "10") as ReadEvery;
export const readEvery = ref<ReadEvery>(READ_EVERY.some((o) => o.value === stored) ? stored : "10");
export function setReadEvery(v: ReadEvery) { readEvery.value = v; writeStr(EVERY_KEY, v); }

// A full read asks Health Connect a few dozen times (each kind over the last day or two, heart rate, sessions, then the
// sessions recorded in Motus), too much once a minute. In between, its changes list says in one call whether any app
// wrote something; the full read runs only then, or once this long has passed anyway: Motus's side changes too (a
// workout recorded, a day set back to the band's value). An app build from before has no changes list: full reads only.
const FULL_MS = 15 * 60_000, TICK_MS = 60_000, SLACK_MS = 10_000, BACKOFF_MAX_MS = 60 * 60_000;
const canChanges = () => typeof plugin()?.changes === "function";
let mark: { key: string; token: string } | null = null;
async function markChanges() {
  if (!canChanges()) return;
  try { const r = await plugin().changes({}); mark = r.token ? { key: key(), token: r.token } : null; } catch { mark = null; }
}
/** Whether Health Connect holds something new since the last full read; true when it can't tell (also when the look
 *  fails, a permission taken back or an expired token: the full read then says what is wrong, or starts a new mark). */
async function changedSince(): Promise<boolean> {
  if (!mark || mark.key !== key()) return true;
  try {
    const r = await plugin().changes({ token: mark.token }) as Changes;
    mark = r.token ? { key: mark.key, token: r.token } : null;
    return r.changed;
  } catch { mark = null; return true; }
}

// Every record of every kind Motus reads, as Health Connect has it, saved by the engine with its times (POST
// /health/records, M-238). Each read saves the days since the last one (from a day before it, as a band hands days over
// late), then reaches further back a stretch at a time until the oldest record Health Connect holds (the back-fill), so
// one read never carries years of minute heart rate. Records written or deleted in Health Connect since (its changes
// list, from a token of its own kept here, so nothing is lost between reads or to a failed one) are read again or
// deleted there, also on days long past; so is a stretch whose import log entry was taken back (restore). A server
// account's records go straight to the server (api/replica.ts): offline, nothing moves on, and Health Connect still has
// them for the next read. Each read says which phone sent it (source, an id made once per install): the engine takes
// out only this phone's own records for being missing from a read, never what another phone (or this one before Motus
// was installed again) sent.
// Kept per account on this phone: to (where the last read reached), back (how far back the back-fill got), oldest,
// perms (what was allowed then), token (the changes list), deleted and touched (from it, still to do, never dropped:
// the token has moved past them), redone (restores read again, key@restoredAt).
interface Changes { changed: boolean; token: string; deleted?: string[]; touched?: number[]; more?: boolean; expired?: boolean }
interface RecState { to?: number; back?: number; oldest?: number | null; perms?: string; token?: string; deleted: string[]; touched: number[]; redone?: string[] }
interface Waiting { key: string; restoredAt: string; from: string; to: string }
const RECORDS_KEY = "motusHealthRecords", INSTALL_KEY = "motusInstallId", REC_CHUNK_MS = 2 * DAY_MS, REC_FIRST_MS = 2 * DAY_MS, REC_BACK_MS = 30 * DAY_MS,
  REC_PENDING_MAX = 20_000, REC_REDONE_MAX = 500;
const recState = (): RecState => ({ deleted: [], touched: [], ...(readJson<Record<string, RecState>>(RECORDS_KEY, {})[key()] ?? {}) });
const saveRecState = (st: RecState) => { const all = readJson<Record<string, RecState>>(RECORDS_KEY, {}); all[key()] = st; writeJson(RECORDS_KEY, all); };
function installId() {
  let id = readStr(INSTALL_KEY, "");
  if (!id) { id = crypto.randomUUID(); writeStr(INSTALL_KEY, id); }
  return id;
}
// touched holds days, so stays small; deleted is kept from growing past REC_PENDING_MAX by not asking for more meanwhile
function noteChanges(st: RecState, r: Changes) {
  st.deleted = [...new Set([...st.deleted, ...(r.deleted ?? [])])];
  st.touched = [...new Set([...st.touched, ...(r.touched ?? []).map((t) => Math.floor((t * 1000) / DAY_MS) * DAY_MS)])];
}
async function syncRecords(perms: string) {
  if (typeof plugin()?.records !== "function") return; // an app build from before
  const iso = (t: number) => new Date(t).toISOString();
  const source = installId();
  const save = async (a: number, b: number) => {
    const data = await plugin().records({ from: iso(a), to: iso(b) });
    await api.post("/health/records", { ...data, tz: new Date().getTimezoneOffset(), source });
  };
  let st = recState();
  // a kind (or past data) allowed since isn't in the back-fill already done, nor in the changes token's kinds: both
  // start over (the engine adds nothing twice)
  if (st.perms !== perms) { st.perms = perms; st.back = undefined; st.oldest = undefined; st.token = undefined; saveRecState(st); }
  // Health Connect's changes list since the last read, a part at a time (more); the token moves on only with what it
  // gave, saved together, and stays when a look fails. While as many deletions wait as are kept, the token stays where
  // it is and the rest comes on a later read, once those are sent. An expired token lost what changed in between: the
  // back-fill starts over, as for a kind allowed since, and reads everything again (a complete read takes out what is gone).
  if (canChanges()) {
    try {
      for (let i = 0; i < 10 && recState().deleted.length < REC_PENDING_MAX; i++) {
        const had = st.token, r = await plugin().changes(had ? { token: had } : {}) as Changes;
        st = recState();
        if (had) noteChanges(st, r);
        if (r.expired) { st.back = undefined; st.oldest = undefined; }
        st.token = r.token || undefined; saveRecState(st);
        if (!had || !r.more || r.expired) break;
      }
    } catch (e) { console.warn("Health Connect changes", e); }
  }
  st = recState();
  const now = Date.now(), start = st.to ? st.to - OVERLAP_MS : now - REC_FIRST_MS;
  // deleted in Health Connect, as many at once as the engine takes; only those sent leave the list
  while (st.deleted.length) {
    const gone = st.deleted.slice(0, HEALTH_DELETED_MAX), sent = new Set(gone);
    await api.post("/health/records", { from: iso(now), to: iso(now), types: {}, deleted: gone, source });
    st = recState(); st.deleted = st.deleted.filter((x) => !sent.has(x)); saveRecState(st);
  }
  // days written to there that the read below doesn't reach (at most 30 a read), up to where it starts
  for (const d of st.touched.filter((t) => t < start).sort((a, b) => a - b).slice(0, 30)) {
    await save(d, Math.min(d + DAY_MS, start));
    st = recState(); st.touched = st.touched.filter((t) => t !== d); saveRecState(st);
  }
  st = recState(); st.touched = st.touched.filter((t) => t < start); saveRecState(st);
  // what was taken back in the import log and isn't here again (the import above brought its numbers back)
  try {
    for (const w of (await api.get<{ items: Waiting[] }>("/health/records/waiting")).items) {
      const tag = `${w.key}@${w.restoredAt}`;
      if (st.redone?.includes(tag)) continue;
      await save(Date.parse(w.from), Date.parse(w.to));
      st = recState(); st.redone = [...(st.redone ?? []), tag].slice(-REC_REDONE_MAX); saveRecState(st);
    }
  } catch (e) { console.warn("Health Connect records taken back", e); }
  // the days since the last read
  for (let a = start; a < now; a += REC_CHUNK_MS) {
    const b = Math.min(now, a + REC_CHUNK_MS);
    await save(a, b);
    st = recState(); st.to = b; st.back ??= start; saveRecState(st);
  }
  // the back-fill, down to the oldest record Health Connect holds (asked again while it had none)
  st = recState();
  if (st.oldest == null && typeof plugin()?.oldest === "function") {
    const o = await plugin().oldest() as { at?: string };
    st.oldest = o.at ? Date.parse(o.at) : null; saveRecState(st);
  }
  const stop = Math.max(st.oldest ?? (st.back ?? now), (st.back ?? now) - REC_BACK_MS);
  for (let b = st.back ?? now; b > stop; b -= REC_CHUNK_MS) {
    const a = Math.max(stop, b - REC_CHUNK_MS);
    await save(a, b);
    st = recState(); st.back = a; saveRecState(st);
  }
}

let watching = false, looking = false, failures = 0, retryAt = 0, lookedAt = 0;
// While a workout or a recording runs, and for a while after one ends, the look is every minute whatever the chosen
// time: the band hands over the session's heart rate when it next syncs, and it should show on the session soon after.
// A look is one call when nothing is new (the changes list), so this stays cheap. "Only on refresh" still means never.
const AFTER_MS = 30 * 60_000;
let fastUntil = 0, healthOn: () => boolean = () => false;
const sessionLive = () => [...readers.values()].some((r) => r.users > 0);
/** Reads on open, when the app comes back and on a timer while it stays on screen, as often as chosen and while the
 *  feature is on (on() says so at that moment). Nothing while hidden. */
export function watchHealth(on: () => boolean) {
  if (!healthSupported() || watching) return;
  watching = true; healthOn = on;
  let timer: ReturnType<typeof setInterval> | undefined;
  const tick = async () => {
    const chosen = readEvery.value === "pull" ? 0 : Number(readEvery.value) * 60_000;
    const every = chosen && (sessionLive() || Date.now() < fastUntil) ? TICK_MS : chosen;
    // faster than chosen: the stretch after a session, where a read asks about recent sessions only (readRanges)
    const recent = every < chosen;
    if (!every || !on() || document.visibilityState !== "visible" || syncing.value || looking) return;
    // due once the chosen time has passed since the last read, or since the last look that found nothing new (or found
    // nothing allowed yet)
    const now = Date.now(), last = lastSync.value ? Date.parse(lastSync.value) : 0;
    if (now < retryAt || now - Math.max(last, lookedAt) < every - SLACK_MS) return;
    looking = true;
    try {
      if (!(now - last < FULL_MS - SLACK_MS && canChanges() && !(await changedSince()))) await syncHealth({ recent });
      failures = 0; lookedAt = now;
    } catch {
      // Health Connect refused (often its limit on reads) or the server is away: wait twice as long each time, up to an
      // hour; pull to refresh and Sync now still read, and say what went wrong
      failures++; retryAt = Date.now() + Math.min(every * 2 ** failures, BACKOFF_MAX_MS);
    } finally { looking = false; }
  };
  // a look each minute is only a clock check unless a read is due
  const visible = () => {
    clearInterval(timer); timer = undefined;
    if (document.visibilityState !== "visible") return;
    void tick();
    timer = setInterval(() => void tick(), TICK_MS);
  };
  document.addEventListener("visibilitychange", visible);
  watch(readEvery, () => { retryAt = 0; lookedAt = 0; void tick(); });
  setTimeout(visible, 3000);
}

let afterQueued: Promise<unknown> | null = null;
/** A workout or an activity was just saved (finished, recorded or logged by hand): a full read now, so its heart rate
 *  fills in as soon as the band has synced it, then a look every minute for a while (watchHealth). After a read already
 *  going, since that one asked about the sessions before this was saved; one such read at a time. Quiet: it fails as
 *  any background read does, and not at all when the feature is off, set to only on refresh or Health Connect is
 *  refusing reads for now. */
export function syncAfterSession() {
  if (!healthSupported() || !healthOn() || readEvery.value === "pull") return;
  fastUntil = Date.now() + AFTER_MS;
  if (afterQueued || Date.now() < retryAt) return;
  const go = async () => {
    while (running) await running.catch(() => null);
    try { await syncHealth(); lookedAt = Date.now(); } catch { /* the next look tries again */ }
  };
  afterQueued = go().finally(() => { afterQueued = null; });
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
