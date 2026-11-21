// The program's ⋮ menu, one source for the Programs list and the program's own page so they cannot drift apart.
import { useRouter } from "vue-router";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { confirm } from "./ask";
import { toast, toastError } from "./toast";
import { localYmd } from "./format";
import { programStartSheet } from "./ui";
import type { Program, ProgramDetail } from "@motus/shared";
import type { MenuItem } from "../components/Menu.vue";

export function useProgramMenu() {
  const router = useRouter();
  const put = async (p: Program, body: Record<string, unknown>, msg: string) => { try { await api.put(`/programs/${p.id}`, body); invalidate(["routines", "home"]); toast(msg); } catch (e) { toastError(e); } };
  // a program with a date starts again today, counting only workouts from now on (restart); one with no date stays
  // without one and waits for its next first workout
  async function restart(p: Program) {
    const when = p.startDate ? "From today." : "From the next time you do its first workout.";
    if (await confirm("Start again from week 1?", { text: `${when} Workouts done before stay in your history but no longer count towards this program.`, ok: "Start again" }))
      await put(p, p.startDate ? { startDate: localYmd(new Date()), restart: true, active: true } : { restart: true, active: true }, "Program starts again from week 1");
  }
  async function del(p: Program, page: boolean) {
    if (!(await confirm(`Delete ${p.name}?`, { text: "Its routines and workouts stay.", ok: "Delete", danger: true }))) return;
    await api.del(`/programs/${p.id}`); invalidate(["routines", "home"]); toast("Program deleted");
    if (page) router.push("/routines?tab=programs");
  }
  /** edit: opens the program editor, which each screen keeps for itself; add: the program's page opens its Add routines
   *  sheet (only there); page: the program's own page, which it leaves when the program goes. */
  const items = (p: Program, o: { edit: () => void; add?: () => void; page?: boolean }): MenuItem[] => {
    const finished = !!p.state.total && !!p.state.finished;
    return [
      { label: "Pause", icon: "pause", hidden: finished || !p.active, run: () => put(p, { active: false }, "Program paused") },
      { label: "Resume", icon: "play", hidden: finished || p.active || !p.state.total, run: () => put(p, { active: true }, "Program resumed") },
      { label: "Start again from week 1", icon: "refresh", hidden: !p.state.done && p.calendarWeek <= 1, run: () => restart(p) },
      { label: "Add routines", icon: "plus", sep: true, hidden: !o.add, run: () => o.add?.() },
      { label: "Edit", icon: "edit", sep: !o.add, run: o.edit },
      { label: p.startDate ? "Change start date" : "Set start date", icon: "calendar", run: () => (programStartSheet.value = { id: p.id, startDate: p.startDate, startsOn: p.startsOn }) },
      { label: "Delete", icon: "trash", danger: true, sep: true, run: () => del(p, !!o.page) },
    ];
  };
  // restart too: a finished program's page offers it as its main button
  return { items, restart };
}

type Week = Program["weeks"][number];
/** The weeks that get a routine added from the program's page: every week but the rest weeks (all of them while none has a routine yet). */
export const addWeeks = (weeks: Week[]) => (weeks.some((w) => w.days.length) ? weeks.filter((w) => w.days.length) : weeks);

/**
 * Adds a routine to the end of every week but the rest weeks (Add routines, and a new routine made from the program's
 * page). Reads the program fresh, so routines added one after another all land; returns the confirmation to show.
 */
export async function addToProgram(programId: string, routineId: string, name: string): Promise<string> {
  const p = await api.get<ProgramDetail>(`/programs/${programId}`, { tz: new Date().getTimezoneOffset() });
  const to = addWeeks(p.weeks);
  const weeks = p.weeks.map((w) => (to.includes(w) ? { ...w, days: [...w.days, routineId] } : w));
  await api.put(`/programs/${programId}`, { weeks });
  invalidate(["routines", "home"]);
  if (to.length === p.weeks.length) return p.weeks.length === 1 ? `Added ${name} to ${p.name}` : `Added ${name} to all ${p.weeks.length} weeks of ${p.name}`;
  return `Added ${name} to ${to.length} of ${p.weeks.length} weeks of ${p.name}, not the rest weeks`;
}

/**
 * A week with one workout moved from one place to another. A day chosen by hand (which workout counts, or skipped) is
 * kept by its place in the week, so it moves along with its routine.
 */
export function moveDay(w: Week, from: number, to: number): Week {
  const order = w.days.map((_, i) => i);
  order.splice(to, 0, order.splice(from, 1)[0]!);
  const marks = w.marks ? Object.fromEntries(order.flatMap((old, i) => (w.marks![old + 1] ? [[String(i + 1), w.marks![old + 1]!]] : []))) : undefined;
  return { ...w, days: order.map((i) => w.days[i]!), ...(marks ? { marks } : {}) };
}
