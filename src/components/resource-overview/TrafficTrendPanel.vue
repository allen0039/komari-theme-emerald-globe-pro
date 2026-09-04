<script setup lang="ts">
import type { TrafficTrendModuleContract } from '@/features/resource-overview/contract'
import type { TrafficTrendDayViewModel, TrafficTrendSnapshot } from '@/features/resource-overview/trafficTrend'
import { Icon } from '@iconify/vue'
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { DataTooltip } from '@/components/ui/data-tooltip'
import {
  trafficCoverageLines,
  trafficQualityLabel,
  trafficReasonLabel,
  trafficSourceLabel,
  trafficTrendStatusMessages,
} from '@/features/resource-overview/trafficTrendPresentation'
import { formatBytes } from '@/utils/helper'
import ResourcePanelShell from './ResourcePanelShell.vue'

const props = withDefaults(defineProps<{
  module: TrafficTrendModuleContract
  snapshot: TrafficTrendSnapshot
  loading?: boolean
  refreshing?: boolean
  onRefresh?: () => void | Promise<void>
}>(), {
  loading: false,
  refreshing: false,
  onRefresh: () => undefined,
})

const hasTrendData = computed(() => props.snapshot.days.length > 0)
const showBars = computed(() => props.snapshot.state === 'ready' || (props.loading && hasTrendData.value))
const largestKnownTotal = computed(() => Math.max(
  1,
  ...props.snapshot.days.flatMap(day => day.totalBytes === null ? [] : [day.totalBytes]),
))
const statusMessages = computed(() => trafficTrendStatusMessages(
  props.snapshot.failureKind,
  props.snapshot.availability,
))
const panelSummary = computed(() => statusMessages.value[0] || props.snapshot.message || props.module.numericSummary.text)
const panelSupplement = computed(() => statusMessages.value.slice(1))

function dayLabel(date: string): string {
  return `${date.slice(5, 7)}/${date.slice(8, 10)}`
}

function formatTraffic(value: number | null): string {
  return value === null ? '未知' : formatBytes(value)
}

function barHeight(value: number | null): string {
  if (value === null)
    return '100%'
  if (value === 0)
    return '1px'
  return `${Math.max(1, Math.min(100, value / largestKnownTotal.value * 100))}%`
}

function sourceLabel(day: TrafficTrendDayViewModel): string {
  return trafficSourceLabel(day.source)
}

function evidenceLines(day: TrafficTrendDayViewModel): string[] {
  const lines = [
    `下载：${formatTraffic(day.downloadBytes)}`,
    `上传：${formatTraffic(day.uploadBytes)}`,
    `总量：${formatTraffic(day.totalBytes)}`,
    `来源：${sourceLabel(day)}`,
    `质量：${trafficQualityLabel(day.quality)}`,
    ...trafficCoverageLines(day.coverage),
  ]
  const reason = day.reasons[0]
  if (reason)
    lines.push(`原因：${trafficReasonLabel(reason)}`)
  return lines
}

function dayAriaLabel(day: TrafficTrendDayViewModel): string {
  return `${day.date}：${evidenceLines(day).join('，')}`
}

function refreshTrend() {
  void props.onRefresh()
}
</script>

