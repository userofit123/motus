<script setup lang="ts">
// In the desktop and Android apps: the accounts on this device (local ones and saved servers), switching and adding.
import { ref } from "vue";
import Icon from "../Icon.vue";
import Menu from "../Menu.vue";
import { prompt } from "../../core/ask";

const nat = (globalThis as any).motusNative?.accounts;
const list = ref<{ id: string; kind: string; name: string; url?: string }[]>([]);
const active = ref<string | null>(null);
const load = () => nat?.list().then((a: any) => { list.value = a.list; active.value = a.active; });
load();
async function rename(id: string, cur: string) {
  const n = await prompt("Name", { value: cur });
  if (n) { await nat.rename(id, n); load(); }
}
</script>

<template>
  <div class="stack">
    <div class="card">
      <div v-for="a in list" :key="a.id" class="li">
        <Icon :name="a.kind === 'local' ? 'device' : 'server'" :size="18" class="muted" />
        <div class="grow"><div class="t">{{ a.name }}{{ a.id === active ? " · open" : "" }}</div><div class="s">{{ a.kind === "local" ? "Everything on this device" : a.url }}</div></div>
        <button v-if="a.id !== active" class="btn o s" @click="nat.open(a.id)">Open</button>
        <Menu :items="[{ label: 'Rename', icon: 'edit', run: () => rename(a.id, a.name) }, { label: 'Remove', icon: 'trash', danger: true, sep: true, run: () => nat.remove(a.id) }]" />
      </div>
    </div>
    <button class="btn tonal" @click="nat.chooser()"><Icon name="plus" :size="16" />Add an account or server</button>
    <p class="tiny">A local account keeps everything on this device. A server account shows the data from your Motus server; the app itself and the exercise photos stay on this device. Each keeps its own copy here, so switching never mixes them.</p>
  </div>
</template>
