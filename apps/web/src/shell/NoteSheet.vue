<script setup lang="ts">
// Writing a note (requirement 21): choose where it goes (this exercise always, in this routine only, the routine, just
// this workout), how hard it was, quick tags, and whether to pin it so it shows during workouts.
import { ref } from "vue";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { toast, toastError } from "../core/toast";
import Sheet from "../components/Sheet.vue";

const props = defineProps<{ o: { targets: { type: string; id: string; label: string; scopeRoutineId?: string | null }[]; workoutId?: string | null; edit?: any } }>();
const emit = defineEmits<{ close: [] }>();
const TAGS = ["Too easy", "Too hard", "Change next time", "Good for me", "Pain", "Form"];
const target = ref(0);
const body = ref(props.o.edit?.body ?? ""), tags = ref<string[]>([...(props.o.edit?.tags ?? [])]), difficulty = ref<number | null>(props.o.edit?.difficulty ?? null), pinned = ref(props.o.edit?.pinned ?? props.o.targets[0]?.type !== "workout");
const busy = ref(false);
const toggle = (t: string) => { const i = tags.value.indexOf(t); if (i >= 0) tags.value.splice(i, 1); else tags.value.push(t); };
async function save() {
  if (!body.value.trim() && !tags.value.length) return emit("close");
  busy.value = true;
  try {
    const t = props.o.targets[target.value]!;
    if (props.o.edit) await api.put(`/notes/${props.o.edit.id}`, { body: body.value, tags: tags.value, difficulty: difficulty.value, pinned: pinned.value });
    else await api.post("/notes", { targetType: t.type, targetId: t.id, scopeRoutineId: t.scopeRoutineId ?? null, body: body.value || tags.value.join(", "), tags: tags.value, difficulty: difficulty.value, pinned: pinned.value, workoutId: props.o.workoutId ?? null });
    invalidate(["notes", "workouts", "routines", "exercises"]);
    toast("Note saved");
    emit("close");
  } catch (e) { toastError(e); } finally { busy.value = false; }
}
</script>

<template>
  <Sheet :title="o.edit ? 'Edit note' : 'Add a note'" @close="emit('close')">
    <div v-if="!o.edit && o.targets.length > 1" class="fld"><label>Note on</label>
      <div class="opt-list"><label v-for="(t, i) in o.targets" :key="i" class="opt" style="display:flex;gap:10px;align-items:center;padding:8px 0;cursor:pointer"><input v-model="target" type="radio" :value="i" />{{ t.label }}</label></div>
    </div>
    <div class="fld"><textarea v-model="body" rows="4" placeholder="How did it feel? What should change next time?" autofocus /></div>
    <div class="fld"><label>Quick tags</label><div class="chips"><button v-for="t in TAGS" :key="t" class="fchip" :class="{ on: tags.includes(t) }" @click="toggle(t)">{{ t }}</button></div></div>
    <div class="fld"><label>Difficulty</label><div class="seg block"><button v-for="n in 5" :key="n" :class="{ on: difficulty === n }" @click="difficulty = difficulty === n ? null : n">{{ ["Very easy", "Easy", "Right", "Hard", "Very hard"][n - 1] }}</button></div></div>
    <label class="tgl"><div class="grow"><div class="t">Pin it</div><div class="s">Show it every time this comes up in a workout</div></div><span class="tg"><input v-model="pinned" type="checkbox" /></span></label>
    <template #foot><button class="btn o" @click="emit('close')">Cancel</button><button class="btn" :disabled="busy" @click="save">Save</button></template>
  </Sheet>
</template>
