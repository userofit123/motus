<script setup lang="ts">
// The phone layout: the page, and five tabs with Start in the middle (PLAN.md §8.1).
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { section } from "./nav";
import { startOpen } from "../core/ui";
import Icon from "../components/Icon.vue";
import MiniBar from "./MiniBar.vue";
import { useActive } from "../api/queries";

const route = useRoute(), router = useRouter();
const cur = computed(() => section(route.name as string));
const TABS = [
  { name: "home", label: "Home", icon: "home", to: "/" },
  { name: "history", label: "History", icon: "calendar", to: "/history" },
  { name: "start" },
  { name: "routines", label: "Routines", icon: "routines", to: "/routines" },
  { name: "more", label: "More", icon: "moreH", to: "/more" },
];
const moreOn = computed(() => ["more", "exercises", "goals", "stats", "settings"].includes(cur.value));
const hideBar = computed(() => route.name === "workout");
const active = useActive();
</script>

<template>
  <div class="pshell" :class="{ withbar: !!active.data.value && !hideBar }" :style="hideBar ? { paddingBottom: 0 } : undefined">
    <div class="pmain"><router-view /></div>
    <div v-if="!hideBar" class="dock">
      <MiniBar />
      <div class="tabbar">
        <template v-for="t in TABS" :key="t.name">
          <button v-if="t.name === 'start'" aria-label="Start" @click="startOpen = true"><span class="start"><Icon name="plus" /></span></button>
          <button v-else :class="{ on: t.name === 'more' ? moreOn : cur === t.name }" @click="router.push(t.to!)"><span class="ic"><Icon :name="t.icon!" :size="22" /></span>{{ t.label }}</button>
        </template>
      </div>
    </div>
  </div>
</template>
