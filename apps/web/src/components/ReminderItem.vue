<script setup lang="ts">
// One reminder, everywhere reminders are shown: a bell, what to remember, a quiet line with what it's about and when
// it comes up, and its buttons in a row under the text (Done first, the others plain). Tapping it opens the reminder in
// full, where it can be dismissed (the sheet in shell/ReminderView.vue).
import { computed } from "vue";
import { useFmt } from "../core/format";
import Icon from "./Icon.vue";
import { reminderText, reminderWhen, reminderChange } from "../core/reminderText";
import { reminderView } from "../core/ui";

const props = defineProps<{ reminder: any; when?: boolean; where?: string | null; routineName?: string | null; actions?: { label: string; run: () => void; primary?: boolean }[] }>();
// dismissed from its sheet: lets a workout drop it from its own copy of the reminders
const emit = defineEmits<{ gone: [] }>();
const fmt = useFmt();
const r = computed(() => props.reminder);
const meta = computed(() => [props.where, props.when ? reminderWhen(r.value, fmt.value) : null, reminderChange(r.value, fmt.value)].filter(Boolean) as string[]);
const open = () => (reminderView.value = { r: r.value, routineName: props.routineName, gone: () => emit("gone") });
</script>

<template>
  <div class="ritem" role="button" tabindex="0" @click="open" @keydown.enter.self.prevent="open" @keydown.space.self.prevent="open">
    <Icon name="bell" :size="18" class="ic" />
    <div class="b">
      <div class="tx">{{ reminderText(r, fmt) }}</div>
      <div v-if="meta.length" class="m"><template v-for="(x, i) in meta" :key="i"><span v-if="i" class="sep">·</span><span>{{ x }}</span></template></div>
      <div v-if="actions?.length" class="acts">
        <button v-for="a in actions" :key="a.label" type="button" class="qb" :class="{ acc: a.primary }" @click.stop="a.run()">{{ a.label }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ritem { display: flex; align-items: flex-start; gap: 10px; text-align: start; padding: calc(var(--cpy) - 4px) calc(var(--cpx) - 3px); border-radius: var(--r-sm); background: color-mix(in srgb, var(--acc) 13%, transparent); font-size: 13.5px; color: var(--tx); cursor: pointer; }
.ritem:hover { background: color-mix(in srgb, var(--acc) 18%, transparent); }
.ritem:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; }
.ic { color: var(--acc); flex: none; margin-top: 1px; }
.b { flex: 1; min-width: 0; }
.tx { font-weight: 600; white-space: pre-wrap; overflow-wrap: anywhere; }
.m { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-top: 3px; font-size: var(--fs-xs); color: var(--tx2); }
/* buttons sit under the text, the first one's label lined up with it */
.acts { display: flex; flex-wrap: wrap; gap: 2px; margin: 4px 0 -4px -8px; }
.acts .qb { padding: 5px 8px; }
</style>
