<script setup lang="ts">
import type { PressureHeatmapModuleContract } from '@/features/resource-overview/contract'
import type { PressureMatrixCellViewModel, PressureMetric, PressureStatus } from '@/features/resource-overview/realtime'
import type { NodeData } from '@/stores/nodes'
import { Icon } from '@iconify/vue'
import { computed, ref } from 'vue'
import { buildPressureMatrixRows, buildPressureRows } from '@/features/resource-overview/realtime'
import ResourcePanelShell from './ResourcePanelShell.vue'

type PressureDisplay = 'all' | PressureMetric

const props = withDefaults(defineProps<{
  module: PressureHeatmapModuleContract
  nodes?: readonly NodeData[]
  loading?: boolean
}>(), {
  nodes: () => [],
  loading: false,
})

const selectedDisplay = ref<PressureDisplay>('all')
const selectedMetric = computed<PressureMetric>(() => selectedDisplay.value === 'all' ? 'cpu' : selectedDisplay.value)
const selectedMetricLabel = computed(() => props.module.rendering.metrics.find(metric => metric.value === selectedMetric.value)?.label ?? 'CPU')
const matrixRows = computed(() => buildPressureMatrixRows(props.nodes))
const singleRows = computed(() => buildPressureRows(props.nodes, selectedMetric.value))
const summary = computed(() => {
  if (selectedDisplay.value === 'all') {
    const attention = matrixRows.value.filter(row => row.cells.some(cell => cell.status === 'warning' || cell.status === 'critical')).length
    const offline = matrixRows.value.filter(row => row.statusObserved && !row.online).length
    const unknown = matrixRows.value.filter(row => row.cells.some(cell => cell.status === 'unknown')).length
    return `数值摘要：三项压力提醒 ${attention} 台，离线 ${offline} 台，数据未知 ${unknown} 台。`
  }

  const attention = singleRows.value.filter(row => row.status === 'warning' || row.status === 'critical').length
  const offline = singleRows.value.filter(row => row.status === 'offline').length
  const unknown = singleRows.value.filter(row => row.status === 'unknown').length
  return `数值摘要：${selectedMetricLabel.value} 压力提醒 ${attention} 台，离线 ${offline} 台，数据未知 ${unknown} 台。`
})

function statusPresentation(status: PressureStatus): { icon: string, textClass: string, backgroundClass: string } {
  const presentations: Record<PressureStatus, { icon: string, textClass: string, backgroundClass: string }> = {
    normal: { icon: 'lucide:circle-check', textClass: 'text-emerald-700 dark:text-emerald-300', backgroundClass: 'bg-emerald-500/12' },
    warning: { icon: 'lucide:triangle-alert', textClass: 'text-amber-950 dark:text-amber-100', backgroundClass: 'bg-warning/20' },
    critical: { icon: 'lucide:circle-alert', textClass: 'text-destructive', backgroundClass: 'bg-destructive/10' },
    offline: { icon: 'lucide:wifi-off', textClass: 'text-muted-foreground', backgroundClass: 'bg-muted' },
    unknown: { icon: 'lucide:circle-help', textClass: 'text-muted-foreground', backgroundClass: 'bg-muted' },
  }
  return presentations[status]
}

function cellAriaLabel(cell: PressureMatrixCellViewModel): string {
  return `${cell.label} ${cell.formattedPercentage}，${cell.statusLabel}`
}
</script>

