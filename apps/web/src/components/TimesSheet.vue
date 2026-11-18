<script setup lang="ts">
// When an activity or workout started and ended, changed after the fact (a recording left running past the real end,
// a time typed wrong): the day, start and end with the app's own pickers, and what the duration becomes. An end at or
// before the start is the next day, as an evening walk past midnight. Pauses stay as long as they were, so the
// duration is the new span less them, unless they would fill it all (pausedWithin, the rule the engine saves by).
import { computed, ref } from "vue";
import { useFmt, localYmd } from "../core/format";
import Sheet from "./Sheet.vue";
import DatePicker from "./DatePicker.vue";
import TimePicker from "./TimePicker.vue";
import Icon from "./Icon.vue";
import { pausedWithin } from "@motus/shared";

const props = defineProps<{
  title: string; start: string; end: string;
  /** seconds paused within the times (left out of the duration) */
  paused: number;
  /** the duration as it is now, and the word before it under the new one ("Was", "Recorded") */
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
const newDuration = computed(() => span.value - pausedWithin(span.value, props.paused));
// under it: what it was, once a time is changed (the pickers drop the seconds, so against what they show at first), and
// the end's day when it isn't the Day picked (past midnight). The line is always there, so the tile keeps its height
const first = newDuration.value;
const sub = computed(() => [
  newDuration.value !== first ? `${props.was} ${fmt.value.dur(props.duration, true)}` : "",
  localYmd(endAt.value) !== f.value.date ? `Ends ${fmt.value.date(endAt.value)}` : "",
].filter(Boolean).join(" · "));
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
    <div class="grid ts-tiles">
      <div class="card stat"><div class="lbl"><span class="bi"><Icon name="clock" :size="15" /></span>Duration</div><div class="val">{{ fmt.dur(newDuration, true) }}</div><div class="sub">{{ sub || "\u00a0" }}</div></div>
    </div>
    <p v-if="note" class="tiny spt">{{ note }}</p>
    <template #foot><button class="btn o" @click="emit('close')">Cancel</button><button class="btn" :disabled="busy" @click="save">{{ ok }}</button></template>
  </Sheet>
</template>

<style scoped>
.ts-tiles .stat { min-height: 0; }
</style>
