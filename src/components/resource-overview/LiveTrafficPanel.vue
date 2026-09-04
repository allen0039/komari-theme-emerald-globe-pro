<script setup lang="ts">
import type { LiveTrafficModuleContract } from '@/features/resource-overview/contract'
import type { LiveTrafficViewModel } from '@/features/resource-overview/realtime'
import ResourcePanelShell from './ResourcePanelShell.vue'

withDefaults(defineProps<{
  module: LiveTrafficModuleContract
  viewModel: LiveTrafficViewModel
  loading?: boolean
}>(), {
  loading: false,
})
</script>

<template>
  <ResourcePanelShell
    :title="module.title"
    :summary="loading ? module.numericSummary.text : `数值摘要：当前在线探针总带宽 ${viewModel.formattedTotalTraffic}，按上下行合计排序。`"
    :summary-visible="module.numericSummary.visible"
    labelled-by="resource-live-traffic-title"
  >
    <template #controls>
      <span class="rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">Top 5</span>
    </template>

    <div class="mb-2 grid grid-cols-[minmax(0,1fr)_minmax(5.5rem,1.15fr)_2.5rem] gap-2 px-2 text-[10px] uppercase tracking-wider text-muted-foreground">
      <span>探针</span>
      <span>下行 / 上行</span>
      <span class="text-right">占比</span>
    </div>
    <div v-if="loading" class="space-y-2" aria-hidden="true">
      <div v-for="index in 5" :key="index" class="grid h-11 grid-cols-[minmax(0,1fr)_minmax(5.5rem,1.15fr)_2.5rem] items-center gap-2 border-t border-border/60 px-2">
        <span class="h-3 w-2/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <span class="grid gap-2">
          <span class="h-1 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <span class="h-1 w-2/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        </span>
        <span class="h-3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      </div>
    </div>
    <div v-else-if="viewModel.rows.length === 0" class="flex min-h-44 items-center justify-center text-center text-xs text-muted-foreground" role="status">
      暂无在线探针的有效实时速率
    </div>
    <ol v-else aria-label="实时流量 Top 5">
      <li v-for="row in viewModel.rows" :key="row.uuid" :class="module.rendering.rowClass">
        <span :class="module.rendering.nameClass" :title="row.name">{{ row.name }}</span>
        <span class="grid gap-1 text-[10px] tabular-nums text-muted-foreground">
          <span class="grid grid-cols-[3.8rem_minmax(0,1fr)] items-center gap-1">
            <span class="truncate" :title="`下行 ${row.formattedDownload}`">↓ {{ row.formattedDownload }}</span>
            <span class="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true"><span class="block h-full rounded-full bg-emerald-600/80" :style="{ width: `${row.downloadVisualPercentage}%` }" /></span>
          </span>
          <span class="grid grid-cols-[3.8rem_minmax(0,1fr)] items-center gap-1">
            <span class="truncate" :title="`上行 ${row.formattedUpload}`">↑ {{ row.formattedUpload }}</span>
            <span class="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true"><span class="block h-full rounded-full bg-emerald-300 dark:bg-emerald-800" :style="{ width: `${row.uploadVisualPercentage}%` }" /></span>
          </span>
        </span>
        <span class="text-right text-xs tabular-nums text-foreground">{{ row.sharePercentage === null ? '—' : `${row.sharePercentage.toFixed(1)}%` }}</span>
      </li>
    </ol>
  </ResourcePanelShell>
</template>
