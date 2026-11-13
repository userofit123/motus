<script setup lang="ts">
// A reminder for next time (requirement 22): e.g. "Increase the weight" on bench press, shown when bench press starts.
// Like a note, an exercise reminder asks where it comes up when there's a routine to choose (only this routine, first
// and chosen, or any workout with the exercise); opened from the exercise itself there is no routine, so it is always "anywhere".
// It can also nudge the numbers (PLAN.md §8.10): the change is added to the pre-filled weight and reps when the exercise
// comes up. That part is folded away behind its own switch, so a plain reminder stays plain.
import { computed, ref } from "vue";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { toast, toastError } from "../core/toast";
import { useFmt } from "../core/format";
import Sheet from "../components/Sheet.vue";
import DatePicker from "../components/DatePicker.vue";
import RadioList from "../components/RadioList.vue";

const props = defineProps<{ o: { targetType: "exercise" | "routine"; targetId: string; label: string; scopeRoutineId?: string | null; routineName?: string; workoutId?: string | null; preset?: { body?: string; weightKg?: number } } }>();
const emit = defineEmits<{ close: [] }>();
const fmt = useFmt();
const isEx = props.o.targetType === "exercise";
const body = ref(props.o.preset?.body ?? ""), trigger = ref("next"), n = ref(2), date = ref(""), onlyRoutine = ref(!!props.o.scopeRoutineId);
// the same wording and order as the note sheet's places, so both read alike: with a routine at hand, the routine comes
// first and is chosen (a reminder is usually about how this routine's set-up went), the exercise everywhere second
const places = computed(() => [
  { value: true, label: `${props.o.label} in ${props.o.routineName || "this routine"}`, hint: "Comes up when you do this exercise in this routine" },
  { value: false, label: `${props.o.label}, every time`, hint: "Comes up in every workout with this exercise, in any routine" },
]);
const addW = ref<number | null>(props.o.preset?.weightKg != null ? Math.round(fmt.value.fromKg(props.o.preset.weightKg) * 100) / 100 : null), addR = ref<number | null>(null);
const nudge = ref(addW.value != null);
const busy = ref(false);
async function save() {
  // switched on with both fields empty means no change
  const w = nudge.value ? addW.value || null : null, r = nudge.value ? addR.value || null : null;
  if (!body.value.trim()) body.value = w ? `${w > 0 ? "Add" : "Lower by"} ${Math.abs(w)} ${fmt.value.wu}` : r ? `${r > 0 ? "Add" : "Lower by"} ${Math.abs(r)} ${Math.abs(r) === 1 ? "rep" : "reps"}` : "Reminder";
  busy.value = true;
  try {
    await api.post("/reminders", {
      targetType: props.o.targetType, targetId: props.o.targetId, scopeRoutineId: onlyRoutine.value ? props.o.scopeRoutineId : null, body: body.value, trigger: trigger.value,
      triggerN: trigger.value === "after_n" ? n.value : null, triggerDate: trigger.value === "date" ? date.value : null, workoutId: props.o.workoutId ?? null,
      action: w || r ? { weightKg: w ? fmt.value.toKg(w) : undefined, reps: r ?? undefined } : null,
    });
    invalidate(["reminders", "routines", "workouts", "home", "exercises"]);
    toast("Reminder set");
    emit("close");
  } catch (e) { toastError(e); } finally { busy.value = false; }
}
</script>

<template>
  <Sheet :title="`Remind me · ${o.label}`" @close="emit('close')">
    <div v-if="isEx && o.scopeRoutineId" class="fld"><label>Where should it come up?</label><RadioList v-model="onlyRoutine" :options="places" /></div>
    <div class="fld"><label>Reminder</label><input v-model="body" placeholder="e.g. Try a narrower grip" autofocus /></div>
    <div class="fld"><label>When</label>
      <div class="seg block"><button :class="{ on: trigger === 'next' }" @click="trigger = 'next'">Next time</button><button :class="{ on: trigger === 'every' }" @click="trigger = 'every'">Every time</button><button :class="{ on: trigger === 'after_n' }" @click="trigger = 'after_n'">After…</button><button :class="{ on: trigger === 'date' }" @click="trigger = 'date'">From a date</button></div>
    </div>
    <div v-if="trigger === 'after_n'" class="fld"><label>After how many sessions</label><input v-model.number="n" type="number" min="1" max="50" /></div>
    <div v-if="trigger === 'date'" class="fld"><label>From</label><DatePicker v-model="date" title="From" /></div>
    <template v-if="isEx">
      <label class="tgl"><div class="grow"><div class="t">Also change the numbers</div><div class="s">Optional. Adds to the weight or reps filled in for you when this exercise comes up</div></div><span class="tg"><input v-model="nudge" type="checkbox" /></span></label>
      <template v-if="nudge">
        <div class="frow">
          <div class="fld"><label>Add to the weight ({{ fmt.wu }})</label><input v-model.number="addW" type="number" step="0.5" inputmode="decimal" placeholder="e.g. 2.5" /></div>
          <div class="fld"><label>Add to the reps</label><input v-model.number="addR" type="number" step="1" inputmode="numeric" placeholder="e.g. 1" /></div>
        </div>
        <p class="tiny">A minus number lowers it, e.g. -5 for a lighter day.</p>
      </template>
    </template>
    <template #foot><button class="btn o" @click="emit('close')">Cancel</button><button class="btn" :disabled="busy" @click="save">Save</button></template>
  </Sheet>
</template>
