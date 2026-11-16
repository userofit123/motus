<script setup lang="ts">
// The Calendar day card's "Day by hour" (M-253): its header and chart. A day's stretches are minutes long, a few pixels at
// the card's size, so the chart zooms in along its hours and scrolls sideways under the lane names, which stay put
// (DayTimeline.vue). Every chart zooms by pinching or ctrl+wheel; this one also has two buttons in its header, as a
// whole day is the chart most worth looking into, and the buttons say it can be: zoom out (back to the whole day at
// the card's width) and zoom in, each a step of twice or half. A clicked or tapped tip opens the session (pick) or the
// lane's Stats tab on this day (open) under it.
import { computed, ref } from "vue";
import Icon from "../Icon.vue";
import DayTimeline from "./DayTimeline.vue";
import type { DayTimeline as Timeline } from "./dayTimeline";
import type { DaySession } from "./daySessions";

defineProps<{ tl: Timeline; day: string; sessions: DaySession[] }>();
const emit = defineEmits<{ open: [tab: "sleep" | "steps" | "heart"]; pick: [id: string] }>();
const chart = ref<InstanceType<typeof DayTimeline> | null>(null);
const zoom = computed(() => chart.value?.zoom ?? 1);
const most = computed(() => chart.value?.most ?? 1);
</script>

<template>
  <div class="lbl hgap"><span class="grow">Day by hour</span>
    <button type="button" class="ib sm plain dbh-b" aria-label="Zoom out" title="Zoom out" :disabled="zoom <= 1" @click="chart?.zoomOut()"><Icon name="zoomOut" /></button>
    <button type="button" class="ib sm plain dbh-b" aria-label="Zoom in" title="Zoom in" :disabled="zoom >= most" @click="chart?.zoomIn()"><Icon name="zoomIn" /></button>
  </div>
  <DayTimeline ref="chart" :tl="tl" :day="day" :sessions="sessions" @open="(tab) => emit('open', tab)" @pick="(id) => emit('pick', id)" />
</template>

<style scoped>
/* as the learn button in a header: the header keeps its height, the last icon lines up with the card's edge */
.dbh-b { flex: none; margin: -10px 0; color: var(--tx2); }
.dbh-b:hover:not(:disabled) { color: var(--acc); }
.dbh-b:disabled { opacity: .55; cursor: default; }
.dbh-b + .dbh-b { margin-inline: -8px -9px; }
</style>
