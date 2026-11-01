<script setup lang="ts">
// The workout in progress, on every other page: name, elapsed time, rest countdown, tap to go back to it.
import { useRouter } from "vue-router";
import { useActive } from "../api/queries";
import { rest, restLeft, restActive, elapsed } from "../workout/runtime";
import { clock } from "@motus/shared";
import Icon from "../components/Icon.vue";

const active = useActive();
const router = useRouter();
</script>

<template>
  <Transition name="mb">
  <div v-if="active.data.value" class="minibar" role="button" @click="router.push('/workout')">
    <Icon name="dumbbell" />
    <div class="grow">
      <div class="t ellipsis">{{ active.data.value.name }}</div>
      <div class="s">{{ clock(elapsed(active.data.value)) }}{{ active.data.value.pauseStartedAt ? " · paused" : "" }}</div>
    </div>
    <span v-if="restActive()" class="rest">{{ rest.label === "Next exercise" ? "Next" : "Rest" }} {{ clock(restLeft()) }}</span>
    <Icon name="right" />
  </div>
  </Transition>
</template>
