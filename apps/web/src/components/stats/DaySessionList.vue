<script setup lang="ts">
// The day's workouts and activities under a day chart (Stats → Steps, Heart and Sleep), or a stretch's (Heart), each row as the Calendar's day
// list: its icon in the colour it is shaded in on the chart, its name, its time, the chart's figure for it on the right
// (steps, or the average and highest heart rate) and a chevron; a row opens the session.
import { useRouter } from "vue-router";
import { useFmt } from "../../core/format";
import Icon from "../Icon.vue";
import DotLine from "../DotLine.vue";
import type { DaySession } from "./daySessions";

// value: the right-hand figure ("1,240 steps", "128 bpm"), sub: a second line under it ("highest 151"); dated: sessions of
// several days (Stats → Heart's week, month or year), each line with its date in place of its times
defineProps<{ sessions: DaySession[]; value: (x: DaySession) => string; sub?: (x: DaySession) => string; dated?: boolean }>();
const router = useRouter();
const fmt = useFmt();
const t = (ms: number) => fmt.value.time(new Date(ms).toISOString());
</script>

<template>
  <div class="list dsl">
    <div v-for="x in sessions" :key="x.key" class="li click" role="button" tabindex="0" @click="router.push(x.key)" @keydown.enter="router.push(x.key)">
      <Icon :name="x.icon" :size="18" :style="{ color: x.color }" />
      <div class="grow"><div class="t">{{ x.name }}</div><div class="s"><DotLine :parts="[dated ? fmt.date(new Date(x.a).toISOString(), { weekday: 'short', day: 'numeric', month: 'short' }) : x.b > x.a ? `${t(x.a)}-${t(x.b)}` : t(x.a), ...(x.durationS ? [fmt.dur(x.durationS, true)] : [])]" /></div></div>
      <div class="r"><b class="num">{{ value(x) }}</b><div v-if="sub && sub(x)" class="s">{{ sub(x) }}</div></div>
      <Icon name="right" class="muted" />
    </div>
  </div>
</template>

<style scoped>
/* inside its card's section: no line above the first row or under the last, as the Calendar's day card */
.dsl .li:first-child { padding-top: 0; }
.dsl .li:last-child { border-bottom: 0; padding-bottom: 0; }
.dsl .grow { min-width: 0; }
</style>
