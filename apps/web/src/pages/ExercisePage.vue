<script setup lang="ts">
import { goBack } from "../core/leave";
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import ExerciseView from "../components/ExerciseView.vue";
import Icon from "../components/Icon.vue";
import { useExercise, useExerciseHistory, loaded } from "../api/queries";
const route = useRoute(), router = useRouter();
const id = computed(() => String(route.params.id));
// the view below reads the same exercise and history; waiting here shows the page once they're in, all at once
await loaded(useExercise(id), useExerciseHistory(id));
</script>

<template>
  <div class="page">
    <button class="back" @click="goBack(router, '/exercises')"><Icon name="left" :size="16" /><span>Back</span></button>
    <ExerciseView :id="id" :key="id" :start-tab="String(route.query.tab ?? 'about')" />
  </div>
</template>
