<script setup lang="ts">
import { onMounted, ref } from "vue";

type Health = { ok: boolean; node: string; db: { ok: boolean; version?: string; error?: string } };

const health = ref<Health | null>(null);
const failed = ref(false);

onMounted(async () => {
  try {
    const res = await fetch("/api/health");
    health.value = (await res.json()) as Health;
  } catch {
    failed.value = true;
  }
});
</script>

<template>
  <main class="page">
    <header>
      <h1>Motus</h1>
      <p class="sub">In development · this page updates live as the app is built</p>
    </header>

    <section class="cards">
      <div class="card hero">
        <div class="lbl">Web app</div>
        <div class="val">Running</div>
        <div class="note">Vite hot reload through motus.local</div>
      </div>
      <div class="card">
        <div class="lbl">Server</div>
        <div class="val" :class="{ bad: failed }">{{ failed ? "Unreachable" : health ? "Running" : "…" }}</div>
        <div class="note">{{ health ? `Node ${health.node}` : " " }}</div>
      </div>
      <div class="card">
        <div class="lbl">Database</div>
        <div class="val" :class="{ bad: health && !health.db.ok }">
          {{ !health ? "…" : health.db.ok ? "Connected" : "Error" }}
        </div>
        <div class="note">{{ health?.db.ok ? `PostgreSQL ${health.db.version}` : health?.db.error ?? " " }}</div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.page { max-width: 1100px; margin: 0 auto; padding: 40px 32px; }
h1 { font-size: 30px; font-weight: 600; margin: 0; letter-spacing: -0.5px; }
.sub { color: var(--tx2); margin: 2px 0 28px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
.card { background: var(--s1); border: 1px solid var(--ol); border-radius: var(--r); padding: 18px 20px; }
.card.hero {
  background: linear-gradient(140deg, var(--accc), color-mix(in srgb, var(--accc) 55%, var(--s1)));
  color: var(--onc);
}
.lbl { font-size: 13px; font-weight: 500; color: var(--tx2); }
.hero .lbl, .hero .note { color: color-mix(in srgb, var(--onc) 75%, transparent); }
.val { font-size: 32px; font-weight: 600; letter-spacing: -1px; font-variant-numeric: tabular-nums; }
.val.bad { color: var(--neg); }
.note { font-size: 12.5px; color: var(--tx2); }
@media (max-width: 600px) { .page { padding: 24px 16px; } }
</style>
