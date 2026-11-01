<script setup lang="ts">
// The phone's "More" tab: the pages that don't fit in the tab bar.
import { useRouter } from "vue-router";
import { bodySheet, activitySheet } from "../core/ui";
import Icon from "../components/Icon.vue";
const router = useRouter();
const ITEMS = [["/exercises", "Exercises", "dumbbell"], ["/goals", "Goals", "goals"], ["/stats", "Stats", "stats"], ["/body", "Body", "scale"], ["/settings", "Settings", "settings"]];
</script>

<template>
  <div class="page">
    <div class="ph"><h1>More</h1></div>
    <div class="card flush">
      <div v-for="[to, l, ic] in ITEMS" :key="to" class="li click" @click="router.push(to!)"><Icon :name="ic!" /><span class="grow t">{{ l }}</span><Icon name="right" class="muted" /></div>
    </div>
    <div class="sh"><h2>Quick add</h2></div>
    <div class="card flush">
      <div class="li click" @click="bodySheet = true"><Icon name="scale" /><span class="grow t">Body weight</span><Icon name="plus" class="muted" /></div>
      <div class="li click" @click="activitySheet = { type: 'walk' }"><Icon name="walk" /><span class="grow t">Walk or activity</span><Icon name="plus" class="muted" /></div>
      <div class="li click" @click="router.push('/log')"><Icon name="history" /><span class="grow t">Past workout</span><Icon name="plus" class="muted" /></div>
    </div>
  </div>
</template>
