<script setup lang="ts">
import type { QuotaRankingModuleContract } from '@/features/resource-overview/contract'
import type { QuotaGroupFilter, QuotaRegionFilter, QuotaStatus } from '@/features/resource-overview/realtime'
import type { NodeData } from '@/stores/nodes'
import { Icon } from '@iconify/vue'
import { computed, ref, watch } from 'vue'
import { buildQuotaFilterOptions, buildQuotaRows, selectQuotaRows } from '@/features/resource-overview/realtime'
import ResourcePanelShell from './ResourcePanelShell.vue'

const props = defineProps<{
  module: QuotaRankingModuleContract
  nodes: readonly NodeData[]
  loading?: boolean
}>()

const rankingRange = ref(props.module.rendering.rangeControls[0]?.value ?? 'top-10')
const selectedGroupKey = ref('all')
const selectedRegionKey = ref('all')
const filterOptions = computed(() => buildQuotaFilterOptions(props.nodes))
const groupFilter = computed<QuotaGroupFilter>(() => filterOptions.value.groups.find(option => option.key === selectedGroupKey.value)?.filter ?? { kind: 'all' })
const regionFilter = computed<QuotaRegionFilter>(() => filterOptions.value.regions.find(option => option.key === selectedRegionKey.value)?.filter ?? { kind: 'all' })
const filteredRows = computed(() => buildQuotaRows(props.nodes, { group: groupFilter.value, region: regionFilter.value }))
const rows = computed(() => selectQuotaRows(filteredRows.value, rankingRange.value))
const summary = computed(() => {
  const valid = filteredRows.value.filter(row => row.percentage !== null)
  const exceeded = valid.filter(row => row.percentage! >= 100).length
  return `数值摘要：当前累计计数器中 ${valid.length} 台有有效额度，${exceeded} 台已达到或超过额度。`
})

watch(filterOptions, (options) => {
  if (selectedGroupKey.value !== 'all' && !options.groups.some(option => option.key === selectedGroupKey.value))
    selectedGroupKey.value = 'all'
  if (selectedRegionKey.value !== 'all' && !options.regions.some(option => option.key === selectedRegionKey.value))
    selectedRegionKey.value = 'all'
}, { flush: 'sync' })

function quotaPresentation(status: QuotaStatus): { barClass: string, textClass: string } {
  if (status === 'exceeded' || status === 'reached' || status === 'critical')
    return { barClass: 'bg-destructive', textClass: 'text-destructive' }
  if (status === 'warning')
    return { barClass: 'bg-warning', textClass: 'text-amber-950 dark:text-amber-100' }
  if (status === 'normal')
    return { barClass: 'bg-emerald-600', textClass: 'text-emerald-700 dark:text-emerald-300' }
  return { barClass: 'bg-muted-foreground/40', textClass: 'text-muted-foreground' }
}
</script>

<template>
  <ResourcePanelShell
    :title="module.title"
    :summary="loading ? module.numericSummary.text : summary"
    :summary-visible="module.numericSummary.visible"
    labelled-by="resource-quota-title"
    compact
  >
    <template #controls>
      <div class="flex h-7 items-center rounded-md bg-muted/70 p-0.5" role="group" aria-label="额度排行范围">
        <button
          v-for="control in module.rendering.rangeControls"
          :key="control.value"
          type="button"
          :disabled="loading"
          :aria-label="control.accessibleName"
          :aria-pressed="rankingRange === control.value"
          class="rounded-sm px-1.5 py-1 text-[11px] text-muted-foreground outline-none transition hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
          :class="rankingRange === control.value ? 'bg-background text-emerald-700 shadow-sm dark:text-emerald-300' : ''"
          @click="rankingRange = control.value"
        >
          {{ control.label }}
        </button>
      </div>
    </template>

    <div class="mb-1 grid grid-cols-2 gap-1.5">
      <label class="relative min-w-0">
        <span class="sr-only">按分组筛选额度排行</span>
        <Icon icon="lucide:layers-3" class="pointer-events-none absolute left-2 top-1/2 z-10 size-3 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <select
          v-model="selectedGroupKey"
          :disabled="loading"
          aria-label="按分组筛选额度排行"
          :class="module.rendering.filters[0]?.controlClass"
        >
          <option value="all">全部分组</option>
          <option v-for="option in filterOptions.groups" :key="option.key" :value="option.key">
            {{ option.label }}
          </option>
        </select>
      </label>
      <label class="relative min-w-0">
        <span class="sr-only">按地区筛选额度排行</span>
        <Icon icon="lucide:map-pin" class="pointer-events-none absolute left-2 top-1/2 z-10 size-3 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <select
          v-model="selectedRegionKey"
          :disabled="loading"
          aria-label="按地区筛选额度排行"
          :class="module.rendering.filters[1]?.controlClass"
        >
          <option value="all">全部地区</option>
          <option v-for="option in filterOptions.regions" :key="option.key" :value="option.key">
            {{ option.label }}
          </option>
        </select>
      </label>
    </div>

    <ol v-if="loading" class="max-h-[6rem] overflow-hidden" aria-hidden="true">
      <li v-for="index in 3" :key="index" class="grid h-8 grid-cols-[1.25rem_minmax(0,1fr)_6rem] items-center gap-2 border-t border-border/60">
        <span class="h-3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <span class="h-3 w-2/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <span class="h-5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      </li>
    </ol>
    <ol v-else-if="rows.length" class="max-h-[6rem] overflow-y-auto" aria-label="探针累计流量额度排名">
      <li v-for="(row, index) in rows" :key="row.uuid" class="grid h-8 min-w-0 grid-cols-[1.25rem_minmax(0,1fr)_6rem] items-center gap-2 border-t border-border/60">
        <span class="text-xs tabular-nums text-muted-foreground">{{ index + 1 }}</span>
        <span class="min-w-0">
          <span class="block truncate text-[11px] text-foreground" :title="row.name">{{ row.name }}</span>
          <span class="block truncate text-[9px] text-muted-foreground" :title="`${row.formattedUsed} / ${row.formattedLimit}`">{{ row.formattedUsed }} / {{ row.formattedLimit }}</span>
        </span>
        <span class="min-w-0">
          <span class="flex items-center justify-between gap-1 text-[9px] tabular-nums" :class="quotaPresentation(row.status).textClass">
            <span class="truncate">{{ row.statusLabel }}</span>
            <span v-if="row.percentage !== null">{{ row.percentage.toFixed(1) }}%</span>
          </span>
          <span class="block h-1.5 overflow-hidden rounded-full bg-muted">
            <span class="block h-full rounded-full" :class="quotaPresentation(row.status).barClass" :style="{ width: `${row.visualPercentage}%` }" />
          </span>
        </span>
      </li>
    </ol>
    <p v-else class="flex min-h-40 items-center justify-center text-center text-xs text-muted-foreground" role="status">
      当前筛选范围内暂无有效额度记录
    </p>
  </ResourcePanelShell>
</template>
