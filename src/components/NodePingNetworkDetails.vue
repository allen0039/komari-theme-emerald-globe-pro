<script setup lang="ts">
import type { NodePingMetric, NodePingNetworkDisplay } from '@/composables/useNodePingDisplay'
import { DataTooltip } from '@/components/ui/data-tooltip'

const props = defineProps<{
  title: string
  metric: NodePingMetric
  networks: NodePingNetworkDisplay[]
  tooltip: string
  accessibleLabel: string
}>()

const emit = defineEmits<{
  open: []
}>()

function getValue(network: NodePingNetworkDisplay): string {
  return props.metric === 'latency' ? network.latency : network.loss
}

function getValueClass(network: NodePingNetworkDisplay): string {
  return props.metric === 'latency' ? network.latencyToneClass : network.lossToneClass
}

function getBars(network: NodePingNetworkDisplay) {
  return props.metric === 'latency' ? network.latencyBars : network.lossBars
}
</script>

<template>
  <div
    role="button" tabindex="0"
    class="group/ping-detail min-w-0 cursor-pointer rounded-sm text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
    :title="tooltip" :aria-label="accessibleLabel"
    @click.stop="emit('open')"
    @keydown.enter.stop.prevent="emit('open')"
    @keydown.space.stop.prevent="emit('open')"
  >
    <div class="mb-2 flex items-center justify-between text-[11px] leading-none text-muted-foreground">
      <span>{{ title }}</span>
      <span>三网</span>
    </div>

    <div v-if="networks.length" class="flex flex-col gap-2">
      <div v-for="network in networks" :key="network.name" class="min-w-0">
        <DataTooltip
          placement="top"
          :content="`${network.name}\n延迟 ${network.latency}\n丢包 ${network.loss}`"
          content-class="whitespace-pre-wrap w-max px-1.5 !leading-[1.2] text-[11px]"
          class="block"
        >
          <div class="mb-1 flex min-w-0 items-center justify-between gap-1 text-[11px] leading-none">
            <div class="flex min-w-0 items-center gap-1.5">
              <span class="size-2 shrink-0 rounded-full" :class="network.identityClass" />
              <span class="truncate text-muted-foreground">{{ network.name }}</span>
            </div>
            <span class="shrink-0 font-medium" :class="getValueClass(network)">{{ getValue(network) }}</span>
          </div>
        </DataTooltip>

        <div
          class="grid h-1.5 items-end gap-[2px]"
          :style="{ gridTemplateColumns: `repeat(${getBars(network).length}, minmax(0, 1fr))` }"
        >
          <DataTooltip
            v-for="bar in getBars(network)" :key="bar.key" placement="top" :content="bar.tooltip"
            class="h-full w-full" content-class="whitespace-pre-wrap w-max px-1.5 !leading-[1.2] text-[11px]"
          >
            <span
              class="block h-full w-full rounded-[1px] transition-transform duration-150 group-hover/data-tooltip:scale-y-150"
              :class="bar.className"
            />
          </DataTooltip>
        </div>
      </div>
    </div>

    <div v-else class="flex h-14 items-center justify-center text-[11px] text-muted-foreground">
      N/A
    </div>
  </div>
</template>
