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
  <div class="flex justify-between" :class="networks.length > 3 ? 'items-start' : 'items-center'">
    <span class="shrink-0 truncate leading-4">{{ label }}</span>
    <div
      class="mx-2 flex-1 border-t-2 border-dotted border-gray-500/10"
      :class="networks.length > 3 ? 'mt-[7px]' : ''"
    />
    <div v-if="networks.length && networks.length <= 3" class="flex flex-row">
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
    <div
      v-else-if="networks.length"
      class="grid w-36 max-w-[66%] shrink-0 grid-cols-3 gap-x-2 gap-y-1"
    >
      <DataTooltip
        v-for="network in networks" :key="network.name" placement="top"
        :content="`${network.name}\n延迟 ${network.latency}\n丢包 ${network.loss}`"
        content-class="whitespace-pre-wrap w-max px-1.5 !leading-[1.2] text-[11px]"
        class="min-w-0"
      >
        <div class="min-w-0 text-center leading-4">
          <span class="whitespace-nowrap" :class="getValueClass(network)">{{ getValue(network) }}</span>
        </div>
      </DataTooltip>
    </div>
    <div v-else class="truncate">
      N/A
    </div>
  </div>
</template>