<template>
  <ResourcePanelShell
    :title="module.title"
    :summary="loading ? module.numericSummary.text : summary"
    :summary-visible="module.numericSummary.visible"
    labelled-by="resource-pressure-title"
    compact
  >
    <template #controls>
      <div class="flex h-7 items-center rounded-md bg-muted/70 p-0.5" role="group" aria-label="压力显示模式与指标">
        <button
          v-for="control in module.rendering.displayControls"
          :key="control.value"
          type="button"
          :disabled="loading"
          :aria-label="control.accessibleName"
          :aria-pressed="selectedDisplay === control.value"
          class="h-6 rounded-sm px-1.5 text-[9px] text-muted-foreground outline-none transition hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
          :class="selectedDisplay === control.value ? 'bg-background text-emerald-700 shadow-sm dark:text-emerald-300' : ''"
          @click="selectedDisplay = control.value"
        >
          {{ control.label }}
        </button>
      </div>
    </template>

    <div v-if="loading" class="max-h-[8.5rem] overflow-hidden" aria-hidden="true">
      <div class="grid h-6 grid-cols-[minmax(0,1.65fr)_repeat(3,minmax(3.25rem,0.75fr))] items-center gap-1 border-b border-border/70 px-1 text-[10px] text-muted-foreground">
        <span>探针</span><span class="text-center">CPU</span><span class="text-center">内存</span><span class="text-center">硬盘</span>
      </div>
      <div v-for="index in 4" :key="index" class="grid h-7 grid-cols-[minmax(0,1.65fr)_repeat(3,minmax(3.25rem,0.75fr))] items-center gap-1 border-b border-border/50 px-1">
        <span class="h-3 w-2/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <span v-for="metric in 3" :key="metric" class="h-6 animate-pulse rounded-sm bg-muted motion-reduce:animate-none" />
      </div>
    </div>
    <p v-else-if="!matrixRows.length" class="flex min-h-32 items-center justify-center text-center text-xs text-muted-foreground" role="status">
      暂无探针数据
    </p>
    <div
      v-else-if="selectedDisplay === 'all'"
      class="max-h-[8.5rem] overflow-y-auto pr-1"
      :role="module.rendering.semantics.containerRole"
      :aria-label="module.rendering.semantics.ariaLabel"
    >
      <div class="sticky top-0 z-10 grid h-6 grid-cols-[minmax(0,1.65fr)_repeat(3,minmax(3.25rem,0.75fr))] items-center gap-1 border-b border-border/70 bg-background/95 px-1 text-[10px] text-muted-foreground" role="row">
        <span role="columnheader">探针</span>
        <span v-for="metric in module.rendering.metrics" :key="metric.value" class="text-center" role="columnheader">{{ metric.label }}</span>
      </div>
      <div role="rowgroup">
        <div
          v-for="node in matrixRows"
          :key="node.uuid"
          :role="module.rendering.semantics.rowRole"
          class="grid h-7 min-w-0 grid-cols-[minmax(0,1.65fr)_repeat(3,minmax(3.25rem,0.75fr))] items-center gap-1 border-b border-border/50 px-1"
        >
          <span class="truncate text-[11px] text-foreground" :title="node.name" role="rowheader">{{ node.name }}</span>
          <span
            v-for="cell in node.cells"
            :key="cell.metric"
            class="flex h-6 min-w-0 items-center justify-center gap-1 rounded-sm px-1 text-[10px] tabular-nums"
            :class="[statusPresentation(cell.status).backgroundClass, statusPresentation(cell.status).textClass]"
            :aria-label="cellAriaLabel(cell)"
            :title="cellAriaLabel(cell)"
            role="cell"
          >
            <Icon v-if="cell.status !== 'normal'" :icon="statusPresentation(cell.status).icon" class="size-3 shrink-0" aria-hidden="true" />
            <span class="truncate">{{ cell.formattedPercentage }}</span>
          </span>
        </div>
      </div>
    </div>
    <div
      v-else
      class="max-h-[8.5rem] overflow-y-auto pr-1"
      :role="module.rendering.semantics.containerRole"
      :aria-label="`${selectedMetricLabel} 资源压力表，风险同时通过数值、图标和文字标示`"
    >
      <div class="sticky top-0 z-10 grid h-6 grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-center gap-1 border-b border-border/70 bg-background/95 px-1 text-[10px] text-muted-foreground" role="row">
        <span role="columnheader">探针</span>
        <span class="text-center" role="columnheader">压力</span>
        <span class="text-center" role="columnheader">状态</span>
      </div>
      <div role="rowgroup">
        <div
          v-for="node in singleRows"
          :key="node.uuid"
          :role="module.rendering.semantics.rowRole"
          class="grid h-7 min-w-0 grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-center gap-1 border-b border-border/50 px-1"
        >
          <span class="truncate text-[11px] text-foreground" :title="node.name" role="rowheader">{{ node.name }}</span>
          <span
            class="flex h-6 min-w-0 items-center justify-center rounded-sm px-1 text-[10px] tabular-nums"
            :class="[statusPresentation(node.status).backgroundClass, statusPresentation(node.status).textClass]"
            role="cell"
          >
            <span class="truncate">{{ node.formattedPercentage }}</span>
          </span>
          <span
            class="flex min-w-0 items-center justify-center gap-1 text-[9px]"
            :class="statusPresentation(node.status).textClass"
            :aria-label="`${selectedMetricLabel} ${node.formattedPercentage}，${node.statusLabel}`"
            role="cell"
          >
            <Icon :icon="statusPresentation(node.status).icon" class="size-3 shrink-0" aria-hidden="true" />
            <span class="truncate">{{ node.statusLabel }}</span>
          </span>
        </div>
      </div>
    </div>
  </ResourcePanelShell>
</template>
