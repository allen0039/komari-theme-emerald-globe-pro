<script setup lang="ts">
import type { NodePingMetric, NodePingNetworkDisplay } from '@/composables/useNodePingDisplay'
import { DataTooltip } from '@/components/ui/data-tooltip'

const props = defineProps<{
  label: string
  metric: NodePingMetric
  networks: NodePingNetworkDisplay[]
}>()

function getValue(network: NodePingNetworkDisplay): string {
  return props.metric === 'latency' ? network.latency : network.loss
}

function getValueClass(network: NodePingNetworkDisplay): string {
  return props.metric === 'latency' ? network.latencyToneClass : network.lossToneClass
}
</script>

<template>
  <div class="flex min-w-0 items-center justify-between">
    <span class="shrink-0 truncate">{{ label }}</span>
    <div class="mx-2 min-w-2 flex-1 border-t-2 border-dotted border-gray-500/10" />
    <div v-if="networks.length" class="flex shrink-0 flex-row items-center whitespace-nowrap">
      <DataTooltip
        v-for="(network, index) in networks" :key="network.name" placement="top"
        :content="`${network.name}\n延迟 ${network.latency}\n丢包 ${network.loss}`"
        content-class="whitespace-pre-wrap w-max px-1.5 !leading-[1.2] text-[11px]"
        class="shrink-0"
      >
        <div class="whitespace-nowrap">
          <span v-if="index" :class="networks.length > 3 ? 'mx-0.5' : 'mx-1'">·</span>
          <span :class="getValueClass(network)">{{ getValue(network) }}</span>
        </div>
      </DataTooltip>
    </div>
    <div v-else class="truncate">
      N/A
    </div>
  </div>
</template>
