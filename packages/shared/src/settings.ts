// A person's settings, with defaults. Stored as JSON per user; missing keys fall back to these.
import type { WeightUnit, DistanceUnit, LengthUnit } from "./units";
import { FEATURE_DEFAULTS } from "./features";
import type { ProgressionMode, RestByKind } from "./types";

/** Settings' Progression as saved (see Settings.progression): a weight step is null until chosen, so its default
 * follows the weight unit (progressionDefaultsOf) instead of a kg default being kept after switching to pounds. */
export interface ProgressionSettings { mode: ProgressionMode; repsMin: number; repsMax: number; stepKg: number | null; stepOneSideKg: number | null; lowerAfter: number }
/** Settings' Progression with the weight steps worked out, what the maths and the screens use. */
export interface ProgressionDefaults extends ProgressionSettings { stepKg: number; stepOneSideKg: number }
import type { RestDefaults } from "./training";
import { cleanIntervalPresets, type IntervalPreset } from "./intervals";

/** The workout's sounds (Settings → Workout defaults → Workout sounds). The rest over sound (`cueSound`) plays when a
 *  rest or a timed set ends: the short ones three times, the ones that ring out (bells, gongs, the bowl) and the tunes
 *  once. The countdown sound (`tickSound`) is the note of the 10 seconds warning, the 3-2-1 and a timed set's start: one
 *  of TICK_SOUNDS, the ones with a single-note form (a ringing one plays there as a single short strike that has faded
 *  before the next second); the Android app plays these too (RestCues.java). The tunes are the interval timer's, so
 *  both timers offer the same sounds (apps/web core/sounds.ts). Ids stay as saved. */
export const TICK_SOUNDS = ["beep", "bell", "soft", "digital", "wood", "click", "handBell", "shipBell", "tubular", "temple", "bowl", "gong"] as const;
export type TickSound = (typeof TICK_SOUNDS)[number];
export const WORKOUT_SOUNDS = [...TICK_SOUNDS, "double", "triple", "high", "rising", "chime", "pulse", "softAlarm", "wake", "smallGong"] as const;
export type WorkoutSound = (typeof WORKOUT_SOUNDS)[number];
/** The sounds there were while one choice played both the rest over and the countdown (see withDefaults). */
const FIRST_SOUNDS: readonly unknown[] = ["beep", "bell", "soft", "digital", "wood"];
/** A cue sound and volume as saved anywhere (also a workout's own override), made safe. */
export const cleanWorkoutSound = (v: unknown): WorkoutSound => ((WORKOUT_SOUNDS as readonly unknown[]).includes(v) ? (v as WorkoutSound) : "beep");
export const cleanTickSound = (v: unknown): TickSound => ((TICK_SOUNDS as readonly unknown[]).includes(v) ? (v as TickSound) : "beep");
export const cleanCueVolume = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(10, Math.round(v))) : 100);

export interface WorkoutPrefs {
  autoRest: boolean;
  restEndNext: boolean; // when the rest ends, go straight on to the next set instead of showing "Rest over"
  restBetweenSetsS: number;
  restAfterExerciseS: number;
  restByKindS: RestByKind;
  restStretchBetweenS: number; // a stretch's rests (isStretch): back into position, then on to the next stretch
  restStretchAfterS: number;
  sessionNotice: boolean; // the workout in progress as a notification
  countdown: boolean;
  sound: boolean; // every workout sound (rest over, 10 seconds, 3-2-1, timed sets, rep timer); off: none of them
  cueSound: WorkoutSound; // the rest over sound (also a timed set's end)
  tickSound: TickSound; // the countdown sound: 10 seconds, 3-2-1, a timed set's start, the rep timer
  cueVolume: number; // 10-100, % of full level, for every sound the app plays itself
  vibrate: boolean;
  warn10: boolean;
  voice: boolean;
  keepAwake: boolean;
  lockScreen: boolean;
  showWarmups: boolean;
  autoAdvance: boolean;
  showPrevious: boolean;
  showReminders: boolean;
  confirmSkip: boolean;
}

