<script setup lang="ts">
// One night in full, opened from Stats → Sleep (a night's bar, its row, last night's card): time asleep against the
// time in bed as a ring, then the night's numbers as on last night's card, its stages, and the heart rate through the
// night. Laid out as a goal's sheet (ring and value on top, then a card per block).
import { computed } from "vue";
import { useSleepNight } from "../../api/queries";
import { useFmt } from "../../core/format";
import { asleepMin, inBedMin, efficiency, hasStages, mins } from "../../core/sleep";
import Sheet from "../Sheet.vue";
import Ring from "../Ring.vue";
import HeartRate from "../HeartRate.vue";
import StageBar from "./StageBar.vue";
import NightStats from "./NightStats.vue";

const props = defineProps<{ date: string }>();
const emit = defineEmits<{ close: [] }>();
const fmt = useFmt();
const q = useSleepNight(computed(() => props.date));
const n = computed(() => q.data.value);
const title = computed(() => fmt.value.date(props.date, { weekday: "long", day: "numeric", month: "long" }));
</script>

<template>
  <Sheet :title="title" @close="emit('close')">
    <template v-if="n">
      <div class="gs-top">
        <Ring :pct="efficiency(n)" :size="64" :stroke="7" />
        <div class="grow">
          <div class="gs-val">{{ mins(asleepMin(n)) }}<small>asleep</small></div>
          <div class="tiny">{{ fmt.time(n.startAt) }}-{{ fmt.time(n.endAt) }} · {{ mins(inBedMin(n)) }} in bed · {{ Math.round(efficiency(n) * 100) }}% of it asleep</div>
        </div>
      </div>
      <div class="tiny ns-note">Time asleep leaves out the time awake in bed.</div>
      <div v-if="n.edited" class="tiny ns-note">Time asleep as you set it for this day; the band measured {{ mins(n.asleepMin) }}.</div>

      <div v-if="n.avgHr != null || n.avgSpo2 != null || n.respRate != null" class="card wkc ns-gap"><NightStats :night="n" no-asleep /></div>
      <div v-if="hasStages(n) || n.awakeMin" class="card ns-gap"><div class="lbl hgap">Stages</div><StageBar :night="n" /></div>
      <HeartRate v-if="(n.hr?.length ?? 0) > 1" class="ns-gap" chart :hr="n.hr" />
    </template>
    <div v-else class="empty">{{ q.isError.value ? "This night is gone." : "Loading…" }}</div>
  </Sheet>
</template>

<style scoped>
/* as a goal's sheet: the blocks a block-gap apart under the ring */
.ns-note { margin-top: var(--hg); }
.ns-gap { margin-top: var(--spg); }
</style>
