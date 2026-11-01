// A person's settings, with defaults. Stored as JSON per user; missing keys fall back to these.
import type { WeightUnit, DistanceUnit, LengthUnit } from "./units";
import { FEATURE_DEFAULTS } from "./features";

export interface WorkoutPrefs {
  prefillFromLast: boolean;
  prefillScope: "any" | "routine";
  autoRest: boolean;
  restBetweenSetsS: number;
  restAfterExerciseS: number;
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
  weeklyGoal: number;
  stepGoal: number;
  home: { cards: string[] };
  features: Record<string, boolean>;
  notifications: { scheduled: boolean; goals: boolean; updates: boolean; inactivity: boolean };
  backup: { on: boolean; every: "workout" | "daily" | "weekly"; at: string; keep: number; encrypt: boolean; media: boolean };
  updates: { autoCheck: boolean; autoDownload: boolean; wifiOnly: boolean; channel: "stable" | "beta" };
  layout: "auto" | "desktop" | "phone";
  sound: string;
  profile: { heightCm: number | null; birthYear: number | null; sex: "" | "male" | "female" };
  gyms: { id: string; name: string; equipment: string[] }[];
  activeGym: string | null;
}

export const HOME_CARDS_DEFAULT = ["stats", "resume", "upnext", "previous", "goals"];
export const HOME_CARDS_OPTIONAL = ["volume", "walking", "bodyweight", "records", "reminders", "feed", "muscles", "achievements"];

export const DEFAULT_SETTINGS: Settings = {
  units: { system: "metric", weight: "kg", distance: "km", length: "cm" },
  firstDay: 0,
  dateFormat: "dmy",
  clock: "24",
  workout: {
    prefillFromLast: true, prefillScope: "any", autoRest: true, restBetweenSetsS: 90, restAfterExerciseS: 150, countdown: true,
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
  home: { cards: HOME_CARDS_DEFAULT },
  features: FEATURE_DEFAULTS,
  notifications: { scheduled: true, goals: true, updates: true, inactivity: false },
  backup: { on: true, every: "daily", at: "03:00", keep: 14, encrypt: false, media: true },
  updates: { autoCheck: true, autoDownload: true, wifiOnly: false, channel: "stable" },
  layout: "auto",
  sound: "chime",
  profile: { heightCm: null, birthYear: null, sex: "" },
  gyms: [],
  activeGym: null,
};

/** Deep-merges saved settings over the defaults, so new settings get their default value. */
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
  return merge(DEFAULT_SETTINGS, saved);
}