export interface Settings {
  units: { system: "metric" | "imperial"; weight: WeightUnit; distance: DistanceUnit; length: LengthUnit };
  firstDay: 0 | 1;
  dateFormat: "dmy" | "mdy" | "ymd";
  clock: "24" | "12";
  workout: WorkoutPrefs;
  /** the weight step of the steppers */
  increments: { kg: number; lb: number };
  /** Progression's defaults for every routine exercise without its own: the mode, the rep range, the weight step (kg)
   * for exercises done both sides together and for one side at a time, and missed workouts in a row before the weight
   * goes down a step (0: never) */
  progression: ProgressionSettings;
  barKg: number;
  platesKg: number[];
  platesLb: number[];
  e1rm: "epley" | "brzycki";
  /** the work week (Sunday = 0); null: from the first day of the week, Sunday to Thursday or Monday to Friday */
  workdays: number[] | null;
  /** blocks: Home's blocks in the order shown, each shown or hidden (Edit home).
   *  hidden: Home suggestions you dismissed (key → when), hidden until your next workout.
   *  goals: the goals pinned to Home as their own blocks, in order, each with or without its streak */
  home: { blocks: HomeBlock[]; hidden: Record<string, string>; goals: { id: string; streak: boolean }[] };
  /** the order of your goals on the Goals page (Reorder goals); goals not in it follow, newest first */
  goalsOrder: string[];
  features: Record<string, boolean>;
  notifications: { scheduled: boolean; goals: boolean; updates: boolean; inactivity: boolean };
  backup: { on: boolean; every: "workout" | "daily" | "weekly"; at: string; keep: number; encrypt: boolean; media: boolean };
  updates: { autoCheck: boolean; autoDownload: boolean; wifiOnly: boolean };
  layout: "auto" | "desktop" | "phone";
  profile: { heightCm: number | null; birthYear: number | null; sex: "" | "male" | "female" };
  gyms: { id: string; name: string; equipment: string[] }[];
  activeGym: string | null;
  /** the quick tags offered when writing a note; difficulty has its own row, so none of these say how hard it was */
  noteTags: string[];
  /** the interval timer's saved setups (feature "intervalTimer"); empty: the starting ones are offered */
  intervals: IntervalPreset[];
}

export interface HomeBlock { id: string; on: boolean }
/** Every Home block, in the default order; `on` is whether a new account sees it. Blocks tied to a feature, or that only
 *  have something to say now and then (a workout in progress is part of Today; reminders, goals due soon, a program), stay
 *  in this list and simply don't draw while there's nothing to show. Ids added later are appended to a saved order. */
export const HOME_BLOCKS: HomeBlock[] = [
  { id: "today", on: true }, { id: "week", on: true },
  { id: "pinned", on: true }, { id: "dueSoon", on: true }, { id: "program", on: true },
  { id: "muscles", on: true }, { id: "upnext", on: true }, { id: "previous", on: true }, { id: "goals", on: true },
  { id: "suggest", on: true }, { id: "reminders", on: true },
  { id: "records", on: false }, { id: "feed", on: false }, { id: "daily", on: false }, { id: "achievements", on: false },
];
/** Home's blocks made safe (they sync from any device): unknown ids and repeats dropped, missing ones appended with their default. */
export function cleanHomeBlocks(saved: unknown): HomeBlock[] {
  const known = new Map(HOME_BLOCKS.map((x) => [x.id, x.on]));
  const out: HomeBlock[] = [];
  const seen = new Set<string>();
  if (Array.isArray(saved)) {
    for (const x of saved) {
      const item: { id?: unknown; on?: unknown } = x && typeof x === "object" ? x : {};
      const id = item.id;
      if (typeof id !== "string" || !known.has(id) || seen.has(id)) continue;
      seen.add(id);
      // Today is always shown: it has no switch in Edit home
      out.push({ id, on: id === "today" || (typeof item.on === "boolean" ? item.on : known.get(id)!) });
    }
  }
  for (const d of HOME_BLOCKS) if (!seen.has(d.id)) out.push({ ...d });
  return out;
}

