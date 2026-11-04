// What can be logged on the body and set as a goal. Weight is stored in kg, body fat in %, every
// circumference in cm (shown in the person's length unit). The list follows the usual coach / tracker
// tape-measure set; arms, forearms, thighs and calves are logged per side because sides often differ.
export type BodyUnit = "kg" | "%" | "cm";
export interface BodyMeasure {
  id: string;
  name: string;
  unit: BodyUnit;
  /** the direction a new goal suggests when there is nothing logged yet to say where you start from (the person picks; this is only the first choice shown) */
  goal: "up" | "down";
  /** paired measures: the shared name ("Upper arm") and which side this one is */
  pair?: string;
  side?: "left" | "right";
  /** where to put the tape, so entries stay comparable */
  how?: string;
  /** kept so older entries still show; not offered for new ones */
  old?: boolean;
}

const sides = (id: string, pair: string, goal: "up" | "down", how: string): BodyMeasure[] =>
  (["left", "right"] as const).map((side) => ({ id: `${id}_${side[0]}`, name: `${pair} (${side})`, unit: "cm", goal, pair, side, how }));

export const BODY_MEASURES: BodyMeasure[] = [
  { id: "weight", name: "Body weight", unit: "kg", goal: "down" },
  { id: "body_fat", name: "Body fat", unit: "%", goal: "down" },
  { id: "neck", name: "Neck", unit: "cm", goal: "up", how: "Just below the Adam's apple" },
  { id: "shoulders", name: "Shoulders", unit: "cm", goal: "up", how: "Around the widest point, arms relaxed" },
  { id: "chest", name: "Chest", unit: "cm", goal: "up", how: "Across the nipples, after breathing out" },
  { id: "waist", name: "Waist", unit: "cm", goal: "down", how: "At the navel, relaxed, after breathing out" },
  { id: "hips", name: "Hips", unit: "cm", goal: "down", how: "Around the widest part of the buttocks" },
  ...sides("arm", "Upper arm", "up", "Flexed, around the peak of the biceps"),
  ...sides("forearm", "Forearm", "up", "Around the widest part, fist clenched"),
  ...sides("thigh", "Thigh", "up", "Just below the buttock crease, standing"),
  ...sides("calf", "Calf", "up", "Around the widest part, standing"),
  { id: "arm", name: "Arm", unit: "cm", goal: "up", old: true },
  { id: "thigh", name: "Thigh", unit: "cm", goal: "up", old: true },
];

export const bodyMeasure = (kind: string | null | undefined): BodyMeasure | undefined => BODY_MEASURES.find((m) => m.id === (kind || "weight"));
/** "Upper arm (left)", or the kind tidied up for anything unknown */
export const bodyName = (kind: string) => bodyMeasure(kind)?.name ?? kind.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
export const bodyUnit = (kind: string | null | undefined): BodyUnit => bodyMeasure(kind)?.unit ?? "cm";

/** The direction a new body goal suggests: up if you're below the target, down if above; with nothing logged, the usual way for that measure.
 *  Only a suggestion: the person chooses, and the goal keeps that choice. */
export function bodyGoalDirection(kind: string | null | undefined, target: number, latest?: number | null): ">=" | "<=" {
  if (latest != null && Number.isFinite(latest)) return latest < target ? ">=" : "<=";
  return bodyMeasure(kind)?.goal === "up" ? ">=" : "<=";
}

/** Neutral names for the two directions a body goal can take: no "lose" or "get down to", since the right way depends on the person. */
export const GOAL_DIRECTIONS: { value: ">=" | "<="; label: string }[] = [{ value: ">=", label: "Increase" }, { value: "<=", label: "Decrease" }];

/** The tape and body-fat measures offered for new entries (everything but weight), in the order they are shown. */
export const TAPE_MEASURES = BODY_MEASURES.filter((m) => m.id !== "weight" && !m.old);

/** The daily log: one value per calendar day. Not body measurements: steps go with activity, sleep, water and mood with
 *  how the day went, so they live in their own sheet and card rather than in the body log. Each belongs to a feature. */
export interface DailyKind { id: string; name: string; unit: string; step: number; feature: "steps" | "dailyLog"; icon: string }
export const DAILY_KINDS: DailyKind[] = [
  { id: "steps", name: "Steps", unit: "", step: 500, feature: "steps", icon: "steps" },
  { id: "sleep_h", name: "Sleep", unit: "h", step: 0.5, feature: "dailyLog", icon: "moon" },
  { id: "water_ml", name: "Water", unit: "ml", step: 250, feature: "dailyLog", icon: "water" },
  { id: "mood", name: "Mood", unit: "1-5", step: 1, feature: "dailyLog", icon: "smile" },
];
