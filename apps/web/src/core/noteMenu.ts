// A note's ⋮ menu, one source for every list of notes (an exercise's, a routine's) so they cannot drift apart.
import { api } from "../api/client";
import { useChange } from "../api/queries";
import { toast } from "./toast";
import { noteSheet } from "./ui";
import type { MenuItem } from "../components/Menu.vue";

export function useNoteMenu() {
  const del = useChange(async (id: string) => { await api.del(`/notes/${id}`); toast("Note deleted"); }, ["notes"]);
  const pin = useChange(async (n: any) => { await api.put(`/notes/${n.id}`, { pinned: !n.pinned }); toast(n.pinned ? "Note kept on record only" : "Note shows in every workout"); }, ["notes"]);
  /** label: what the note is about, shown in the note sheet when editing it */
  return (n: any, label: string): MenuItem[] => [
    { label: "Edit", icon: "edit", run: () => (noteSheet.value = { targets: [{ type: n.targetType, id: n.targetId, label }], edit: n }) },
    // only a note on an exercise can come up in a workout
    { label: n.pinned ? "Stop showing in workouts" : "Show in every workout", icon: "pin", hidden: n.targetType !== "exercise" && n.targetType !== "routine_exercise", run: () => pin.run(n) },
    { label: "Delete", icon: "trash", danger: true, sep: true, run: () => del.run(n.id) },
  ];
}