/** The saved goal order made safe (it syncs from any device): ids only, each once. Ids of deleted goals are dropped by orderGoals. */
export function cleanGoalsOrder(saved: unknown): string[] {
  return Array.isArray(saved) ? [...new Set(saved.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64))] : [];
}
/** Goals in the saved order: the ones in `order` first, as listed, then the rest as they came (unknown ids are skipped). */
export function orderGoals<T extends { id: string }>(goals: T[], order: string[]): T[] {
  const at = new Map(order.map((id, i) => [id, i]));
  return goals.map((g, i) => ({ g, k: at.get(g.id) ?? order.length + i })).sort((a, b) => a.k - b.k).map((x) => x.g);
}

export const NOTE_TAGS_DEFAULT = ["Form", "Pain", "Setup", "Equipment", "Tempo", "Felt great", "Change next time"];

export const DEFAULT_SETTINGS: Settings = {
  units: { system: "metric", weight: "kg", distance: "km", length: "cm" },
  firstDay: 0,
  dateFormat: "dmy",
  clock: "24",
  workout: {
    autoRest: true, restEndNext: true, restBetweenSetsS: 90, restAfterExerciseS: 150, restByKindS: {}, restStretchBetweenS: 10, restStretchAfterS: 15,
    sessionNotice: true, countdown: true,
    sound: true, cueSound: "beep", tickSound: "beep", cueVolume: 100, vibrate: true, warn10: true, voice: false, keepAwake: true, lockScreen: true, showWarmups: true, autoAdvance: true,
    showPrevious: false, showReminders: true, confirmSkip: false,
  },
  increments: { kg: 2.5, lb: 5 },
  progression: { mode: "suggest", repsMin: 6, repsMax: 12, stepKg: null, stepOneSideKg: null, lowerAfter: 3 },
  barKg: 20,
  platesKg: [25, 20, 15, 10, 5, 2.5, 1.25],
  platesLb: [45, 35, 25, 10, 5, 2.5],
  e1rm: "epley",
  workdays: null,
  home: { blocks: HOME_BLOCKS, hidden: {}, goals: [] },
  goalsOrder: [],
  features: FEATURE_DEFAULTS,
  notifications: { scheduled: true, goals: true, updates: true, inactivity: false },
  backup: { on: true, every: "daily", at: "03:00", keep: 14, encrypt: false, media: true },
  updates: { autoCheck: true, autoDownload: true, wifiOnly: false },
  layout: "auto",
  profile: { heightCm: null, birthYear: null, sex: "" },
  gyms: [],
  activeGym: null,
  noteTags: NOTE_TAGS_DEFAULT,
  intervals: [],
};

/** Deep-merges saved settings over the defaults, so new settings get their default value. */
/** The person's rest defaults, for restAfterSet */
export const restDefaultsOf = (w: WorkoutPrefs): RestDefaults => ({ betweenSetsS: w.restBetweenSetsS, afterExerciseS: w.restAfterExerciseS, byKindS: w.restByKindS,
  stretchBetweenS: w.restStretchBetweenS, stretchAfterS: w.restStretchAfterS });

