<script setup lang="ts">
// A reminder for next time (requirement 22): e.g. "Increase the weight" on bench press, shown when bench press starts.
import { ref } from "vue";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { toast, toastError } from "../core/toast";
import { useFmt } from "../core/format";
import Sheet from "../components/Sheet.vue";

const props = defineProps<{ o: { targetType: "exercise" | "routine"; targetId: string; label: string; scopeRoutineId?: string | null; workoutId?: string | null; preset?: { body?: string; weightKg?: number } } }>();
const emit = defineEmits<{ close: [] }>();
const fmt = useFmt();
const body = ref(props.o.preset?.body ?? ""), trigger = ref("next"), n = ref(2), date = ref(""), onlyRoutine = ref(false);
const addW = ref<number | null>(props.o.preset?.weightKg != null ? Math.round(fmt.value.fromKg(props.o.preset.weightKg) * 100) / 100 : null), addR = ref<number | null>(null);
const busy = ref(false);
async function save() {
  if (!body.value.trim()) body.value = addW.value ? `Add ${addW.value} ${fmt.value.wu}` : "Reminder";
  busy.value = true;
  try {
    await api.post("/reminders", {
      targetType: props.o.targetType, targetId: props.o.targetId, scopeRoutineId: onlyRoutine.value ? props.o.scopeRoutineId : null, body: body.value, trigger: trigger.value,
      triggerN: trigger.value === "after_n" ? n.value : null, triggerDate: trigger.value === "date" ? date.value : null, workoutId: props.o.workoutId ?? null,
      action: addW.value || addR.value ? { weightKg: addW.value ? fmt.value.toKg(addW.value) : undefined, reps: addR.value ?? undefined } : null,
    });
    invalidate(["reminders", "routines", "workouts", "home", "exercises"]);
    toast("Reminder set");
    emit("close");
  } catch (e) { toastError(e); } finally { busy.value = false; }
}
</script>

<template>
  <Sheet :title="`Remind me · ${o.label}`" @close="emit('close')">
    <div class="fld"><label>Reminder</label><input v-model="body" placeholder="e.g. Increase the weight" autofocus /></div>
    <div class="fld"><label>When</label>
      <div class="seg block"><button :class="{ on: trigger === 'next' }" @click="trigger = 'next'">Next time</button><button :class="{ on: trigger === 'every' }" @click="trigger = 'every'">Every time</button><button :class="{ on: trigger === 'after_n' }" @click="trigger = 'after_n'">After…</button><button :class="{ on: trigger === 'date' }" @click="trigger = 'date'">From a date</button></div>
    </div>
    <div v-if="trigger === 'after_n'" class="fld"><label>After how many sessions</label><input v-model.number="n" type="number" min="1" max="50" /></div>
    <div v-if="trigger === 'date'" class="fld"><label>From</label><input v-model="date" type="date" /></div>
    <div v-if="o.targetType === 'exercise'" class="frow">
      <div class="fld"><label>Change the weight by ({{ fmt.wu }})</label><input v-model.number="addW" type="number" step="0.5" inputmode="decimal" placeholder="e.g. 2.5" /></div>
      <div class="fld"><label>Change the reps by</label><input v-model.number="addR" type="number" step="1" inputmode="numeric" placeholder="e.g. 1" /></div>
    </div>
    <p v-if="o.targetType === 'exercise'" class="tiny" style="margin:-6px 0 10px">The change is applied to the pre-filled numbers when the exercise comes up.</p>
    <label v-if="o.targetType === 'exercise' && o.scopeRoutineId" class="tgl"><div class="grow"><div class="t">Only in this routine</div></div><span class="tg"><input v-model="onlyRoutine" type="checkbox" /></span></label>
    <template #foot><button class="btn o" @click="emit('close')">Cancel</button><button class="btn" :disabled="busy" @click="save">Save</button></template>
  </Sheet>
</template>
