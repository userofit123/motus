<script setup lang="ts">
// A list put in order by dragging a row's handle or with up and down arrows (Goals' active goals, the routines of one folder).
// The page owns the order: it gets `move` (from index, to index) and saves; this only shows the rows and the controls.
import { getCurrentInstance } from "vue";
import Icon from "./Icon.vue";
import Sheet from "./Sheet.vue";
import { startDrag } from "../core/drag";

export interface ReorderItem { id: string; title: string; sub?: string; color?: string | null }
defineProps<{ title: string; hint: string; items: ReorderItem[]; showColor?: boolean }>();
const emit = defineEmits<{ close: []; move: [from: number, to: number]; select: [index: number] }>();
// rows are only tappable when the page listens for `select` (Routines and Goals do not)
const tappable = !!getCurrentInstance()?.vnode.props?.onSelect;
const drag = (ev: PointerEvent, i: number) =>
  startDrag(ev, { list: (ev.currentTarget as HTMLElement).closest(".rlist") as HTMLElement, index: i, move: (a, b) => emit("move", a, b) });
</script>

<template>
  <Sheet :title="title" @close="emit('close')">
    <p class="tiny hgap">{{ hint }}</p>
    <TransitionGroup name="mv" tag="div" class="rlist">
      <div v-for="(it, i) in items" :key="it.id" class="tgl" data-drag>
        <button class="ib sm plain dragh" :aria-label="`Drag ${it.title} to reorder`" :title="`Drag ${it.title} to reorder`" @pointerdown="drag($event, i)"><Icon name="drag" :size="18" /></button>
        <span v-if="showColor" class="dot" :style="{ background: it.color ?? undefined }" />
        <div class="grow" :class="{ tap: tappable }" @click="tappable && emit('select', i)"><div class="t">{{ it.title }}</div><div v-if="it.sub" class="s">{{ it.sub }}</div></div>
        <button class="ib sm plain" :class="{ end: i === 0 }" :aria-disabled="i === 0" :aria-label="`Move ${it.title} up`" :title="`Move ${it.title} up`" @click="emit('move', i, i - 1)"><Icon name="up" :size="18" /></button>
        <button class="ib sm plain" :class="{ end: i === items.length - 1 }" :aria-disabled="i === items.length - 1" :aria-label="`Move ${it.title} down`" :title="`Move ${it.title} down`" @click="emit('move', i, i + 1)"><Icon name="down" :size="18" /></button>
      </div>
    </TransitionGroup>
  </Sheet>
</template>

<style scoped>
/* muted like the routine editor's handle */
.dragh { color: var(--tx2); }
.tap { cursor: pointer; }
</style>
