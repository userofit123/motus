// App-wide panels that any screen can open.
import { ref } from "vue";

export const startOpen = ref(false);
export const appearanceOpen = ref(false);
/** The exercise sheet (what it is, how to do it, history), opened from anywhere */
export const exerciseSheet = ref<string | null>(null);
/** The note sheet: where the note goes and what it says */
export const noteSheet = ref<null | { targets: { type: string; id: string; label: string; scopeRoutineId?: string | null }[]; workoutId?: string | null; edit?: any }>(null);
/** The reminder sheet */
export const reminderSheet = ref<null | { targetType: "exercise" | "routine"; targetId: string; label: string; scopeRoutineId?: string | null; routineName?: string; routineFirst?: boolean; workoutId?: string | null; preset?: { body?: string; weightKg?: number } }>(null);
export const activitySheet = ref<null | { id?: string; type?: string }>(null);
/** The body sheet: true for weight, or a measure's id to open on the measurements with that one ready */
export const bodySheet = ref<boolean | string>(false);
/** The daily log sheet: steps, sleep, water, mood */
export const dailySheet = ref(false);
/** The schedule editor, opened from anywhere (a routine's ⋮ menu); an existing schedule to edit it, or just the routine to plan */
export const scheduleSheet = ref<null | { id?: string; routineId?: string | null; activityType?: string | null; rule?: string; [key: string]: unknown }>(null);
/** The earlier versions of a routine (its id) */
export const versionsSheet = ref<string | null>(null);
