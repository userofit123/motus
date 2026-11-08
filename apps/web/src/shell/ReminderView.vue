<script setup lang="ts">
// A reminder in full, opened by tapping it wherever it shows: what it says, what it's for, when it comes up and what it
// changes, with Dismiss. Closing the sheet keeps it. Dismissing marks it "dismissed" (the same as the Dismiss on a
// workout's reminder), so it stops coming up but stays in the history.
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api/client";
import { TOPICS, type Reminder } from "@motus/shared";
import { useExercises, useRoutines, useChange } from "../api/queries";
import { useFmt } from "../core/format";
import { toast } from "../core/toast";
import { exerciseSheet } from "../core/ui";
import { reminderText, reminderWhen, reminderChange } from "../core/reminderText";
import Sheet from "../components/Sheet.vue";
import Icon from "../components/Icon.vue";

const props = defineProps<{ o: { r: Reminder; routineName?: string | null; gone?: () => void } }>();
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
  // sessions are counted when they are finished, so it comes up in the session after the last counted one
  if (x.trigger === "after_n") return `Comes up once ${it.value} has been done ${x.triggerN} times`;
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
// during a workout the page must stay: an exercise opens in its sheet, a routine isn't opened at all
const inWorkout = computed(() => route.path === "/workout");
const alreadyThere = computed(() => route.path === path.value || (isEx.value && exerciseSheet.value === r.value.targetId));
const canOpen = computed(() => !alreadyThere.value && (isEx.value || !inWorkout.value));
function openTarget() {
  if (!canOpen.value) return;
  emit("close");
  if (isEx.value && inWorkout.value) { exerciseSheet.value = r.value.targetId; return; }
  exerciseSheet.value = null;
  router.push(path.value);
}
const pending = computed(() => r.value.status === "pending");
const seen = computed(() => Math.min(r.value.seenN, r.value.triggerN ?? 1));

const dismiss = useChange(async () => {
  await api.put(`/reminders/${r.value.id}`, { status: "dismissed" });
  props.o.gone?.();
  toast("Reminder dismissed");
  emit("close");
}, [...TOPICS.reminder]);
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
      <div class="li" :class="{ click: canOpen }" :role="canOpen ? 'button' : undefined" :tabindex="canOpen ? 0 : undefined" @click="openTarget" @keydown.enter.self.prevent="openTarget" @keydown.space.self.prevent="openTarget">
        <Icon :name="isEx ? 'dumbbell' : 'routines'" class="muted" />
        <div class="grow"><div class="t">{{ name }}</div><div class="s">{{ forText }}</div></div>
        <Icon v-if="canOpen" name="right" :size="16" class="muted" />
      </div>
      <div v-if="whenText" class="li">
        <Icon name="clock" class="muted" />
        <div class="grow"><div class="t">{{ reminderWhen(r, fmt) }}</div><div class="s">{{ whenText }}</div>
          <template v-if="r.trigger === 'after_n' && r.triggerN"><div class="pbar" role="progressbar" :aria-valuenow="seen" :aria-valuemax="r.triggerN"><i :style="{ width: (seen / r.triggerN) * 100 + '%' }" /></div><div class="s">{{ seen }} of {{ r.triggerN }} done so far</div></template></div>
      </div>
      <div v-if="change" class="li">
        <Icon name="scale" class="muted" />
        <div class="grow"><div class="t">{{ change.t }}</div><div class="s">{{ change.s }}</div></div>
      </div>
    </div>
    <template #foot>
      <template v-if="pending"><button class="btn o" @click="emit('close')">Keep</button><button class="btn" :disabled="dismiss.busy.value" @click="dismiss.run()">Dismiss</button></template>
      <button v-else class="btn o" @click="emit('close')">Close</button>
    </template>
  </Sheet>
</template>

<style scoped>
/* the reminder itself on top; its bell tile is the Start sheet's .oi */
.rvh { display: flex; align-items: flex-start; gap: 14px; margin-bottom: var(--hg); }
.rvt { font-size: 16px; font-weight: 600; white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 2px; }
.rvh .tiny { margin-top: 3px; }
.li.click:focus-visible { outline: 2px solid var(--acc); outline-offset: -2px; border-radius: var(--r-sm); }
.pbar { margin: 6px 0 4px; }
</style>
