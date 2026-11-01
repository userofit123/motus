<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import ExerciseView from "../components/ExerciseView.vue";
import Icon from "../components/Icon.vue";
const route = useRoute(), router = useRouter();
const id = computed(() => String(route.params.id));
</script>

<template>
  <div class="page">
    <button class="back" @click="router.back()"><Icon name="left" :size="16" />Back</button>
    <ExerciseView :id="id" :key="id" :start-tab="String(route.query.tab ?? 'about')" />
  </div>
</template>
