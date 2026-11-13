<script setup lang="ts">
// The filter block above a list (first made for the exercise picker): a panel of labelled chip rows (FilterRow),
// then how many match and "Clear filters" once anything is narrowed, so every list filters the same way.
// The panel is a card like the blocks around it (and takes each surface style with it), not a shaded box of its own.
defineProps<{ count?: string; active?: boolean }>();
const emit = defineEmits<{ clear: [] }>();
</script>

<template>
  <div class="fpanel">
    <div class="card fbox"><slot /></div>
    <div v-if="count || active" class="row ffoot">
      <span class="tiny grow">{{ count }}</span>
      <button v-if="active" class="qb" @click="emit('clear')">Clear filters</button>
    </div>
  </div>
</template>

<style scoped>
/* sits --hg above the list it filters, like a heading; inside, a smaller card padding (FilterRow bleeds its chips to it) */
.fpanel { margin-bottom: var(--hg); }
.fbox { display: flex; flex-direction: column; gap: 10px; padding: calc(var(--cpy) - 3px) calc(var(--cpx) - 4px); }
.ffoot { margin: 2px 0 0; min-height: 28px; }
.ffoot .qb { padding: 4px 8px; font-size: 12.5px; }
</style>
