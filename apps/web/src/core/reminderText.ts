// One text for a reminder everywhere it shows: its body, plus the exact weight × reps of a "Ready for more weight"
// reminder, which are kept in kg in the action and shown in the person's unit.
export function reminderText(r: any, fmt: { wu_: (kg: number) => string }): string {
  const a = r?.action;
  if (a?.setWeightKg == null) return r?.body ?? "";
  return `${r.body} · ${fmt.wu_(a.setWeightKg)}${a.setReps != null ? ` × ${a.setReps}` : ""}`;
}

/** When it comes up, in a couple of words (the reminder line and its sheet say it the same way) */
export function reminderWhen(r: any, fmt: { date: (iso: string) => string }): string {
  return r?.trigger === "next" ? "Next time" : r?.trigger === "every" ? "Every time" : r?.trigger === "after_n" ? `After ${r.triggerN} sessions` : r?.trigger === "date" ? `From ${fmt.date(r.triggerDate)}` : "";
}

/** The change it makes to the numbers filled in for you, e.g. "+2.5 kg, +1 reps"; null when it only reminds.
 *  The exact weight of a "Ready for more weight" reminder is already in its text, so it isn't repeated here. */
export function reminderChange(r: any, fmt: { wu_: (kg: number) => string; clock: (s: number) => string }): string | null {
  const a = r?.action;
  if (!a) return null;
  const sign = (n: number) => (n > 0 ? "+" : "-");
  return [a.weightKg ? `${sign(a.weightKg)}${fmt.wu_(Math.abs(a.weightKg))}` : null, a.reps ? `${sign(a.reps)}${Math.abs(a.reps)} reps` : null, a.restS ? `rest ${fmt.clock(a.restS)}` : null].filter(Boolean).join(", ") || null;
}
