<script setup lang="ts">
// A reminder in full, opened by tapping it wherever it shows: what it says, what it's for, when it comes up and what it
// changes, with Dismiss. Closing the sheet keeps it. Dismissing marks it "dismissed" (the same as the Dismiss on a
// workout's reminder), so it stops coming up but stays in the history.
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { useExercises, useRoutines } from "../api/queries";
import { useFmt } from "../core/format";
import { toast, toastError } from "../core/toast";
import { exerciseSheet } from "../core/ui";
import { reminderText, reminderWhen, reminderChange } from "../core/reminderText";
import Sheet from "../components/Sheet.vue";
import Icon from "../components/Icon.vue";

const props = defineProps<{ o: { r: any; routineName?: string | null; gone?: () => void } }>();
const emit = defineEmits<{ close: [] }>();
const fmt = useFmt();
const router = useRouter(), route = useRoute();
const routines = useRoutines(), exercises = useExercises();
const r = computed(() => props.o.r);
const isEx = computed(() => r.value.targetType === "exercise");
const routineName = (rid: string) => routines.data.value?.find((x) => x.id === rid)?.name;
// a workout's copy of a reminder has no target name, so it is looked up
const name = computed(() => r.value.targetName || (isEx.value ? exercises.data.value?.find((e) => e.id === r.value.targetId)?.name : routineName(r.value.targetId)) || (isEx.value ? "An exercise" : "A routine"));
const forText = computed(() => {
  if (!isEx.value) return "Routine";
  if (!r.value.scopeRoutineId) return "Exercise, in any routine";
  return `Exercise, only in ${props.o.routineName || routineName(r.value.scopeRoutineId) || "one routine"}`;
});
const it = computed(() => (isEx.value ? "this exercise" : "this routine"));
const whenText = computed(() => {
  const x = r.value;
  if (x.trigger === "next") return `Once, the next time ${it.value} comes up`;
  if (x.trigger === "every") return `Each time ${it.value} comes up, until you dismiss it`;
  if (x.trigger === "after_n") return `Once ${it.value} has come up ${x.triggerN} times${x.seenN ? ` (${x.seenN} so far)` : ""}`;
  if (x.trigger === "date") return `The first time ${it.value} comes up on or after that day`;
  return "";
});
const change = computed(() => {
  const a = r.value.action;
  if (a?.setWeightKg != null) return { t: `${fmt.value.wu_(a.setWeightKg)}${a.setReps != null ? ` × ${a.setReps}` : ""}`, s: "Filled in for you when it comes up" };
  const c = reminderChange(r.value, fmt.value);
  return c ? { t: c, s: "Added to the numbers filled in for you" } : null;
});
const path = computed(() => (isEx.value ? `/exercises/${r.value.targetId}` : `/routines/${r.value.targetId}`));
const canOpen = computed(() => route.path !== path.value);
function openTarget() {
  if (!canOpen.value) return;
  exerciseSheet.value = null;
  emit("close");
  router.push(path.value);
}
const pending = computed(() => r.value.status == null || r.value.status === "pending" || r.value.status === "shown");

const busy = ref(false);
async function dismiss() {
  busy.value = true;
  try {
    await api.put(`/reminders/${r.value.id}`, { status: "dismissed" });
    invalidate(["reminders", "routines", "home", "exercises"]);
    props.o.gone?.();
    toast("Reminder dismissed");
    emit("close");
  } catch (e) { toastError(e); } finally { busy.value = false; }
}
</script>

<template>
  <Sheet title="Reminder" @close="emit('close')">
    <div class="rvh">
      <span class="oi"><Icon name="bell" /></span>
      <div class="grow">
        <div class="rvt">{{ reminderText(r, fmt) }}</div>
        <div class="tiny">{{ r.createdAt ? `Set ${fmt.ago(r.createdAt)}` : "Reminder" }}{{ pending ? "" : r.status === "done" ? " · done" : " · dismissed" }}</div>
      </div>
    </div>
    <div class="list">
      <div class="li" :class="{ click: canOpen }" @click="openTarget">
        <Icon :name="isEx ? 'dumbbell' : 'routines'" class="muted" />
        <div class="grow"><div class="t">{{ name }}</div><div class="s">{{ forText }}</div></div>
        <Icon v-if="canOpen" name="right" :size="16" class="muted" />
      </div>
      <div v-if="whenText" class="li">
        <Icon name="clock" class="muted" />
        <div class="grow"><div class="t">{{ reminderWhen(r, fmt) }}</div><div class="s">{{ whenText }}</div></div>
      </div>
      <div v-if="change" class="li">
        <Icon name="scale" class="muted" />
        <div class="grow"><div class="t">{{ change.t }}</div><div class="s">{{ change.s }}</div></div>
      </div>
    </div>
    <template #foot>
      <template v-if="pending"><button class="btn o" @click="emit('close')">Keep</button><button class="btn" :disabled="busy" @click="dismiss">Dismiss</button></template>
      <button v-else class="btn o" @click="emit('close')">Close</button>
    </template>
  </Sheet>
</template>

<style scoped>
/* the reminder itself on top, in the bell tile the Start sheet's options use */
.rvh { display: flex; align-items: flex-start; gap: 14px; margin-bottom: var(--hg); }
.oi { width: 40px; height: 40px; border-radius: 12px; background: var(--accc); color: var(--onc); display: grid; place-items: center; flex: none; }
.rvt { font-size: 16px; font-weight: 600; white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 2px; }
.rvh .tiny { margin-top: 3px; }
</style>
