// App-wide panels that any screen can open.
import { ref } from "vue";

export const startOpen = ref(false);
export const appearanceOpen = ref(false);
/** The exercise sheet (what it is, how to do it, history), opened from anywhere */
export const exerciseSheet = ref<string | null>(null);
/** The note sheet: where the note goes and what it says */
export const noteSheet = ref<null | { targets: { type: string; id: string; label: string; scopeRoutineId?: string | null }[]; workoutId?: string | null; edit?: any }>(null);
/** The reminder sheet */
export const reminderSheet = ref<null | { targetType: "exercise" | "routine"; targetId: string; label: string; scopeRoutineId?: string | null; workoutId?: string | null; preset?: { body?: string; weightKg?: number } }>(null);
export const activitySheet = ref<null | { id?: string; type?: string }>(null);
export const bodySheet = ref(false);
