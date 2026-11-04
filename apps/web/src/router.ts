import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  history: createWebHistory(),
  // pages fade out before the next one comes in (see the shells), so scroll once the old page is gone. Going Back returns
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
