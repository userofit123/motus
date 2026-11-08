// One text for a reminder everywhere it shows: its body, plus the exact weight × reps of a "Ready for more weight"
// reminder, which are kept in kg in the action and shown in the person's unit.
export function reminderText(r: any, fmt: { wu_: (kg: number) => string }): string {
  const a = r?.action;
  if (a?.setWeightKg == null) return r?.body ?? "";
  return `${r.body} · ${fmt.wu_(a.setWeightKg)}${a.setReps != null ? ` × ${a.setReps}` : ""}`;
}
