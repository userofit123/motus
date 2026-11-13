<script setup lang="ts">
// How a session differed from its routine, each with its own switch, all off to start with: nothing changes the
// routine unless asked. In two groups, what was changed on purpose and what was left undone. Shared by the Finish
// screen and a finished workout's "Update the routine from this", so both list and save the same way.
import { computed } from "vue";
import type { StructureChange } from "@motus/shared";
import Icon from "../components/Icon.vue";

// `finishing`: on the Finish screen, where today's weights and reps go to the routine anyway (Next time lists them), so
// the switches are only about sets and exercises
const props = defineProps<{ changes: StructureChange[]; finishing?: boolean }>();
const picked = defineModel<string[]>({ required: true });
const ICON: Record<StructureChange["kind"], string> = { added: "plus", removed: "minus", swapped: "swap", order: "drag", more: "layers", sets: "layers", skipped: "skip", fewer: "layers" };
const GROUPS = computed(() => ([["changed", "Changes you made"], ["notDone", "Not done"]] as const)
  .map(([g, title]) => ({ g, title, list: props.changes.filter((c) => c.group === g) })).filter((x) => x.list.length));
const allOn = computed(() => props.changes.every((c) => picked.value.includes(c.key)));
function toggle(k: string, on: boolean) { picked.value = on ? [...picked.value, k] : picked.value.filter((x) => x !== k); }
</script>

<template>
  <div>
    <p class="tiny hgap">This workout was different from the routine. Switch on each change you want to keep; the rest stays as it is.<template v-if="finishing"> Weights and reps are saved either way, as Next time shows.</template> <button v-if="changes.length > 1" class="lnk inl" @click="picked = allOn ? [] : changes.map((c) => c.key)">{{ allOn ? "Clear" : "Select all" }}</button></p>
    <div class="card">
      <template v-for="x in GROUPS" :key="x.g">
        <div class="lbl rc-lbl">{{ x.title }}</div>
        <label v-for="c in x.list" :key="c.key" class="tgl"><Icon :name="ICON[c.kind]" :size="18" class="rc-i" />
          <div class="grow" style="min-width:0"><div class="t">{{ c.text }}</div><div class="s">{{ c.action }}</div></div>
          <span class="tg"><input type="checkbox" :checked="picked.includes(c.key)" @change="toggle(c.key, ($event.target as HTMLInputElement).checked)" /></span></label>
      </template>
    </div>
  </div>
</template>

<style scoped>
.rc-i { flex: none; color: var(--tx2); }
.rc-lbl { padding-top: var(--lpy); }
.rc-lbl:first-child { padding-top: 0; }
</style>
