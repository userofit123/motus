<script setup lang="ts">
// When an activity or workout started and ended, changed after the fact (a recording left running past the real end,
// a time typed wrong): the day, start and end with the app's own pickers, and what the duration becomes. An end at or
// before the start is the next day, as an evening walk past midnight. Pauses stay as long as they were, so the
// duration is the new span less them (as the engine works it out).
import { computed, ref } from "vue";
import { useFmt, localYmd } from "../core/format";
import Sheet from "./Sheet.vue";
import DatePicker from "./DatePicker.vue";
import TimePicker from "./TimePicker.vue";
import Icon from "./Icon.vue";

const props = defineProps<{
  title: string; start: string; end: string;
  /** seconds paused within the times (left out of the duration) */
  paused: number;
  /** the duration as it is now, and the word before it under the new one ("Was", "So far") */
  duration: number; was: string;
  ok: string; note?: string;
  save: (startedAt: string, endedAt: string) => Promise<unknown>;
}>();
const emit = defineEmits<{ close: [] }>();
const fmt = useFmt();
const hm = (d: Date) => d.toTimeString().slice(0, 5);
const s0 = new Date(props.start), e0 = new Date(props.end);
const f = ref({ date: localYmd(s0), start: hm(s0), end: hm(e0) });
const startAt = computed(() => new Date(`${f.value.date}T${f.value.start}`));
const endAt = computed(() => {
  const e = new Date(`${f.value.date}T${f.value.end}`);
  if (e <= startAt.value) e.setDate(e.getDate() + 1);
  return e;
});
const span = computed(() => Math.round((endAt.value.getTime() - startAt.value.getTime()) / 1000));
const newDuration = computed(() => (span.value > props.paused ? span.value - props.paused : span.value));
const busy = ref(false);
async function save() {
  busy.value = true;
  try { await props.save(startAt.value.toISOString(), endAt.value.toISOString()); }
  finally { busy.value = false; }
}
</script>

<template>
  <Sheet :title="title" @close="emit('close')">
    <div class="frow"><div class="fld"><label>Day</label><DatePicker v-model="f.date" title="Day" /></div><div class="fld"><label>Start</label><TimePicker v-model="f.start" title="Start" /></div><div class="fld"><label>End</label><TimePicker v-model="f.end" title="End" /></div></div>
    <div class="grid g2 ts-tiles">
      <div class="card stat"><div class="lbl"><span class="bi"><Icon name="clock" :size="15" /></span>Duration</div><div class="val">{{ fmt.dur(newDuration, true) }}</div><div class="sub">{{ was }} {{ fmt.dur(duration, true) }}</div></div>
      <div class="card stat"><div class="lbl"><span class="bi"><Icon name="timer" :size="15" /></span>End</div><div class="val">{{ fmt.time(endAt.toISOString()) }}</div><div class="sub">{{ fmt.date(endAt) }}</div></div>
    </div>
    <p v-if="note" class="tiny spt">{{ note }}</p>
    <template #foot><button class="btn o" @click="emit('close')">Cancel</button><button class="btn" :disabled="busy" @click="save">{{ ok }}</button></template>
  </Sheet>
</template>

<style scoped>
.ts-tiles .stat { min-height: 0; }
</style>
