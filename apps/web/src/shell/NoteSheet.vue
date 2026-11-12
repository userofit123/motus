<script setup lang="ts">
// Writing a note (requirement 21). One question decides what happens to it: a note on an exercise, an exercise in a
// routine or a routine shows again in every workout where that comes up (and in the preview before one); "Just today"
// or "Just keep it on record" saves it in the notes without it coming back. That choice is the note's `pinned` flag, so
// there is no separate pin switch to puzzle over. Then how hard it was and quick tags (the person's own list, Settings → Workout).
import { computed, ref } from "vue";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { saveSettings, useSettings } from "../api/queries";
import { toast, toastError } from "../core/toast";
import { prompt } from "../core/ask";
import Sheet from "../components/Sheet.vue";
import ChoiceTiles from "../components/ChoiceTiles.vue";
import RadioList from "../components/RadioList.vue";
import Icon from "../components/Icon.vue";
import { DIFFICULTY } from "../components/NoteItem.vue";
import { SHOWS } from "../core/noteMenu";
import { TOPICS } from "@motus/shared";

const props = defineProps<{ o: { targets: { type: string; id: string; label: string; scopeRoutineId?: string | null }[]; workoutId?: string | null; edit?: any } }>();
const emit = defineEmits<{ close: [] }>();
const settings = useSettings();

// places a note can come back from (SHOWS, shared with the note's ⋮ menu); workout and activity notes only ever stay with their workout or activity
const REPEATS = Object.keys(SHOWS);
const KEPT: Record<string, string> = { workout_exercise: "Saved with today's workout. Won't show again", workout: "Saved with today's workout. Won't show again", activity: "Saved with this activity" };
const RECORD = "Saved in the notes. Won't show during workouts";
type Opt = { ti: number; pinned: boolean; label: string; hint: string };
const opts = computed<Opt[]>(() => {
  const ts = props.o.targets;
  if (props.o.edit) {
    // editing keeps the place; only whether it comes back can change
    const t = ts[0]!;
    return REPEATS.includes(t.type) ? [{ ti: 0, pinned: true, label: "Show it every time", hint: SHOWS[t.type]! }, { ti: 0, pinned: false, label: "Just keep it on record", hint: RECORD }] : [];
  }
  const out: Opt[] = ts.map((t, ti) => (REPEATS.includes(t.type) ? { ti, pinned: true, label: t.label, hint: SHOWS[t.type]! } : { ti, pinned: false, label: t.label, hint: KEPT[t.type] ?? "" }));
  // outside a workout there's no "Just today": offer saving it without it popping up in workouts
  if (ts.length && ts.every((t) => REPEATS.includes(t.type))) out.push({ ti: 0, pinned: false, label: "Just keep it on record", hint: RECORD });
  return out;
});
const choice = ref(props.o.edit && !props.o.edit.pinned && opts.value.length > 1 ? 1 : 0);
const cur = computed<Opt>(() => opts.value[choice.value] ?? { ti: 0, pinned: !!props.o.edit?.pinned, label: "", hint: "" });

// an older tags-only note carries its tags as text too: edit it as tags alone
const body = ref(props.o.edit?.body && props.o.edit.body !== (props.o.edit.tags ?? []).join(", ") ? props.o.edit.body : ""), tags = ref<string[]>([...(props.o.edit?.tags ?? [])]), difficulty = ref<number | null>(props.o.edit?.difficulty ?? null);
// the person's tags, plus any an older note carries that have since been removed from the list
const tagOpts = computed(() => [...new Set([...(settings.value.noteTags ?? []), ...tags.value])].map((t) => ({ value: t, label: t })));
async function addTag() {
  const t = (await prompt("New tag", { placeholder: "e.g. Grip", ok: "Add" }))?.trim().slice(0, 40);
  if (!t) return;
  if (!settings.value.noteTags.some((x) => x.toLowerCase() === t.toLowerCase())) {
    await saveSettings({ noteTags: [...settings.value.noteTags, t] });
    toast(`Tag "${t}" added`);
  }
  const have = tagOpts.value.find((x) => x.value.toLowerCase() === t.toLowerCase())?.value ?? t;
  if (!tags.value.includes(have)) tags.value = [...tags.value, have];
}

const busy = ref(false);
async function save() {
  if (!body.value.trim() && !tags.value.length) return emit("close");
  busy.value = true;
  try {
    const t = props.o.targets[cur.value.ti]!, pinned = cur.value.pinned;
    if (props.o.edit) await api.put(`/notes/${props.o.edit.id}`, { body: body.value, tags: tags.value, difficulty: difficulty.value, pinned });
    else await api.post("/notes", { targetType: t.type, targetId: t.id, scopeRoutineId: t.scopeRoutineId ?? null, body: body.value, tags: tags.value, difficulty: difficulty.value, pinned, workoutId: props.o.workoutId ?? null });
    invalidate([...TOPICS.note]);
    toast("Note saved");
    emit("close");
  } catch (e) { toastError(e); } finally { busy.value = false; }
}
</script>

<template>
  <Sheet :title="o.edit ? 'Edit note' : 'Add a note'" @close="emit('close')">
    <div v-if="opts.length > 1" class="fld"><label>{{ o.edit ? "When should it show?" : "Where should it show?" }}</label>
      <RadioList v-model="choice" :options="opts.map((x, i) => ({ value: i, label: x.label, hint: x.hint }))" />
    </div>
    <div class="fld"><textarea v-model="body" rows="4" placeholder="How did it feel? What should change next time?" autofocus /></div>
    <div class="fld">
      <div class="lrow"><label>Quick tags</label><button type="button" class="ib sm plain" aria-label="Add a tag" title="Add a tag" @click="addTag"><Icon name="plus" :size="16" /></button></div>
      <ChoiceTiles v-model="tags" :options="tagOpts" multiple compact min="130px" label="Quick tags" />
    </div>
    <div class="fld"><label>Difficulty</label><div class="seg block"><button v-for="n in 5" :key="n" :class="{ on: difficulty === n }" @click="difficulty = difficulty === n ? null : n">{{ DIFFICULTY[n - 1] }}</button></div></div>
    <template #foot><button class="btn o" @click="emit('close')">Cancel</button><button class="btn" :disabled="busy" @click="save">Save</button></template>
  </Sheet>
</template>

<style scoped>
/* the label with its + at the far end; the button is taller than the label, so it eats into the gap below instead */
.lrow { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.lrow label { font-size: 12.5px; font-weight: 600; color: var(--tx2); }
.lrow .ib { width: 28px; height: 28px; margin: -6px -4px -6px 0; color: var(--acc); }
</style>
