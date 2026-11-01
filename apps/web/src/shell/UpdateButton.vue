<script setup lang="ts">
// Shows only when a newer version exists (no badge otherwise, PLAN.md §10.0).
import { useQuery } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import { api } from "../api/client";
import Icon from "../components/Icon.vue";
const router = useRouter();
const upd = useQuery({ queryKey: ["static", "update"], queryFn: () => api.get("/update-check"), staleTime: 6 * 3600_000, refetchOnWindowFocus: false });
</script>

<template>
  <button v-if="upd.data.value?.newer" type="button" class="nb upd" :title="`Version ${upd.data.value.latest} is available`" @click="router.push('/settings/updates')">
    <span class="ic"><Icon name="download" :size="22" /></span>Update
  </button>
</template>