export function withDefaults(saved: unknown): Settings {
  const merge = (d: any, s: any): any => {
    if (Array.isArray(d)) return Array.isArray(s) ? s : d;
    if (d && typeof d === "object") {
      const o: any = { ...d };
      if (s && typeof s === "object") for (const k of Object.keys(s)) o[k] = k in d ? merge(d[k], s[k]) : s[k];
      return o;
    }
    return s === undefined ? d : s;
  };
  const out: Settings = merge(DEFAULT_SETTINGS, saved);
  // synced from any device, so made safe here before a screen or the timer uses them
  out.intervals = cleanIntervalPresets(out.intervals);
  out.goalsOrder = cleanGoalsOrder(out.goalsOrder);
  // the older Home's section list (and its list of cards before that) belonged to a different set of blocks: dropped, so
  // everyone starts from the new layout
  const { cards: _c, sections: _s, ...home } = out.home as Settings["home"] & { cards?: unknown; sections?: unknown };
  out.home = { ...home, blocks: cleanHomeBlocks(home.blocks) };
  // "After a workout, update its routine", "Start from what you did last time" and "Last time's numbers come from" are
  // gone: a routine always holds where you are now (its numbers follow each finished workout, then Progression), and
  // structure changes are only ever saved when ticked on the Finish screen, so the old choices mean nothing and are dropped
  const { updateRoutine: _u, prefillFromLast: _pl, prefillScope: _ps, ...workout } = out.workout as WorkoutPrefs & { updateRoutine?: unknown; prefillFromLast?: unknown; prefillScope?: unknown };
  // before there were two sounds the one chosen also played the countdown: kept for it until a countdown sound is chosen
  // (only one of the sounds of that time; a ringing rest over sound chosen since never became the countdown by itself)
  const savedTick = (saved as { workout?: { tickSound?: unknown } } | null)?.workout?.tickSound;
  const oldTick = FIRST_SOUNDS.includes(workout.cueSound) ? workout.cueSound : "beep";
  out.workout = { ...workout, cueSound: cleanWorkoutSound(workout.cueSound), tickSound: cleanTickSound(savedTick ?? oldTick), cueVolume: cleanCueVolume(workout.cueVolume) };
  // a top-level "sound" from the first version was never used (the cues' sound is workout.cueSound): dropped
  delete (out as Settings & { sound?: unknown }).sound;
  // the old fixed weekly and daily step targets, and the marks that the app had made its own starting goals from them:
  // goals took their place, made only by the person, so nothing reads them any more
  for (const k of ["weeklyGoal", "stepGoal", "goalsSeeded", "stepGoalSeeded"]) delete (out as unknown as Record<string, unknown>)[k];
  // the "Progression rules" feature switch went with them: Progression is always there, its mode Off when unwanted
  // (someone who had it switched off and never chose a mode gets Off, so nothing starts moving their weights)
  const savedMode = (saved as { progression?: { mode?: unknown } } | null)?.progression?.mode;
  if (out.features.progression === false && savedMode === undefined) out.progression.mode = "off";
  delete out.features.progression;
  const pm = out.progression.mode;
  const P = out.progression as Partial<ProgressionSettings>, D = DEFAULT_SETTINGS.progression;
  const int = (v: unknown, lo: number, hi: number, d: number) => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : d);
  // a step not chosen stays null (never the default saved in its place), so it keeps following the weight unit
  const kg = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 100 ? v : null);
  const repsMin = int(P.repsMin, 1, 100, D.repsMin), repsMax = int(P.repsMax, 1, 100, D.repsMax);
  out.progression = {
    mode: pm === "auto" || pm === "off" ? pm : "suggest",
    ...(repsMin <= repsMax ? { repsMin, repsMax } : { repsMin: D.repsMin, repsMax: D.repsMax }),
    stepKg: kg(P.stepKg), stepOneSideKg: kg(P.stepOneSideKg), lowerAfter: int(P.lowerAfter, 0, 10, 3),
  };
  return out;
}

/** Settings' Progression with a step not chosen worked out for the weight unit: 5 kg / 2.5 kg, and in pounds 10 lb / 5 lb
 * so a step lands on real plates. */
export function progressionDefaultsOf(s: Pick<Settings, "progression" | "units">): ProgressionDefaults {
  const lb = s.units.weight === "lb", LB_KG = 0.45359237, p = s.progression;
  return { ...p, stepKg: p.stepKg ?? (lb ? 10 * LB_KG : 5), stepOneSideKg: p.stepOneSideKg ?? (lb ? 5 * LB_KG : 2.5) };
}

/** The work week: chosen in Settings, else Sunday to Thursday when weeks start on Sunday, Monday to Friday otherwise. */
export const workdaysOf = (s: Pick<Settings, "workdays" | "firstDay">): number[] => s.workdays?.length ? s.workdays : s.firstDay === 0 ? [0, 1, 2, 3, 4] : [1, 2, 3, 4, 5];
/** The days of the week a daily goal counts on (Sunday = 0). */
export const goalDaysOf = (days: unknown, s: Pick<Settings, "workdays" | "firstDay">): number[] =>
  days === "workdays" ? workdaysOf(s) : Array.isArray(days) && days.length ? days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [0, 1, 2, 3, 4, 5, 6];
