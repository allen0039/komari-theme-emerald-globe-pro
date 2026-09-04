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
  <div class="flex items-center justify-between">
    <span class="truncate">{{ label }}</span>
    <div class="border-t-2 border-dotted border-gray-500/10 mx-2 flex-1" />
    <div v-if="networks.length" class="flex flex-row">
      <DataTooltip
        v-for="(network, index) in networks" :key="network.name" placement="top"
        :content="`${network.name}\n延迟 ${network.latency}\n丢包 ${network.loss}`"
        content-class="whitespace-pre-wrap w-max px-1.5 !leading-[1.2] text-[11px]"
      >
        <div class="truncate">
          <span v-if="index" class="mx-1">·</span>
          <span :class="getValueClass(network)">{{ getValue(network) }}</span>
        </div>
      </DataTooltip>
    </div>
    <div v-else class="truncate">
      N/A
    </div>
  </div>
</template>
