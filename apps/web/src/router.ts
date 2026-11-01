import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
  routes: [
    { path: "/", name: "home", component: () => import("./pages/HomePage.vue") },
    { path: "/history", name: "history", component: () => import("./pages/HistoryPage.vue") },
    { path: "/routines", name: "routines", component: () => import("./pages/RoutinesPage.vue") },
    { path: "/routines/:id", name: "routine", component: () => import("./pages/RoutinePage.vue") },
    { path: "/routines/:id/edit", name: "routine-edit", component: () => import("./pages/RoutineEditor.vue") },
    { path: "/routines/:id/start", name: "preview", component: () => import("./pages/PreviewPage.vue") },
    { path: "/workout", name: "workout", component: () => import("./workout/ActiveWorkout.vue") },
    { path: "/workouts/:id", name: "workout-detail", component: () => import("./pages/WorkoutPage.vue") },
    { path: "/log", name: "log", component: () => import("./pages/LogWorkoutPage.vue") },
    { path: "/exercises", name: "exercises", component: () => import("./pages/ExercisesPage.vue") },
    { path: "/exercises/:id", name: "exercise", component: () => import("./pages/ExercisePage.vue") },
    { path: "/goals", name: "goals", component: () => import("./pages/GoalsPage.vue") },
    { path: "/stats", name: "stats", component: () => import("./pages/StatsPage.vue") },
    { path: "/activities/record", name: "record", component: () => import("./pages/RecordActivity.vue") },
    { path: "/activities/:id", name: "activity", component: () => import("./pages/ActivityPage.vue") },
    { path: "/body", name: "body", component: () => import("./pages/BodyPage.vue") },
    { path: "/more", name: "more", component: () => import("./pages/MorePage.vue") },
    { path: "/settings/:section?", name: "settings", component: () => import("./pages/SettingsPage.vue") },
    { path: "/:rest(.*)", redirect: "/" },
  ],
});
