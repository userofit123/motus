<script setup lang="ts">
// Shown while you look at an exercise other than the one you're doing: says so, and goes back (or makes this one the
// one you're doing). Sets can only be logged in the exercise you're doing.
import { useWorkout } from "./useWorkout";
import Icon from "../components/Icon.vue";

const W = useWorkout();
</script>

<template>
  <div v-if="W.state.w && W.state.cur !== W.state.active && W.state.w.exercises[W.state.active]" class="aw-peek">
    <Icon name="info" :size="16" />
    <div class="grow" style="min-width:0"><b>{{ W.state.cur > W.state.active ? "Previewing an upcoming exercise" : "Looking back at an earlier exercise" }}</b><span class="ellipsis">You're doing {{ W.state.w!.exercises[W.state.active]!.exercise.name }}</span></div>
    <button class="qb" @click="W.state.active = W.state.cur">Do this now</button>
    <button class="btn s" @click="W.state.cur = W.state.active">Back</button>
  </div>
</template>

<style scoped>
/* a block above the exercise card: --spg below it, none in the computer's column (its gap does it) */
.aw-peek { display: flex; align-items: center; gap: 10px; margin: 0 0 var(--spg); padding: 8px 8px 8px 12px; border-radius: var(--r-md); border: 1px dashed var(--acc); color: var(--tx); font-size: 13px; }
.stack > .aw-peek { margin: 0; }
.aw-peek > svg { color: var(--acc); flex: none; }
.aw-peek b { display: block; font-weight: 600; }
.aw-peek span { display: block; font-size: 12px; color: var(--tx2); }
.aw-peek .qb { padding: 6px 8px; font-size: 12.5px; }
</style>
