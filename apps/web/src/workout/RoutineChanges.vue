<script setup lang="ts">
// How a session differed from its routine, each with its own switch, all off to start with: nothing changes the
// routine unless asked. In two groups, what was changed on purpose and what was left undone. Shared by the Finish
// screen and a finished workout's "Update the routine from this", so both list and save the same way.
import { computed } from "vue";
import type { StructureChange } from "@motus/shared";
import Icon from "../components/Icon.vue";

const props = defineProps<{ changes: StructureChange[] }>();
const picked = defineModel<string[]>({ required: true });
const ICON: Record<StructureChange["kind"], string> = { added: "plus", removed: "minus", swapped: "swap", order: "drag", more: "layers", skipped: "skip", fewer: "layers" };
const GROUPS = computed(() => ([["changed", "Changed in this session"], ["notDone", "Not done"]] as const)
  .map(([g, title]) => ({ g, title, list: props.changes.filter((c) => c.group === g) })).filter((x) => x.list.length));
const allOn = computed(() => props.changes.every((c) => picked.value.includes(c.key)));
function toggle(k: string, on: boolean) { picked.value = on ? [...picked.value, k] : picked.value.filter((x) => x !== k); }
</script>

<template>
  <div>
    <p class="tiny hgap">Switch on what to save to the routine. Its weights and reps stay as set.
      <button v-if="changes.length > 1" class="lnk inl" @click="picked = allOn ? [] : changes.map((c) => c.key)">{{ allOn ? "Clear" : "Select all" }}</button></p>
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
