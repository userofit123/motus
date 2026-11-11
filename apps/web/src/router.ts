import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  history: createWebHistory(),
  // scroll once the new page has started coming in (see the shells). Going Back returns
  // to where you were: the page's data may still be arriving, so wait (up to 2 s) until it is tall enough to scroll there
  scrollBehavior: (to, from, saved) => to.path === from.path ? undefined : new Promise((ok) => {
    const t0 = Date.now();
    const ready = () => !saved || document.documentElement.scrollHeight - innerHeight >= saved.top - 2 || Date.now() - t0 > 2000;
    const tick = () => (ready() ? ok(saved ?? { top: 0 }) : requestAnimationFrame(tick));
    setTimeout(tick, 130);
  }),
  routes: [
    { path: "/", name: "home", component: () => import("./pages/HomePage.vue") },
    { path: "/history", name: "history", component: () => import("./pages/HistoryPage.vue") },
    { path: "/routines", name: "routines", component: () => import("./pages/RoutinesPage.vue") },
    { path: "/routines/:id", name: "routine", component: () => import("./pages/RoutinePage.vue") },
    { path: "/routines/:id/edit", name: "routine-edit", component: () => import("./pages/RoutineEditor.vue") },
    { path: "/routines/:id/start", name: "preview", component: () => import("./pages/PreviewPage.vue") },
    { path: "/programs/:id", name: "program", component: () => import("./pages/ProgramPage.vue") },
    { path: "/workout", name: "workout", component: () => import("./workout/ActiveWorkout.vue") },
    // "Empty workout": plan the exercises first, in the routine editor
    { path: "/workout/plan", name: "workout-plan", component: () => import("./pages/RoutineEditor.vue") },
    { path: "/workouts/:id", name: "workout-detail", component: () => import("./pages/WorkoutPage.vue") },
    { path: "/log", name: "log", component: () => import("./pages/LogWorkoutPage.vue") },
    { path: "/exercises", name: "exercises", component: () => import("./pages/ExercisesPage.vue") },
    { path: "/exercises/:id", name: "exercise", component: () => import("./pages/ExercisePage.vue") },
    { path: "/goals", name: "goals", component: () => import("./pages/GoalsPage.vue") },
    { path: "/stats", name: "stats", component: () => import("./pages/StatsPage.vue") },
    { path: "/timer", name: "timer", component: () => import("./pages/IntervalTimerPage.vue") },
    { path: "/activities/record", name: "record", component: () => import("./pages/RecordActivity.vue") },
    { path: "/activities/:id", name: "activity", component: () => import("./pages/ActivityPage.vue") },
    { path: "/body", name: "body", component: () => import("./pages/BodyPage.vue") },
    { path: "/more", name: "more", component: () => import("./pages/MorePage.vue") },
    { path: "/settings/updates", redirect: "/settings/versions" }, // the old name of App & Versions
    { path: "/settings/profile", redirect: "/settings/account" }, // Profile was folded into Account; body facts moved to the Body page
    { path: "/settings/:section?", name: "settings", component: () => import("./pages/SettingsPage.vue") },
    { path: "/:rest(.*)", redirect: "/" },
  ],
});

// A page's code is fetched the first time it is opened. After an update the files of the old version are gone, so a
// copy of the app still running the old version can't fetch them and the move would just not happen. Open the page
// with a full load instead, which brings the new version; but only once a minute, so a server that is away can't
// keep reloading the app (the move then fails as before and the error stays in the console).
router.onError((err, to) => {
  if (!/dynamically imported module|module script failed|Loading chunk|Unable to preload CSS/i.test(String((err as Error)?.message ?? err))) return;
  try {
    if (Date.now() - Number(sessionStorage.getItem("motus.pageReload") ?? 0) < 60_000) return;
    sessionStorage.setItem("motus.pageReload", String(Date.now()));
  } catch { return; /* storage blocked: no way to tell a first try from a loop, so leave it */ }
  location.assign(to.fullPath);
});
