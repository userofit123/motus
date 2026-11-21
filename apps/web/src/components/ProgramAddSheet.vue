<script setup lang="ts">
// A program's Add routines: a new routine made on the spot (the routine editor, which adds it here when saved), or the
// routines you have, picked from their folders as the Start sheet shows them. The sheet stays open so several can go in.
import { computed } from "vue";
import { useRouter } from "vue-router";
import type { Program, RoutineSummary } from "@motus/shared";
import { addToProgram, addWeeks } from "../core/programMenu";
import { toast, toastError } from "../core/toast";
import Sheet from "./Sheet.vue";
import Icon from "./Icon.vue";
import RoutineChooser from "./RoutineChooser.vue";

const props = defineProps<{ program: Program }>();
const emit = defineEmits<{ close: [] }>();
const router = useRouter();
// said once at the top: where a picked routine goes (rest weeks keep their rest)
const hint = computed(() => {
  const n = props.program.weeks.length, to = addWeeks(props.program.weeks).length;
  const where = n === 1 ? "is added to the end of the program" : to === n ? `is added to the end of all ${n} weeks` : `is added to the end of ${to} of the ${n} weeks, not the rest weeks`;
  return `Each routine you pick ${where}. To change one week only, use Edit in ⋮.`;
});
const pick = async (r: RoutineSummary) => { try { toast(await addToProgram(props.program.id, r.id, r.name)); } catch (e) { toastError(e); } };
const create = () => { emit("close"); router.push({ path: "/routines/new/edit", query: { program: props.program.id } }); };
</script>

<template>
  <Sheet title="Add routines" @close="emit('close')">
    <p class="tiny hgap">{{ hint }}</p>
    <div class="opt-list">
      <button class="optb" @click="create"><span class="oi"><Icon name="plus" /></span><div class="grow"><div class="t">New routine</div><div class="s">From scratch, a template or another routine. Saving it adds it to {{ program.name }}.</div></div></button>
    </div>
    <h2 class="spt">Your routines</h2>
    <RoutineChooser icon="plus" @pick="pick" />
    <template #foot><button class="btn" @click="emit('close')">Done</button></template>
  </Sheet>
</template>
