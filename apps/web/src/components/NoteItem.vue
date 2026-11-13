<script lang="ts">
// the five difficulty words, shared with the note form so a note reads back the way it was written
export const DIFFICULTY = ["Very easy", "Easy", "Right", "Hard", "Very hard"];
</script>

<script setup lang="ts">
// One note, everywhere notes are shown: icon, the text, then a quiet line with where and when it was written,
// how hard it felt and its tags. A box during workouts and previews; a plain row in a Notes list (`flat`).
import { computed } from "vue";
import { useFmt } from "../core/format";
import Icon from "./Icon.vue";
import Menu, { type MenuItem } from "./Menu.vue";

const props = defineProps<{ note: any; flat?: boolean; date?: boolean; where?: string | null; menu?: MenuItem[] }>();
const fmt = useFmt();
// "shows every time" only means something for notes on an exercise or routine; workout notes stay with their workout
const repeats = computed(() => props.note.pinned && ["exercise", "routine_exercise", "routine"].includes(props.note.targetType));
// older tags-only notes saved their tags as the text too: show them once, as chips
const text = computed(() => (props.note.body && props.note.body !== (props.note.tags ?? []).join(", ") ? props.note.body : ""));
const meta = computed(() => [
  props.where,
  props.date ? fmt.value.date(props.note.createdAt, { day: "numeric", month: "short", year: "numeric" }) : null,
  props.flat ? props.note.workoutName : null,
  props.note.difficulty ? DIFFICULTY[props.note.difficulty - 1] : null,
  props.flat && repeats.value ? "Shows in every workout" : null,
].filter(Boolean) as string[]);
</script>

<template>
  <div class="nitem" :class="{ flat }">
    <Icon name="note" :size="18" class="note-ic" />
    <div class="b">
      <div v-if="text" class="tx">{{ text }}</div>
      <div v-if="meta.length || note.tags?.length" class="m">
        <template v-for="(x, i) in meta" :key="i"><span v-if="i" class="sep">·</span><span>{{ x }}</span></template>
        <span v-for="t in note.tags" :key="t" class="mchip">{{ t }}</span>
      </div>
    </div>
    <span v-if="menu?.length" class="mn"><Menu :items="menu" label="Note options" /></span>
  </div>
</template>

<style scoped>
/* on a page or a sheet it is a block of its own on the card surface with the card's edge (an inset ring, so it is as tall as
   the reminder beside it); inside a card it is a quiet inner tile */
.nitem { display: flex; align-items: flex-start; gap: 10px; text-align: start; padding: calc(var(--cpy) - 4px) calc(var(--cpx) - 3px); border-radius: var(--r-sm); background: var(--s1); box-shadow: inset 0 0 0 1px var(--ol); font-size: 13.5px; color: var(--tx); }
.card .nitem { background: var(--s2); box-shadow: none; }
.nitem.flat, .card .nitem.flat { background: none; box-shadow: none; border-radius: 0; padding: var(--lpy) 4px; border-bottom: 1px solid var(--ol); font-size: 14px; }
.nitem.flat:last-child { border-bottom: 0; }
.b { flex: 1; min-width: 0; }
.tx { white-space: pre-wrap; overflow-wrap: anywhere; }
.m { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-top: 4px; font-size: var(--fs-xs); color: var(--tx2); }
.b > .m:first-child { margin-top: 0; }
/* the ⋮ button is taller than a line of text: pull it up so it lines up with the first line */
.mn { margin: -8px -6px -8px 0; flex: none; display: flex; }
</style>
