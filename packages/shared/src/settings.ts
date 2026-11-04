// A person's settings, with defaults. Stored as JSON per user; missing keys fall back to these.
import type { WeightUnit, DistanceUnit, LengthUnit } from "./units";
import { FEATURE_DEFAULTS } from "./features";
import type { RestByKind } from "./types";
import type { RestDefaults } from "./training";
import { cleanIntervalPresets, type IntervalPreset } from "./intervals";

export interface WorkoutPrefs {
  prefillFromLast: boolean;
  prefillScope: "any" | "routine";
  autoRest: boolean;
  restEndNext: boolean; // when the rest ends, go straight on to the next set instead of showing "Rest over"
  restBetweenSetsS: number;
  restAfterExerciseS: number;
  restByKindS: RestByKind;
  sessionNotice: boolean; // the workout in progress as a notification
  countdown: boolean;
  sound: boolean;
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
  updateRoutine: "ask" | "always" | "never";
}

export interface Settings {
  units: { system: "metric" | "imperial"; weight: WeightUnit; distance: DistanceUnit; length: LengthUnit };
  firstDay: 0 | 1;
  dateFormat: "dmy" | "mdy" | "ymd";
  clock: "24" | "12";
  workout: WorkoutPrefs;
  increments: { kg: number; lb: number };
  barKg: number;
  platesKg: number[];
  platesLb: number[];
  e1rm: "epley" | "brzycki";
  /** the old fixed weekly target; it became the "Weekly target" goal and is only read once, to give that goal to people who already used it */
  weeklyGoal: number;
  stepGoal: number;
  /** the work week (Sunday = 0); null: from the first day of the week, Sunday to Thursday or Monday to Friday */
  workdays: number[] | null;
  /** sections: Home's blocks in the order shown, each shown or hidden (Customise home).
   *  hidden: Home suggestions you dismissed (key → when), hidden until your next workout.
   *  goals: the goals shown as blocks at the top of Home, in order, each with or without its streak beside it */
  home: { sections: HomeSection[]; hidden: Record<string, string>; goals: { id: string; streak: boolean }[] };
  /** the order of your goals on the Goals page (Reorder goals); goals not in it follow, newest first */
  goalsOrder: string[];
  features: Record<string, boolean>;
  notifications: { scheduled: boolean; goals: boolean; updates: boolean; inactivity: boolean };
  backup: { on: boolean; every: "workout" | "daily" | "weekly"; at: string; keep: number; encrypt: boolean; media: boolean };
  updates: { autoCheck: boolean; autoDownload: boolean; wifiOnly: boolean; channel: "stable" | "beta" };
  layout: "auto" | "desktop" | "phone";
  sound: string;
  profile: { heightCm: number | null; birthYear: number | null; sex: "" | "male" | "female" };
  gyms: { id: string; name: string; equipment: string[] }[];
  activeGym: string | null;
  /** the quick tags offered when writing a note; difficulty has its own row, so none of these say how hard it was */
  noteTags: string[];
  /** the interval timer's saved setups (feature "intervalTimer"); empty: the starting ones are offered */
  intervals: IntervalPreset[];
}

export interface HomeSection { id: string; on: boolean }
/** Every Home section, in the default order; `on` is whether a new account sees it. Ids added later are appended to a saved
 *  order, so a new section shows up on everyone's Home (or in Customise home, if it starts off). */
export const HOME_SECTIONS: HomeSection[] = [
  { id: "goalBlocks", on: true }, { id: "time", on: true }, { id: "condition", on: true },
  { id: "program", on: true },
  { id: "upnext", on: true }, { id: "suggest", on: true }, { id: "previous", on: true },
  { id: "goals", on: true },
  { id: "volume", on: false }, { id: "walking", on: false }, { id: "bodyweight", on: false }, { id: "daily", on: false },
  { id: "reminders", on: false }, { id: "feed", on: false }, { id: "muscles", on: false }, { id: "achievements", on: false },
];
/** Home's sections made safe (they sync from any device): unknown ids and repeats dropped, missing ones appended with their default.
 *  `legacyCards` is the older list of switched-on cards, read when no order was saved yet. */
