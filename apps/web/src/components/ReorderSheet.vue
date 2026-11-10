<script setup lang="ts">
// A list put in order with up and down arrows (Goals' active goals, the routines of one folder).
// The page owns the order: it gets `move` and saves; this only shows the rows and the arrows.
import Icon from "./Icon.vue";
import Sheet from "./Sheet.vue";

export interface ReorderItem { id: string; title: string; sub?: string; color?: string | null }
defineProps<{ title: string; hint: string; items: ReorderItem[]; showColor?: boolean }>();
const emit = defineEmits<{ close: []; move: [id: string, dir: -1 | 1] }>();
</script>

<template>
  <Sheet :title="title" @close="emit('close')">
    <p class="tiny hgap">{{ hint }}</p>
    <TransitionGroup name="mv" tag="div">
      <div v-for="(it, i) in items" :key="it.id" class="tgl">
        <span v-if="showColor" class="dot" :style="{ background: it.color ?? undefined }" />
        <div class="grow"><div class="t">{{ it.title }}</div><div v-if="it.sub" class="s">{{ it.sub }}</div></div>
        <button class="ib sm plain" :class="{ end: i === 0 }" :aria-disabled="i === 0" :aria-label="`Move ${it.title} up`" :title="`Move ${it.title} up`" @click="emit('move', it.id, -1)"><Icon name="up" :size="18" /></button>
        <button class="ib sm plain" :class="{ end: i === items.length - 1 }" :aria-disabled="i === items.length - 1" :aria-label="`Move ${it.title} down`" :title="`Move ${it.title} down`" @click="emit('move', it.id, 1)"><Icon name="down" :size="18" /></button>
      </div>
    </TransitionGroup>
  </Sheet>
</template>
