// A note's ⋮ menu, one source for every list of notes (an exercise's, a routine's) so they cannot drift apart.
import { api } from "../api/client";
import { useChange } from "../api/queries";
import { toast } from "./toast";
import { noteSheet } from "./ui";
import type { MenuItem } from "../components/Menu.vue";
import { TOPICS } from "@motus/shared";

// Where a note comes back, by note type. The note sheet and this menu both read it, so the wording and the set of
// types that can come back cannot drift apart. Any other type (a workout's or an activity's note) stays where it was written.
export const SHOWS: Record<string, string> = {
  exercise: "Shows in every workout with this exercise, in any routine", routine_exercise: "Shows when you do this exercise in this routine",
  routine: "Shows in every workout of this routine",
};

// every screen a note shows on, as the note sheet reloads them: a running workout shows its notes too
const NOTE_TOPICS = [...TOPICS.note];

export function useNoteMenu() {
  const del = useChange(async (id: string) => { await api.del(`/notes/${id}`); toast("Note deleted"); }, NOTE_TOPICS);
  const pin = useChange(async (n: any) => { await api.put(`/notes/${n.id}`, { pinned: !n.pinned }); toast(n.pinned ? "Note kept on record only" : SHOWS[n.targetType] ?? ""); }, NOTE_TOPICS);
  /** label: what the note is about, shown in the note sheet when editing it */
  return (n: any, label: string): MenuItem[] => [
    { label: "Edit", icon: "edit", run: () => (noteSheet.value = { targets: [{ type: n.targetType, id: n.targetId, label }], edit: n }) },
    // only a note on an exercise, an exercise in a routine or a routine can come up in a workout
    { label: n.pinned ? "Stop showing in workouts" : "Show in every workout", icon: "pin", hidden: !SHOWS[n.targetType], run: () => pin.run(n) },
    { label: "Delete", icon: "trash", danger: true, sep: true, run: () => del.run(n.id) },
  ];
}
