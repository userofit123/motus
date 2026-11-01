<script setup lang="ts">
// In the desktop and Android apps: the accounts on this device (local ones and server ones), switching and adding.
import { ref } from "vue";
import Icon from "../Icon.vue";

const nat = (globalThis as any).motusNative?.accounts;
const list = ref<{ id: string; kind: string; name: string; url?: string }[]>([]);
const active = ref<string | null>(null);
nat?.list().then((a: any) => { list.value = a.list; active.value = a.active; });
</script>

<template>
  <div class="col" style="gap:var(--spg)">
    <div class="card">
      <div v-for="a in list" :key="a.id" class="li">
        <Icon :name="a.kind === 'local' ? 'device' : 'server'" :size="18" class="muted" />
        <div class="grow"><div class="t">{{ a.name }}{{ a.id === active ? " · open" : "" }}</div><div class="s">{{ a.kind === "local" ? "Everything on this device" : a.url }}</div></div>
        <button v-if="a.id !== active" class="btn o s" @click="nat.open(a.id)">Open</button>
        <button class="qb danger" @click="nat.remove(a.id)">Remove</button>
      </div>
    </div>
    <button class="btn tonal" @click="nat.chooser()"><Icon name="plus" :size="16" />Add an account</button>
    <p class="tiny">A local account keeps everything on this device. A server account keeps the data on your Motus server; the app itself and the exercise photos stay on this device.</p>
  </div>
</template>
