<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { asking } from "../core/ask";
import Sheet from "./Sheet.vue";

const inp = ref<HTMLInputElement | null>(null);
watch(() => asking.cur, async (c) => { if (c?.input) { await nextTick(); inp.value?.focus(); inp.value?.select(); } });
function done(v: unknown) { const c = asking.cur; asking.cur = null; c?.resolve(v); }
const cancel = () => done(asking.cur?.input || asking.cur?.choices ? null : false);
</script>

<template>
  <Sheet v-if="asking.cur" :title="asking.cur.title" @close="cancel">
    <p v-if="asking.cur.text" class="muted" style="margin-bottom:12px;line-height:1.5">{{ asking.cur.text }}</p>
    <input v-if="asking.cur.input" ref="inp" v-model="asking.cur.input.value" class="in" :placeholder="asking.cur.input.placeholder" @keydown.enter="done(asking.cur.input.value.trim() || null)" />
    <div v-if="asking.cur.choices" class="opt-list">
      <button v-for="c in asking.cur.choices" :key="c.value" class="optb" @click="done(c.value)"><span class="t">{{ c.label }}</span></button>
    </div>
    <template v-if="!asking.cur.choices" #foot>
      <button class="btn o" @click="cancel">Cancel</button>
      <button class="btn" :class="{ r: asking.cur.danger }" @click="done(asking.cur.input ? asking.cur.input.value.trim() || null : true)">{{ asking.cur.ok }}</button>
    </template>
  </Sheet>
</template>
