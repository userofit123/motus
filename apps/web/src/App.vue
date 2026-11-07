<script setup lang="ts">
// The frame: sign-in until someone is signed in, then the desktop or the phone layout, plus the panels any screen can open.
import { computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { session, loadSession } from "./core/session";
import { isPhone } from "./core/device";
import { startLive, stopLive } from "./api/live";
import { startOpen } from "./core/ui";
import AuthScreen from "./shell/AuthScreen.vue";
import DesktopShell from "./shell/DesktopShell.vue";
import PhoneShell from "./shell/PhoneShell.vue";
import Overlays from "./shell/Overlays.vue";
import Toasts from "./components/Toasts.vue";
import AskHost from "./components/AskHost.vue";
import AccountChooser from "./shell/AccountChooser.vue";
import { isAndroid, installAndroidBridge } from "./native/android";
import { connect } from "./native/accounts";
import { ref } from "vue";

const route = useRoute(), router = useRouter();
// in the Android app, the open account decides where the data is (on the phone or on a server)
const needAccount = ref(false);
onMounted(async () => {
  if (isAndroid()) { installAndroidBridge(); if (!(await connect())) { needAccount.value = true; return; } }
  await loadSession();
});
const signedIn = computed(() => session.ready && !!session.user);
watch(signedIn, (v) => (v ? startLive() : stopLive()), { immediate: true });
// app shortcuts and the manifest open "/?start=1"
watch(() => route.query.start, (v) => { if (v) { startOpen.value = true; router.replace({ query: {} }); } }, { immediate: true });
</script>

<template>
  <AccountChooser v-if="needAccount" />
  <div v-else-if="!session.ready" id="splash"><img src="/icon.svg" alt="" /></div>
  <AuthScreen v-else-if="!session.user" />
  <template v-else>
    <PhoneShell v-if="isPhone" />
    <DesktopShell v-else />
    <Overlays />
  </template>
  <Toasts />
  <AskHost />
</template>
