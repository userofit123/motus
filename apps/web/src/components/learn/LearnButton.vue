<script setup lang="ts">
// The learn button (graduation cap) at the right of a block's header: opens the lesson behind the block's numbers.
// Place it as the last item of a flex header row (`.lbl.lhead`, `.ch`).
import { ref } from "vue";
import Icon from "../Icon.vue";
import LearnSheet from "./LearnSheet.vue";
import { LESSONS, type LessonId } from "./lessons";

const props = defineProps<{ topic: LessonId }>();
const open = ref(false);
</script>

<template>
  <button type="button" class="ib sm plain learn" :aria-label="`Learn about ${LESSONS[props.topic].title.toLowerCase()}`" title="Learn more" @click.stop="open = true"><Icon name="learn" /></button>
  <LearnSheet v-if="open" :topic="topic" @close="open = false" />
</template>

<style scoped>
/* a 36px tap target in a one-line header: the negative margins keep the header as tall as its siblings without the
   button, and put the cap's right edge on the card's content edge like the numbers below it */
.learn { flex: none; margin: -10px -9px -10px 0; color: var(--tx2); }
.learn:hover { color: var(--acc); }
</style>