export function cleanHomeSections(saved: unknown, legacyCards?: unknown): HomeSection[] {
  const known = new Map(HOME_SECTIONS.map((x) => [x.id, x.on]));
  const out: HomeSection[] = [];
  const seen = new Set<string>();
  if (Array.isArray(saved)) {
    for (const x of saved) {
      const item: { id?: unknown; on?: unknown } = x && typeof x === "object" ? x : {};
      const id = item.id;
      if (typeof id !== "string" || !known.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, on: typeof item.on === "boolean" ? item.on : known.get(id)! });
    }
  }
  // before sections had an order, the optional cards and Goals were switched on by being in this list
  const cards = !Array.isArray(saved) && Array.isArray(legacyCards) ? new Set(legacyCards) : null;
  for (const d of HOME_SECTIONS) if (!seen.has(d.id)) out.push({ id: d.id, on: cards && (d.id === "goals" || !d.on) ? cards.has(d.id) : d.on });
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
    prefillFromLast: true, prefillScope: "any", autoRest: true, restEndNext: true, restBetweenSetsS: 90, restAfterExerciseS: 150, restByKindS: {}, sessionNotice: true, countdown: true,
    sound: true, vibrate: true, warn10: true, voice: false, keepAwake: true, lockScreen: true, showWarmups: true, autoAdvance: true,
    showPrevious: true, showReminders: true, confirmSkip: false, updateRoutine: "ask",
  },
  increments: { kg: 2.5, lb: 5 },
  barKg: 20,
  platesKg: [25, 20, 15, 10, 5, 2.5, 1.25],
  platesLb: [45, 35, 25, 10, 5, 2.5],
  e1rm: "epley",
  weeklyGoal: 3,
  stepGoal: 8000,
  workdays: null,
  home: { sections: HOME_SECTIONS, hidden: {}, goals: [] },
  goalsOrder: [],
  features: FEATURE_DEFAULTS,
  notifications: { scheduled: true, goals: true, updates: true, inactivity: false },
  backup: { on: true, every: "daily", at: "03:00", keep: 14, encrypt: false, media: true },
  updates: { autoCheck: true, autoDownload: true, wifiOnly: false, channel: "stable" },
  layout: "auto",
  sound: "chime",
  profile: { heightCm: null, birthYear: null, sex: "" },
  gyms: [],
  activeGym: null,
  noteTags: NOTE_TAGS_DEFAULT,
  intervals: [],
};

/** Deep-merges saved settings over the defaults, so new settings get their default value. */
/** The person's rest defaults, for restAfterSet */
export const restDefaultsOf = (w: WorkoutPrefs): RestDefaults => ({ betweenSetsS: w.restBetweenSetsS, afterExerciseS: w.restAfterExerciseS, byKindS: w.restByKindS });

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
  const { cards, ...home } = out.home as Settings["home"] & { cards?: unknown };
  const savedHome = saved && typeof saved === "object" ? (saved as Record<string, unknown>).home : undefined;
  const savedSections = savedHome && typeof savedHome === "object" ? (savedHome as Record<string, unknown>).sections : undefined;
  out.home = { ...home, sections: cleanHomeSections(savedSections, cards) };
  return out;
}

/** The work week: chosen in Settings, else Sunday to Thursday when weeks start on Sunday, Monday to Friday otherwise. */
export const workdaysOf = (s: Pick<Settings, "workdays" | "firstDay">): number[] => s.workdays?.length ? s.workdays : s.firstDay === 0 ? [0, 1, 2, 3, 4] : [1, 2, 3, 4, 5];
/** The days of the week a daily goal counts on (Sunday = 0). */
export const goalDaysOf = (days: unknown, s: Pick<Settings, "workdays" | "firstDay">): number[] =>
  days === "workdays" ? workdaysOf(s) : Array.isArray(days) && days.length ? days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [0, 1, 2, 3, 4, 5, 6];
