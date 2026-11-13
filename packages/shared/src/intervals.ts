// The interval timer (feature "intervalTimer"): work and rest in rounds, optionally repeated as sets with a longer
// rest between them (HIIT, Tabata, circuits). Pure maths here; the clock that runs it lives in the web app.
// Where you are is worked out from how long the timer has run, never by counting ticks, so it stays right after the
// phone sleeps or the tab is in the background.
import { duration } from "./units";

export interface IntervalConfig {
  prepS: number; // a lead-in before the first round, to get in place
  workS: number;
  restS: number; // 0: straight on to the next round
  rounds: number; // per set
  sets: number;
  setRestS: number; // between sets, instead of the last round's rest
  sounds?: IntervalSounds; // the sound at the start of each part; missing: the usual ones (INTERVAL_SOUNDS_DEFAULT)
}
/** A saved setup, kept in the person's settings (`intervals`) so it is on every device. */
export interface IntervalPreset extends IntervalConfig { id: string; name: string }

export type IntervalKind = "prep" | "work" | "rest" | "setRest";
export interface IntervalPhase { kind: IntervalKind; durS: number; round: number; set: number }

/** The built-in sounds, all made from the app's own beep (no audio files to ship). New ids go before "none" so the
 *  ones saved in presets keep working; the later ones are soft alarms (gentle, but meant to be noticed), then the
 *  ringing bells, bowl and deep gong the rest timer also offers. */
export const INTERVAL_SOUNDS = ["beep", "double", "triple", "high", "low", "rising", "softAlarm", "chime", "marimba", "pulse", "gong", "digital", "wake", "handBell", "shipBell", "tubular", "temple", "bowl", "deepGong", "none"] as const;
export type IntervalSound = (typeof INTERVAL_SOUNDS)[number];
/** A sound for the start of each part, and "done" for the end of the whole run. */
export type IntervalSounds = Record<IntervalKind | "done", IntervalSound>;
/** The cues the timer has always played, so setups saved before sounds could be chosen sound the same. */
export const INTERVAL_SOUNDS_DEFAULT: IntervalSounds = { prep: "beep", work: "double", rest: "low", setRest: "low", done: "triple" };

export const INTERVAL_DEFAULT: IntervalConfig = { prepS: 10, workS: 40, restS: 20, rounds: 8, sets: 1, setRestS: 60 };
/** Starting setups shown before any are saved. */
export const INTERVAL_STARTERS: IntervalPreset[] = [
  { id: "tabata", name: "Tabata", prepS: 10, workS: 20, restS: 10, rounds: 8, sets: 1, setRestS: 60 },
  { id: "hiit", name: "HIIT 40/20", ...INTERVAL_DEFAULT },
  { id: "emom", name: "Every minute (EMOM)", prepS: 10, workS: 60, restS: 0, rounds: 10, sets: 1, setRestS: 60 },
];

const int = (v: unknown, min: number, max: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
/** Anything typed or synced, made safe to run. */
export function cleanInterval(c: Partial<IntervalConfig>): Required<IntervalConfig> {
  const d = INTERVAL_DEFAULT;
  return {
    prepS: int(c.prepS, 0, 600, d.prepS), workS: int(c.workS, 1, 3600, d.workS), restS: int(c.restS, 0, 3600, d.restS),
    rounds: int(c.rounds, 1, 99, d.rounds), sets: int(c.sets, 1, 20, d.sets), setRestS: int(c.setRestS, 0, 3600, d.setRestS),
    sounds: cleanSounds(c.sounds),
  };
}
/** Each part's sound if it is one of ours, else the usual one for that part. */
export function cleanSounds(v: unknown): IntervalSounds {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {}, out = { ...INTERVAL_SOUNDS_DEFAULT };
  for (const k of Object.keys(out) as (keyof IntervalSounds)[]) {
    const x = o[k];
    if (typeof x === "string" && (INTERVAL_SOUNDS as readonly string[]).includes(x)) out[k] = x as IntervalSound;
  }
  return out;
}

export const INTERVAL_PRESETS_MAX = 50;
export const INTERVAL_NAME_MAX = 60;
/** The saved setups as synced: only ones with an id and a name, each id once, every setup made safe to run. */
export function cleanIntervalPresets(list: unknown): IntervalPreset[] {
  if (!Array.isArray(list)) return [];
  const out: IntervalPreset[] = [], seen = new Set<string>();
  for (const x of list) {
    if (!x || typeof x !== "object") continue;
    const { id, name } = x as { id?: unknown; name?: unknown };
    if (typeof id !== "string" || !id || seen.has(id) || typeof name !== "string") continue;
    const n = name.trim().slice(0, INTERVAL_NAME_MAX);
    if (!n) continue;
    seen.add(id);
    out.push({ id, name: n, ...cleanInterval(x as Partial<IntervalConfig>) });
    if (out.length >= INTERVAL_PRESETS_MAX) break;
  }
  return out;
}

/** Every phase in order. The last round of a set rests for setRestS instead (none after the very last round). */
export function intervalPhases(cfg: IntervalConfig): IntervalPhase[] {
  const c = cleanInterval(cfg), out: IntervalPhase[] = [];
  if (c.prepS > 0) out.push({ kind: "prep", durS: c.prepS, round: 1, set: 1 });
  for (let s = 1; s <= c.sets; s++) {
    for (let r = 1; r <= c.rounds; r++) {
      out.push({ kind: "work", durS: c.workS, round: r, set: s });
      const lastRound = r === c.rounds, lastSet = s === c.sets;
      if (lastRound && lastSet) continue;
      if (lastRound) { if (c.setRestS > 0) out.push({ kind: "setRest", durS: c.setRestS, round: r, set: s }); }
      else if (c.restS > 0) out.push({ kind: "rest", durS: c.restS, round: r, set: s });
    }
  }
  return out;
}

export const intervalTotalS = (phases: IntervalPhase[]) => phases.reduce((a, p) => a + p.durS, 0);

/** The whole setup in a sentence or two, so "rest" vs "rest between sets" needs no guessing; parts that are 0 are left out.
 *  "10s to get ready, then 8 rounds of 40s work and 20s rest. Repeat for 3 sets with 1m rest between sets." */
export function intervalSummary(cfg: IntervalConfig): string {
  const c = cleanInterval(cfg);
  const prep = c.prepS ? `${duration(c.prepS)} to get ready, then ` : "";
  // a single round has no rest after it, so its rest is left out
  const rest = c.restS && c.rounds > 1 ? ` and ${duration(c.restS)} rest` : "";
  const rounds = `${c.rounds} ${c.rounds === 1 ? "round" : "rounds"} of ${duration(c.workS)} work${rest}.`;
  const sets = c.sets > 1 ? ` Repeat for ${c.sets} sets${c.setRestS ? ` with ${duration(c.setRestS)} rest between sets` : ""}.` : "";
  return `${prep}${rounds}${sets}`;
}

/** Where the timer is after runMs of running: the phase index (phases.length when done) and the ms left in it. */
export function intervalAt(phases: IntervalPhase[], runMs: number): { index: number; leftMs: number } {
  let t = Math.max(0, runMs);
  for (let i = 0; i < phases.length; i++) {
    const d = phases[i]!.durS * 1000;
    if (t < d) return { index: i, leftMs: d - t };
    t -= d;
  }
  return { index: phases.length, leftMs: 0 };
}
