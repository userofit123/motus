// Health Connect in the Android app (Settings → Features → Health Connect): reads what other apps on the phone wrote
// there (a band through Gadgetbridge, a scale, a watch) and hands it to the engine (POST /health/import), which keeps
// typed values and never adds the same thing twice. Read when the app opens or comes back to the screen, at most every
// 15 minutes, and from Settings → Integrations by hand.
import { ref } from "vue";
import { TOPICS } from "@motus/shared";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { readJson, writeJson } from "../core/prefs";
import { accounts } from "./accounts";

type Kind = "steps" | "sleep" | "weight" | "sessions" | "heartRate";
// history: Motus may read further back than 30 days; historyAvailable: this phone's Health Connect can allow that at all
// (someone who allowed Motus before past data could be asked for has historyAvailable but not history until connect() again)
export interface HealthStatus { available: "yes" | "update" | "no"; granted: Kind[]; history: boolean; historyAvailable: boolean }
/** What the plugin's read() hands over, passed to POST /health/import as it is */
export interface HealthData {
  steps: { date: string; value: number }[]; sleep: { date: string; hours: number }[]; weight: { id: string; at: string; kg: number }[];
  sessions: { id: string; type: string; title: string; start: string; end: string; avgHr?: number; distanceM?: number; steps?: number; calories?: number }[];
}
export interface HealthResult { steps: number; sleep: number; weight: number; activities: number }

const plugin = () => (globalThis as any).Capacitor?.Plugins?.MotusHealth;
export const healthSupported = () => !!plugin() && (globalThis as any).Capacitor?.getPlatform?.() === "android";

// per account on this phone: when it last read Health Connect (a server account's other phones keep their own)
const KEY = "motusHealthSync";
const key = () => accounts.active ?? "web";
export const lastSync = ref<string | null>(readJson<Record<string, string>>(KEY, {})[key()] ?? null);
const remember = (at: string) => { const all = readJson<Record<string, string>>(KEY, {}); all[key()] = at; writeJson(KEY, all); lastSync.value = at; };

export const healthStatus = async (): Promise<HealthStatus> => healthSupported() ? plugin().status() : { available: "no", granted: [], history: false, historyAvailable: false };
export const connectHealth = async (): Promise<HealthStatus> => plugin().connect();
export const openHealthSettings = () => plugin()?.openSettings();

// the first read goes back 30 days (as far as Health Connect lets a newly allowed app see); later ones overlap a day,
// since a band often hands over yesterday's sleep and steps only when it next connects
const FIRST_DAYS = 30, OVERLAP_MS = 86_400_000;
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
    const from = past ?? (lastSync.value ? new Date(Date.parse(lastSync.value) - OVERLAP_MS) : new Date(Date.now() - FIRST_DAYS * 86_400_000));
    const data: HealthData = await plugin().read({ from: from.toISOString() });
    const r = await api.post<HealthResult>("/health/import", data);
    // a read of the past also reads up to now, so the next one may start here; never earlier than a read already done
    if (!lastSync.value || started > lastSync.value) remember(started);
    if (r.steps || r.sleep || r.activities || r.weight) invalidate([...TOPICS.health]);
    return r;
  } finally { syncing.value = false; running = null; }
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
