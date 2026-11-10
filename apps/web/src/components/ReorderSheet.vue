<script setup lang="ts">
// A list put in order by dragging a row's handle or with up and down arrows (Goals' active goals, the routines of one folder, a workout's exercises).
// The page owns the order: it gets `move` (from index, to index) and saves; this only shows the rows and the controls.
import Icon from "./Icon.vue";
import Sheet from "./Sheet.vue";
import { startDrag } from "../core/drag";

// cur: the row being looked at (accent fill); active: the one being done (green dot); muted: skipped (struck through)
export interface ReorderItem { id: string; title: string; sub?: string; color?: string | null; cur?: boolean; active?: boolean; muted?: boolean }
// onSelect is declared so we can tell whether the page listens: rows are only tappable then (Routines and Goals do not)
const props = defineProps<{ title: string; hint: string; items: ReorderItem[]; showColor?: boolean; onSelect?: (index: number) => void }>();
const emit = defineEmits<{ close: []; move: [from: number, to: number] }>();
const tappable = () => !!props.onSelect;
const drag = (ev: PointerEvent, i: number) =>
  startDrag(ev, { list: (ev.currentTarget as HTMLElement).closest(".rlist") as HTMLElement, index: i, move: (a, b) => emit("move", a, b) });
</script>

<template>
  <Sheet :title="title" @close="emit('close')">
    <p class="tiny hgap">{{ hint }}</p>
    <TransitionGroup name="mv" tag="div" class="rlist">
      <div v-for="(it, i) in items" :key="it.id" class="tgl" :class="{ fixed: !tappable(), cur: it.cur, act: it.active, muted: it.muted }" data-drag>
        <button class="ib sm plain dragh" :aria-label="`Drag ${it.title} to reorder`" :title="`Drag ${it.title} to reorder`" @pointerdown="drag($event, i)"><Icon name="drag" :size="18" /></button>
        <span v-if="showColor" class="dot" :style="{ background: it.color ?? undefined }" />
        <div v-if="tappable()" class="grow" role="button" tabindex="0" @click="onSelect?.(i)" @keydown.enter="onSelect?.(i)"><div class="t">{{ it.title }}</div><div v-if="it.sub" class="s">{{ it.sub }}</div></div>
        <div v-else class="grow"><div class="t">{{ it.title }}</div><div v-if="it.sub" class="s">{{ it.sub }}</div></div>
        <button class="ib sm plain" :class="{ end: i === 0 }" :aria-disabled="i === 0" :aria-label="`Move ${it.title} up`" :title="`Move ${it.title} up`" @click="emit('move', i, i - 1)"><Icon name="up" :size="18" /></button>
        <button class="ib sm plain" :class="{ end: i === items.length - 1 }" :aria-disabled="i === items.length - 1" :aria-label="`Move ${it.title} down`" :title="`Move ${it.title} down`" @click="emit('move', i, i + 1)"><Icon name="down" :size="18" /></button>
      </div>
    </TransitionGroup>
  </Sheet>
</template>

<style scoped>
/* muted like the routine editor's handle */
.dragh { color: var(--tx2); }
/* .tgl rows show a pointer everywhere; rows that can't be tapped shouldn't look like they can */
.fixed { cursor: default; }
/* the exercise on screen, filled like the workout's side list; the padding is pulled back out so its text stays in line with the other rows */
.cur { background: var(--accc); color: var(--onc); border-radius: var(--r-sm); border-bottom-color: transparent; padding-inline: var(--lpy); margin-inline: calc(var(--lpy) * -1); }
.cur .s, .cur .ib { color: color-mix(in srgb, var(--onc) 75%, transparent); }
/* the exercise being done: the same dot as the workout's tabs and side list */
.act .t::after { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--pos); display: inline-block; margin-inline-start: 6px; vertical-align: middle; }
.muted .t { text-decoration: line-through; opacity: .6; }
</style>
