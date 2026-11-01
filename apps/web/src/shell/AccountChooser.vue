<script setup lang="ts">
// First screen of the Android app: use Motus on this phone, or connect to a server. Existing accounts to open.
import { ref } from "vue";
import { accounts, addLocal, addServer, open, remove } from "../native/accounts";
import Logo from "./Logo.vue";
import Icon from "../components/Icon.vue";

const mode = ref<"" | "local" | "server">("");
const name = ref("Me"), url = ref(""), user = ref(""), pass = ref(""), err = ref(""), busy = ref(false);
async function connect() {
  err.value = ""; busy.value = true;
  try { await addServer(url.value.trim(), user.value.trim(), pass.value); } catch (e) { err.value = (e as Error).message; } finally { busy.value = false; }
}
</script>

<template>
  <div class="auth">
    <div class="card">
      <Logo />
      <template v-if="!mode">
        <h1>Motus</h1>
        <p class="muted" style="margin-bottom:18px">{{ accounts.list.length ? "Open an account, or add another." : "Choose how to use Motus. You can add the other kind later." }}</p>
        <div class="opt-list">
          <div v-for="a in accounts.list" :key="a.id" class="row"><button class="optb" @click="open(a.id)"><span class="oi">{{ a.name.slice(0, 1).toUpperCase() }}</span><div class="grow"><div class="t">{{ a.name }}</div><div class="s">{{ a.kind === "local" ? "On this phone" : a.url }}</div></div></button><button class="ib sm plain" aria-label="Remove" @click="remove(a.id)"><Icon name="close" :size="16" /></button></div>
          <button class="optb" @click="mode = 'local'"><span class="oi"><Icon name="device" /></span><div class="grow"><div class="t">Use Motus on this phone</div><div class="s">Everything stays here. Nothing to set up.</div></div></button>
          <button class="optb" @click="mode = 'server'"><span class="oi"><Icon name="server" /></span><div class="grow"><div class="t">Connect to a server</div><div class="s">Your data on your own Motus server, the same on every device.</div></div></button>
        </div>
      </template>
      <template v-else-if="mode === 'local'">
        <h1>On this phone</h1>
        <div class="fld"><label>Your name</label><input v-model="name" /></div>
        <button class="btn block lg" @click="addLocal(name)">Start</button>
        <button class="qb" style="margin:10px auto 0;display:flex" @click="mode = ''">Back</button>
      </template>
      <template v-else>
        <h1>Your server</h1>
        <div class="fld"><label>Address</label><input v-model="url" placeholder="motus.example.com" autocapitalize="off" inputmode="url" /></div>
        <div class="fld"><label>Username</label><input v-model="user" autocapitalize="off" autocomplete="username" /></div>
        <div class="fld"><label>Password</label><input v-model="pass" type="password" autocomplete="current-password" /></div>
        <div v-if="err" class="err">{{ err }}</div>
        <button class="btn block lg" :disabled="busy" @click="connect">Sign in</button>
        <button class="qb" style="margin:10px auto 0;display:flex" @click="mode = ''">Back</button>
      </template>
    </div>
  </div>
</template>
