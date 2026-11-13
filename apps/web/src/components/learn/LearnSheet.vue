<script setup lang="ts">
// A lesson in a sheet, laid out like Goal's sheet: an intro, an example of the block's chart, then sections of rows
// (icon, what, why; a value on the right where there is one).
import { computed } from "vue";
import Sheet from "../Sheet.vue";
import Icon from "../Icon.vue";
import BarChart from "../BarChart.vue";
import { LESSONS, type Lesson, type LessonId } from "./lessons";

const props = defineProps<{ topic: LessonId }>();
const emit = defineEmits<{ close: [] }>();
const l = computed<Lesson>(() => LESSONS[props.topic]);
</script>

<template>
  <Sheet :title="l.title" @close="emit('close')">
    <p class="tiny ls-intro">{{ l.intro }}</p>
    <div v-if="l.example" class="card"><div class="lbl hgap">{{ l.example.label }}</div><BarChart :bars="l.example.bars" horizontal :band="l.example.band" /></div>
    <template v-for="sec in l.sections" :key="sec.heading">
      <div class="sh"><h2>{{ sec.heading }}</h2></div>
      <div class="card flush">
        <div v-for="r in sec.rows" :key="r.t" class="li">
          <Icon :name="r.icon" :size="18" :class="r.ok ? 'pos' : 'muted'" />
          <div class="grow"><div class="t">{{ r.t }}</div><div v-if="r.s" class="s">{{ r.s }}</div></div>
          <span v-if="r.r" class="tiny">{{ r.r }}</span>
        </div>
      </div>
    </template>
  </Sheet>
</template>

<style scoped>
.ls-intro { margin: 0 0 var(--spg); line-height: 1.5; }
</style>
