<script setup lang="ts">
// The phone's "More" tab: you at the top, the pages that don't fit in the tab bar, quick logging, then the way into
// Settings. Settings itself holds every option; this page only links to the few you reach for often.
import { computed } from "vue";
import { useRouter } from "vue-router";
import { logSheet, bodySheet, dailySheet, activitySheet, appearanceOpen } from "../core/ui";
import { useSettings, useMe, useHealthAvailable } from "../api/queries";
import Icon from "../components/Icon.vue";
const router = useRouter();
const s = useSettings();
const me = useMe();
const user = computed(() => me.data.value?.user);
const initials = computed(() => (user.value?.displayName || user.value?.username || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join(""));
// Sleep and Heart are Stats' tabs, listed here (the one tap to them on the phone) only once a band has handed that over
const avail = useHealthAvailable();
const PAGES = computed<[to: string, label: string, icon: string, hint: string][]>(() => [
  ["/exercises", "Exercises", "dumbbell", "The library, and your own"], ["/body", "Body", "scale", "Weight, measurements, photos, about you"],
  ...(avail.data.value?.sleep ? [["/stats?tab=sleep", "Sleep", "moon", "Nights, stages and bedtimes"] as [string, string, string, string]] : []),
  ...(avail.data.value?.heart ? [["/stats?tab=heart", "Heart", "heart", "Resting heart rate, HRV and blood oxygen"] as [string, string, string, string]] : [])]);
</script>

<template>
  <div class="page">
    <div class="ph"><h1>More</h1></div>
    <!-- you: opens your account -->
    <div class="card click me" role="button" tabindex="0" @click="router.push('/settings/account')" @keydown.enter="router.push('/settings/account')">
      <div class="av" aria-hidden="true">{{ initials }}</div>
      <div class="grow" style="min-width:0"><div class="t ellipsis">{{ user?.displayName || user?.username }}</div><div class="tiny ellipsis">@{{ user?.username }}</div></div>
      <Icon name="right" class="muted" />
    </div>

    <div class="sh"><h2>Pages</h2></div>
    <div class="card flush">
      <div v-for="[to, l, ic, h] in PAGES" :key="to" class="li click" @click="router.push(to)"><span class="bi sg"><Icon :name="ic" :size="17" /></span><div class="grow"><div class="t">{{ l }}</div><div class="s">{{ h }}</div></div><Icon name="right" :size="16" class="muted" /></div>
    </div>

    <!-- the same entries, names and order as the Log section of the + sheet (shell/StartSheet.vue) -->
    <div class="sh"><h2>Log</h2></div>
    <div class="card flush">
      <div class="li click" @click="logSheet = {}"><span class="bi sg"><Icon name="history" :size="17" /></span><span class="grow t">Past workout</span><Icon name="plus" :size="16" class="muted" /></div>
      <div class="li click" @click="activitySheet = { type: 'walk' }"><span class="bi sg"><Icon name="walk" :size="17" /></span><span class="grow t">Activity</span><Icon name="plus" :size="16" class="muted" /></div>
      <div class="li click" @click="bodySheet = true"><span class="bi sg"><Icon name="scale" :size="17" /></span><span class="grow t">Body weight</span><Icon name="plus" :size="16" class="muted" /></div>
      <div v-if="s.features.measurements" class="li click" @click="bodySheet = 'tape'"><span class="bi sg"><Icon name="target" :size="17" /></span><span class="grow t">Measurements</span><Icon name="plus" :size="16" class="muted" /></div>
      <div v-if="s.features.steps || s.features.dailyLog" class="li click" @click="dailySheet = true"><span class="bi sg"><Icon :name="s.features.steps ? 'steps' : 'moon'" :size="17" /></span><span class="grow t">{{ s.features.dailyLog ? (s.features.steps ? "Steps, sleep, water, mood" : "Sleep, water, mood") : "Steps" }}</span><Icon name="plus" :size="16" class="muted" /></div>
    </div>

    <div class="sh"><h2>App</h2></div>
    <div class="card flush">
      <!-- data-theme-open keeps the panel's outside-click from closing it again -->
      <div class="li click" data-theme-open @click="appearanceOpen = !appearanceOpen"><span class="bi sg"><Icon name="palette" :size="17" /></span><div class="grow"><div class="t">Appearance</div><div class="s">Colours, style, layout</div></div></div>
      <div class="li click" @click="router.push('/settings')"><span class="bi sg"><Icon name="settings" :size="17" /></span><div class="grow"><div class="t">Settings</div><div class="s">Workouts, units, features, your data</div></div><Icon name="right" :size="16" class="muted" /></div>
    </div>
  </div>
</template>

<style scoped>
.me { display: flex; align-items: center; gap: var(--cpx); }
.me .t { font-weight: 600; font-size: 16px; }
.av { width: 48px; height: 48px; border-radius: 50%; flex: none; display: grid; place-items: center; background: var(--accc); color: var(--onc); font-size: 18px; font-weight: 700; }
</style>
