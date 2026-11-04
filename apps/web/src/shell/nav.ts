// The pages in the menu (PLAN.md §8.1): seven on a computer, six tabs on the phone.
export const NAV = [
  { name: "home", label: "Home", icon: "home", to: "/" },
  { name: "history", label: "Calendar", icon: "calendar", to: "/history" },
  { name: "routines", label: "Routines", icon: "routines", to: "/routines" },
  { name: "exercises", label: "Exercises", icon: "dumbbell", to: "/exercises" },
  { name: "goals", label: "Goals", icon: "goals", to: "/goals" },
  { name: "stats", label: "Stats", icon: "stats", to: "/stats" },
  { name: "settings", label: "Settings", icon: "settings", to: "/settings" },
];
/** Which menu item a page belongs to */
export function section(routeName: string | undefined): string {
  const n = routeName ?? "";
  if (["routine", "routine-edit", "preview", "program"].includes(n)) return "routines";
  if (["workout-detail", "activity", "log", "record"].includes(n)) return "history";
  if (n === "exercise") return "exercises";
  return n;
}
