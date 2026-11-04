// Muscles: the library's names (free-exercise-db), the groups people think in, and the body-map regions.
export const MUSCLES = [
  "chest", "shoulders", "biceps", "triceps", "forearms", "lats", "middle back", "lower back", "traps", "neck",
  "abdominals", "quadriceps", "hamstrings", "glutes", "calves", "adductors", "abductors",
] as const;
export type Muscle = (typeof MUSCLES)[number];

export const GROUPS: { id: string; name: string; muscles: string[] }[] = [
  { id: "chest", name: "Chest", muscles: ["chest"] },
  { id: "back", name: "Back", muscles: ["lats", "middle back", "lower back", "traps"] },
  { id: "shoulders", name: "Shoulders", muscles: ["shoulders"] },
  { id: "arms", name: "Arms", muscles: ["biceps", "triceps", "forearms"] },
  { id: "core", name: "Core", muscles: ["abdominals"] },
  { id: "legs", name: "Legs", muscles: ["quadriceps", "hamstrings", "glutes", "calves", "adductors", "abductors"] },
  { id: "neck", name: "Neck", muscles: ["neck"] },
];
export const groupOf = (m: string) => GROUPS.find((g) => g.muscles.includes(m))?.id ?? "other";
export const muscleName = (m: string) => (m === "abdominals" ? "Abs" : m.replace(/\b\w/g, (c) => c.toUpperCase()));

/** Sets per muscle: a working set counts 1 for each primary muscle and 0.5 for each secondary one. */
export function muscleSets(rows: { primary: string[]; secondary: string[]; sets: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    for (const m of r.primary) out[m] = (out[m] ?? 0) + r.sets;
    for (const m of r.secondary) out[m] = (out[m] ?? 0) + r.sets * 0.5;
  }
  return out;
}

/** Which muscles a plan works: main where any exercise has it as a main muscle, helped where it only ever helps.
 * For a routine or a workout this reads better than amounts, where a busy helper would show up as a main muscle. */
export function musclesWorked(rows: { primary: string[]; secondary: string[] }[]): { primary: string[]; secondary: string[] } {
  const primary = new Set(rows.flatMap((r) => r.primary));
  return { primary: [...primary], secondary: [...new Set(rows.flatMap((r) => r.secondary))].filter((m) => !primary.has(m)) };
}

/** A sensible weekly target range of hard sets per muscle (used by the weekly-sets view) */
export const WEEKLY_SET_RANGE: [number, number] = [10, 20];

export const EQUIPMENT = ["barbell", "dumbbell", "cable", "machine", "kettlebells", "bands", "body only", "e-z curl bar", "medicine ball", "exercise ball", "foam roll", "other"];
export const CATEGORIES = ["strength", "stretching", "plyometrics", "powerlifting", "olympic weightlifting", "strongman", "cardio"];
