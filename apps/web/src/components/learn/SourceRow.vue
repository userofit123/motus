<script setup lang="ts">
// The row that names the research behind a block's targets (the learn cap, "Where the targets come from", the sources in a
// few words) and opens the lesson behind them. "Targets", not "numbers": the numbers themselves are the person's own, from
// their band or what they logged. Place it as the last row of the block's `.list`, so it reads as one more row; it sits
// inside clickable blocks (Home's), so its tap stays its own. One root (the sheet is teleported to the body), so the
// block's own rules for its last row apply to it.
import { ref } from "vue";
import Icon from "../Icon.vue";
import LearnSheet from "./LearnSheet.vue";
import type { LessonId } from "./lessons";

defineProps<{ topic: LessonId; sources: string }>();
const open = ref(false);
</script>

<template>
  <div class="li click" role="button" tabindex="0" :aria-label="`Where the targets come from: ${sources}`" @click.stop="open = true"
       @keydown.enter.stop.prevent="open = true" @keydown.space.stop.prevent="open = true">
    <Icon name="learn" :size="18" class="muted" />
    <div class="grow"><div class="t">Where the targets come from</div><div class="s">{{ sources }}</div></div>
    <Icon name="right" :size="16" class="muted" />
    <LearnSheet v-if="open" :topic="topic" @close="open = false" />
  </div>
</template>
