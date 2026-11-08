// The routine's ⋮ menu, one source for the Routines list and the routine's own page so they cannot drift apart.
import { useRouter } from "vue-router";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { useSettings } from "../api/queries";
import { confirm, prompt, choose } from "./ask";
import { toast, toastError } from "./toast";
import { saveFile } from "./saveFile";
import { noteSheet, reminderSheet, scheduleSheet, versionsSheet } from "./ui";
import type { Folder, Routine } from "@motus/shared";
import type { MenuItem } from "../components/Menu.vue";

export type MenuRoutine = { id: string; name: string; pinned: boolean; archived: boolean };

export function useRoutineMenu() {
  const router = useRouter(), settings = useSettings();
  async function moveTo(r: MenuRoutine) {
    const fs = await api.get<Folder[]>("/folders");
    const v = await choose(`Move ${r.name} to`, [...fs.map((f) => ({ label: f.name, value: f.id })), { label: "No folder", value: "" }, { label: "New folder…", value: "__new" }]);
    if (v == null) return;
    let fid: string | null = v || null;
    if (v === "__new") { const name = await prompt("New folder"); if (!name) return; fid = (await api.post("/folders", { name })).id; }
    await api.put(`/routines/${r.id}`, { folderId: fid }); invalidate(["routines"]);
    toast(fid ? "Routine moved" : "Routine taken out of its folder");
  }
  async function del(r: MenuRoutine, page: boolean) {
    if (!(await confirm(`Delete ${r.name}?`, { text: "Its past workouts stay in your history.", ok: "Delete", danger: true }))) return;
    await api.del(`/routines/${r.id}`);
    invalidate(["routines", "home"]);
    toast("Routine deleted", { action: { label: "Undo", run: async () => { await api.post(`/routines/${r.id}/restore`); invalidate(["routines", "home"]); } } });
    if (page) router.push("/routines");
  }
  const set = (r: MenuRoutine, b: Partial<Pick<Routine, "pinned" | "archived" | "folderId">>, msg: string) => api.put(`/routines/${r.id}`, b).then(() => { invalidate(["routines"]); toast(msg); }).catch(toastError);
  // in groups, a line between each: doing it, changing it, tidying the list, its past and copies elsewhere, then Delete on its own
  /** page: the menu on the routine's own page, which already has a Start button and leaves the page when the routine goes. */
  return (r: MenuRoutine, page = false): MenuItem[] => [
    { label: "Start", icon: "play", hidden: page, run: () => router.push(`/routines/${r.id}/start`) },
    { label: "Schedule", icon: "calendar", run: () => (scheduleSheet.value = { routineId: r.id }) },
    { label: "Remind me next time", icon: "bell", run: () => (reminderSheet.value = { targetType: "routine", targetId: r.id, label: r.name }) },
    { label: "Edit", sep: true, icon: "edit", run: () => router.push(`/routines/${r.id}/edit`) },
    { label: "Duplicate", icon: "copy", run: async () => { try { const x = await api.post(`/routines/${r.id}/duplicate`); invalidate(["routines"]); toast("Routine duplicated"); if (page) router.push(`/routines/${x.id}`); } catch (e) { toastError(e); } } },
    { label: "New routine based on this", icon: "layers", run: async () => { const n = await prompt("Name the new routine", { value: r.name + " v2", ok: "Create", text: "A copy you can change; this one stays as it is." }); if (n) { const x = await api.post("/routines", { fromRoutineId: r.id, name: n }); invalidate(["routines"]); toast(`${n} created`); router.push(`/routines/${x.id}/edit`); } } },
    { label: "Add a note", icon: "note", run: () => (noteSheet.value = { targets: [{ type: "routine", id: r.id, label: r.name }] }) },
    { label: r.pinned ? "Unpin" : "Pin to top", sep: true, icon: "pin", run: () => set(r, { pinned: !r.pinned }, r.pinned ? "Routine unpinned" : "Routine pinned to top") },
    { label: "Move to folder", icon: "folder", run: () => moveTo(r) },
    { label: r.archived ? "Restore from archive" : "Archive", icon: "archive", run: () => set(r, { archived: !r.archived }, r.archived ? "Routine restored" : "Routine archived") },
    { label: "Earlier versions", sep: true, icon: "history", run: () => (versionsSheet.value = r.id) },
    { label: "Send a copy to…", icon: "share", hidden: !settings.value.features.sharing, run: async () => { const u = await prompt("Send a copy to", { placeholder: "Their username on this server" }); if (u) { try { await api.post("/share/routine", { routineId: r.id, username: u }); toast(`Sent to ${u}`); } catch (e) { toastError(e); } } } },
    { label: "Export", icon: "download", run: async () => { try { const full = await api.get<Routine>(`/routines/${r.id}`); await saveFile(new Blob([JSON.stringify({ motusRoutine: 1, ...full }, null, 2)], { type: "application/json" }), `${r.name}.motusroutine`); } catch (e) { toastError(e); } } },
    { label: "Delete", icon: "trash", danger: true, sep: true, run: () => del(r, page) },
  ];
}
