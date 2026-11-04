<script setup lang="ts">
// What's running, on every other page: the workout in progress, a walk (run, ride…) being recorded and the interval timer.
// They may run at the same time (a walk to the gym, then the workout with intervals), so each gets its own bar with its
// own clock, and tapping one opens it. Each bar hides on its own page. `strip`: only the recording and the timer, as slim
// lines on the workout page, whose own bar at the bottom leaves no room for these.
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useActive, useActivityTypes } from "../api/queries";
import { rest, restLeft, restActive, elapsed } from "../workout/runtime";
import { recording, recDistM, recElapsedS, recTypeName } from "../workout/recording";
import { iv, ivPhases, ivNow, ivRunning, PHASE_NAME } from "../workout/intervals";
import { useFmt } from "../core/format";
import { clock } from "@motus/shared";
import Icon from "../components/Icon.vue";

const props = defineProps<{ strip?: boolean }>();
const active = useActive();
const types = useActivityTypes();
const fmt = useFmt();
const route = useRoute(), router = useRouter();
const showW = computed(() => !props.strip && !!active.data.value && route.name !== "workout");
const showR = computed(() => !!recording.value && route.name !== "record");
const showI = computed(() => ivRunning.value && route.name !== "timer");
// two or more bars on a phone take less room each
const two = computed(() => [showW.value, showR.value, showI.value].filter(Boolean).length > 1);
const recType = computed(() => (types.data.value ?? []).find((x: any) => x.slug === recording.value?.type));
const recIcon = computed(() => recType.value?.icon ?? "walk");
// the interval timer: the part it is in, the round, and the time left in that part
const ivPhase = computed(() => ivPhases.value[ivNow.value.index]);
const ivWhat = computed(() => (ivPhase.value ? `${PHASE_NAME[ivPhase.value.kind]} · Round ${ivPhase.value.round} of ${iv.cfg.rounds}` : ""));
const ivLeft = computed(() => clock(Math.ceil(ivNow.value.leftMs / 1000)));
const recWhat = computed(() => (recType.value?.name ?? recTypeName()) + (recDistM.value >= 10 ? ` · ${fmt.value.num(fmt.value.distNum(recDistM.value), 2)} ${fmt.value.du}` : ""));
</script>

<template>
  <div v-if="strip" class="minibars strip-host">
    <Transition name="mb">
      <div v-if="showR" class="minibar mb-strip" role="button" :aria-label="`Recording ${recWhat}. Open it`" @click="router.push('/activities/record')">
        <span class="mb-live" :class="{ paused: !!recording!.pauseAt }"><Icon :name="recIcon" :size="15" /></span>
        <div class="grow ellipsis"><b>{{ recording!.pauseAt ? "Paused" : "Recording" }}</b> · {{ recWhat }}</div>
        <b class="mb-num">{{ clock(recElapsedS) }}</b><Icon name="right" :size="16" />
      </div>
    </Transition>
    <Transition name="mb">
      <div v-if="showI" class="minibar mb-strip" role="button" :aria-label="`Interval timer: ${ivWhat}. Open it`" @click="router.push('/timer')">
        <span class="mb-live" :class="{ paused: iv.pausedAt != null }"><Icon name="timer" :size="15" /></span>
        <div class="grow ellipsis"><b>{{ iv.pausedAt != null ? "Paused" : iv.name || "Interval timer" }}</b> · {{ ivWhat }}</div>
        <b class="mb-num">{{ ivLeft }}</b><Icon name="right" :size="16" />
      </div>
    </Transition>
  </div>
  <div v-else class="minibars" :class="{ two }">
    <Transition name="mb">
      <div v-if="showW" class="minibar" role="button" :aria-label="`Workout in progress: ${active.data.value.name}. Open it`" @click="router.push('/workout')">
        <span class="mb-live" :class="{ paused: !!active.data.value.pauseStartedAt }"><Icon name="dumbbell" :size="18" /></span>
        <div class="grow" style="min-width:0">
          <div class="k">{{ active.data.value.pauseStartedAt ? "Workout paused" : "Workout in progress" }}</div>
          <div class="t ellipsis">{{ active.data.value.name }}</div>
        </div>
        <div class="mb-clock"><b>{{ restActive() ? clock(restLeft()) : clock(elapsed(active.data.value)) }}</b><span>{{ restActive() ? (rest.label === "Next exercise" ? "Before the next exercise" : "Resting") : "Elapsed" }}</span></div>
        <Icon name="right" />
      </div>
    </Transition>
    <Transition name="mb">
      <div v-if="showR" class="minibar" role="button" :aria-label="`Recording ${recWhat}. Open it`" @click="router.push('/activities/record')">
        <span class="mb-live" :class="{ paused: !!recording!.pauseAt }"><Icon :name="recIcon" :size="18" /></span>
        <div class="grow" style="min-width:0">
          <div class="k">{{ recording!.pauseAt ? "Recording paused" : "Recording" }}</div>
          <div class="t ellipsis">{{ recWhat }}</div>
        </div>
        <div class="mb-clock"><b>{{ clock(recElapsedS) }}</b><span>Elapsed</span></div>
        <Icon name="right" />
      </div>
    </Transition>
    <Transition name="mb">
      <div v-if="showI" class="minibar" role="button" :aria-label="`Interval timer: ${ivWhat}. Open it`" @click="router.push('/timer')">
        <span class="mb-live" :class="{ paused: iv.pausedAt != null }"><Icon name="timer" :size="18" /></span>
        <div class="grow" style="min-width:0">
          <div class="k">{{ iv.pausedAt != null ? "Interval timer paused" : iv.name || "Interval timer" }}</div>
          <div class="t ellipsis">{{ ivWhat }}</div>
        </div>
        <div class="mb-clock"><b>{{ ivLeft }}</b><span>Left</span></div>
        <Icon name="right" />
      </div>
    </Transition>
  </div>
</template>
