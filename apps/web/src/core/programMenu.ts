// The program's ⋮ menu, one source for the Programs list and the program's own page so they cannot drift apart.
import { useRouter } from "vue-router";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { confirm } from "./ask";
import { toast, toastError } from "./toast";
import { localYmd } from "./format";
import { programStartSheet } from "./ui";
import type { Program } from "@motus/shared";
import type { MenuItem } from "../components/Menu.vue";

export function useProgramMenu() {
  const router = useRouter();
  const put = async (p: Program, body: Record<string, unknown>, msg: string) => { try { await api.put(`/programs/${p.id}`, body); invalidate(["routines", "home"]); toast(msg); } catch (e) { toastError(e); } };
  async function restart(p: Program) {
    if (await confirm("Start again from week 1?", { text: "From today. Workouts done before stay in your history but no longer count towards this program.", ok: "Start again" }))
      await put(p, { startDate: localYmd(new Date()), active: true }, "Program starts again from week 1");
  }
  async function del(p: Program, page: boolean) {
    if (!(await confirm(`Delete ${p.name}?`, { text: "Its routines and workouts stay.", ok: "Delete", danger: true }))) return;
    await api.del(`/programs/${p.id}`); invalidate(["routines", "home"]); toast("Program deleted");
    if (page) router.push("/routines");
  }
  /** edit: opens the program editor, which each screen keeps for itself; page: the program's own page, which it leaves when the program goes. */
  const items = (p: Program, o: { edit: () => void; page?: boolean }): MenuItem[] => {
    const finished = !!p.state.total && !!p.state.finished, today = localYmd(new Date()), start = p.startDate.slice(0, 10);
    // the same week count the server uses: 0 before the start date, 1 in the first week
    const week = today < start ? 0 : Math.floor((Date.parse(today) - Date.parse(start)) / (7 * 86400000)) + 1;
    return [
      { label: "Pause", icon: "pause", hidden: finished || !p.active, run: () => put(p, { active: false }, "Program paused") },
      { label: "Resume", icon: "play", hidden: finished || p.active || !p.state.total, run: () => put(p, { active: true }, "Program resumed") },
      { label: "Start again from week 1", icon: "refresh", hidden: !p.state.done && week === 1, run: () => restart(p) },
      { label: "Edit", icon: "edit", sep: true, run: o.edit },
      { label: "Change start date", icon: "calendar", run: () => (programStartSheet.value = { id: p.id, startDate: start }) },
      { label: "Delete", icon: "trash", danger: true, sep: true, run: () => del(p, !!o.page) },
    ];
  };
  // restart too: a finished program's page offers it as its main button
  return { items, restart };
}