<template>
  <ResourcePanelShell
    :title="module.title"
    :summary="panelSummary"
    :summary-visible="module.numericSummary.visible"
    labelled-by="resource-traffic-trend-title"
    compact
    allow-overflow
  >
    <template #controls>
      <div class="flex items-center gap-1.5 text-[11px] text-muted-foreground" aria-label="趋势图图例与刷新操作">
        <span class="inline-flex items-center gap-1"><span class="size-2 rounded-full bg-emerald-600" /><span class="hidden sm:inline">下载</span><span class="sr-only">下载</span></span>
        <span class="inline-flex items-center gap-1"><span class="size-2 rounded-full bg-emerald-300 dark:bg-emerald-700" /><span class="hidden sm:inline">上传</span><span class="sr-only">上传</span></span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          :disabled="loading || refreshing"
          aria-label="刷新 5 日流量趋势"
          @click="refreshTrend"
        >
          <Icon icon="lucide:refresh-cw" :class="refreshing ? 'animate-spin motion-reduce:animate-none' : ''" aria-hidden="true" />
          {{ refreshing ? '刷新中' : '刷新趋势' }}
        </Button>
      </div>
    </template>

    <div
      v-if="showBars"
      class="flex h-32 min-w-0 items-end gap-2 border-b border-l border-border/70 px-2 pt-2"
      role="group"
      aria-label="5 日上传与下载流量趋势图"
    >
      <DataTooltip
        v-for="day in snapshot.days"
        :key="day.date"
        as="button"
        placement="top"
        class="flex min-w-0 flex-1 flex-col items-center justify-end gap-2 rounded-sm outline-none hover:z-30 focus-within:z-30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        content-class="w-60 rounded-md p-3 text-left text-[11px] leading-5"
        :aria-label="dayAriaLabel(day)"
      >
        <div class="grid h-20 w-full max-w-8 grid-cols-2 items-end gap-px overflow-hidden rounded-t-sm bg-muted/60" aria-hidden="true">
          <span class="flex h-full min-w-0 items-end bg-emerald-500/10">
            <span
              v-if="day.downloadBytes !== null"
              class="block w-full bg-emerald-600/85"
              :style="{ height: barHeight(day.downloadBytes) }"
            />
            <span v-else class="h-full w-full bg-[repeating-linear-gradient(135deg,transparent_0,transparent_3px,oklch(0.7_0.02_160)_3px,oklch(0.7_0.02_160)_4px)] dark:bg-[repeating-linear-gradient(135deg,transparent_0,transparent_3px,oklch(0.4_0.02_160)_3px,oklch(0.4_0.02_160)_4px)]" />
          </span>
          <span class="flex h-full min-w-0 items-end bg-emerald-500/10">
            <span
              v-if="day.uploadBytes !== null"
              class="block w-full bg-emerald-300 dark:bg-emerald-700"
              :style="{ height: barHeight(day.uploadBytes) }"
            />
            <span v-else class="h-full w-full bg-[repeating-linear-gradient(135deg,transparent_0,transparent_3px,oklch(0.7_0.02_160)_3px,oklch(0.7_0.02_160)_4px)] dark:bg-[repeating-linear-gradient(135deg,transparent_0,transparent_3px,oklch(0.4_0.02_160)_3px,oklch(0.4_0.02_160)_4px)]" />
          </span>
        </div>
        <span class="text-[10px] tabular-nums text-muted-foreground">{{ dayLabel(day.date) }}</span>
        <template #content>
          <span class="block font-medium text-background">{{ day.date }}<span v-if="day.isInProgress"> · 进行中</span></span>
          <span v-for="(line, index) in evidenceLines(day)" :key="line" :class="index === 0 ? 'mt-1 block' : 'block'">{{ line }}</span>
        </template>
      </DataTooltip>
    </div>

    <div
      v-else
      class="flex h-32 items-center justify-center border-y border-border/70 px-4 text-center text-xs leading-5 text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <Icon
        :icon="snapshot.state === 'error' ? 'lucide:circle-alert' : snapshot.state === 'unsupported' ? 'lucide:circle-help' : 'lucide:chart-no-axes-column'"
        class="mr-2 size-4 shrink-0"
        aria-hidden="true"
      />
      <div class="min-w-0">
        <p>{{ panelSummary }}</p>
        <p v-for="message in panelSupplement" :key="message" class="mt-1">
          {{ message }}
        </p>
      </div>
    </div>

    <table v-if="hasTrendData" class="sr-only w-px table-fixed">
      <caption>5 日上传与下载流量明细</caption>
      <thead><tr><th>日期</th><th>下载</th><th>上传</th><th>总量</th><th>来源</th><th>质量</th><th>平均覆盖</th><th>最低覆盖</th><th>有效探针</th><th>原因</th></tr></thead>
      <tbody>
        <tr v-for="day in snapshot.days" :key="`table-${day.date}`">
          <td>{{ day.date }}<span v-if="day.isInProgress">（进行中）</span></td>
          <td>{{ formatTraffic(day.downloadBytes) }}</td>
          <td>{{ formatTraffic(day.uploadBytes) }}</td>
          <td>{{ formatTraffic(day.totalBytes) }}</td>
          <td>{{ sourceLabel(day) }}</td>
          <td>{{ trafficQualityLabel(day.quality) }}</td>
          <td>{{ trafficCoverageLines(day.coverage)[0] }}</td>
          <td>{{ trafficCoverageLines(day.coverage)[1] }}</td>
          <td>{{ trafficCoverageLines(day.coverage)[2] }}</td>
          <td><span v-if="day.reasons[0]">{{ trafficReasonLabel(day.reasons[0]) }}</span></td>
        </tr>
      </tbody>
    </table>
  </ResourcePanelShell>
</template>
