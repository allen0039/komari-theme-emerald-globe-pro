<script setup lang="ts">
import type { RenewalTimelineModuleContract } from '@/features/resource-overview/contract'
import type { RenewalFilter, RenewalTimelineRowViewModel } from '@/features/resource-overview/renewal'
import type { NodeData } from '@/stores/nodes'
import { Icon } from '@iconify/vue'
import { computed, ref, watch } from 'vue'
import { buildRenewalTimelineViewModel } from '@/features/resource-overview/renewal'
import ResourcePanelShell from './ResourcePanelShell.vue'

const props = withDefaults(defineProps<{
  module: RenewalTimelineModuleContract
  nodes?: readonly NodeData[]
  loading?: boolean
  now?: Date
  warningDays?: number
}>(), {
  nodes: () => [],
  loading: false,
  now: () => new Date(),
  warningDays: 30,
})

const filterControls = computed<Array<{ value: RenewalFilter, label: string }>>(() => [
  { value: 'upcoming', label: `${props.warningDays} 天内` },
  { value: 'expired', label: '已过期' },
  { value: 'all', label: '全部' },
])
const selectedFilter = ref<RenewalFilter>('upcoming')
const expanded = ref(false)
const collapsedViewModel = computed(() => buildRenewalTimelineViewModel(
  props.nodes,
  props.now,
  props.module.rendering.maxItems,
  selectedFilter.value,
  props.warningDays,
))
const viewModel = computed(() => buildRenewalTimelineViewModel(
  props.nodes,
  props.now,
  expanded.value ? Number.POSITIVE_INFINITY : props.module.rendering.maxItems,
  selectedFilter.value,
  props.warningDays,
))
const canToggleExpansion = computed(() => collapsedViewModel.value.hidden > 0)
const summary = computed(() => {
  if (viewModel.value.total === 0)
    return '数值摘要：当前探针未设置有效到期日期。'

  const hidden = viewModel.value.hidden > 0 ? `，另有 ${viewModel.value.hidden} 台未展开` : ''
  return `数值摘要：已记录 ${viewModel.value.total} 台，未来 ${props.warningDays} 天 ${viewModel.value.upcoming30} 台，已过期 ${viewModel.value.expired} 台${hidden}。`
})

watch(selectedFilter, () => {
  expanded.value = false
})

function statusPresentation(status: RenewalTimelineRowViewModel['status']): {
  dotClass: string
  textClass: string
  icon: string
} {
  if (status === 'expired' || status === 'critical') {
    return {
      dotClass: 'bg-destructive ring-destructive',
      textClass: 'text-destructive',
      icon: 'lucide:triangle-alert',
    }
  }
  if (status === 'warning') {
    return {
      dotClass: 'bg-warning ring-warning',
      textClass: 'text-amber-950 dark:text-amber-100',
      icon: 'lucide:clock-alert',
    }
  }
  if (status === 'long_term') {
    return {
      dotClass: 'bg-muted-foreground ring-muted-foreground',
      textClass: 'text-muted-foreground',
      icon: 'lucide:infinity',
    }
  }
  return {
    dotClass: 'bg-emerald-600 ring-emerald-600',
    textClass: 'text-emerald-700 dark:text-emerald-300',
    icon: 'lucide:calendar-check-2',
  }
}
</script>

<template>
  <ResourcePanelShell
    :title="module.title"
    :summary="loading ? module.numericSummary.text : summary"
    :summary-visible="module.numericSummary.visible"
    labelled-by="resource-renewal-title"
  >
    <template #controls>
      <div class="flex h-7 items-center rounded-md bg-muted/70 p-0.5" role="group" aria-label="续费时间线筛选">
        <button
          v-for="control in filterControls"
          :key="control.value"
          type="button"
          :disabled="loading"
          :aria-pressed="selectedFilter === control.value"
          class="rounded-sm px-1.5 py-1 text-[11px] text-muted-foreground outline-none transition hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
          :class="selectedFilter === control.value ? 'bg-background text-emerald-700 shadow-sm dark:text-emerald-300' : ''"
          @click="selectedFilter = control.value"
        >
          {{ control.label }}
        </button>
      </div>
    </template>

    <ol v-if="loading" :class="module.rendering.listClass" aria-hidden="true">
      <li v-for="index in module.rendering.maxItems" :key="index" class="relative min-w-0 border-l border-border/80 py-2 pl-6 md:border-l-0 md:border-t md:px-3 md:pt-6">
        <span class="absolute left-[-5px] top-4 size-2.5 rounded-full border-2 border-background bg-muted ring-1 ring-muted md:left-3 md:top-[-5px]" />
        <div class="space-y-2">
          <span class="block h-4 w-4 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <span class="block h-3 w-16 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <span class="block h-3 w-3/4 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <span class="block h-3 w-20 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        </div>
      </li>
    </ol>
    <ol v-else-if="viewModel.rows.length" :class="module.rendering.listClass" aria-label="按续费风险和日期排列的探针">
      <li v-for="event in viewModel.rows" :key="event.uuid" class="group relative min-w-0 border-l border-border/80 py-2 pl-6 md:border-l-0 md:border-t md:px-3 md:pt-6">
        <span class="absolute left-[-5px] top-4 size-2.5 rounded-full border-2 border-background ring-1 md:left-3 md:top-[-5px]" :class="statusPresentation(event.status).dotClass" aria-hidden="true" />
        <div class="flex min-w-0 items-start gap-2 md:block">
          <Icon :icon="statusPresentation(event.status).icon" class="mt-0.5 shrink-0 md:mb-2" :class="statusPresentation(event.status).textClass" aria-hidden="true" />
          <div class="min-w-0">
            <p class="text-[10px] tabular-nums text-muted-foreground">
              {{ event.date }}
            </p>
            <p class="mt-1 truncate text-xs font-medium">
              <RouterLink
                :to="{ name: 'instance-detail', params: { id: event.uuid } }"
                class="rounded-sm text-foreground outline-none transition hover:text-emerald-700 focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:text-emerald-300"
                :title="event.name"
              >
                {{ event.name }}
              </RouterLink>
            </p>
            <p class="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] tabular-nums">
              <span :class="statusPresentation(event.status).textClass">{{ event.timingLabel }}</span>
              <span class="text-muted-foreground">{{ event.statusLabel }} · {{ event.renewalLabel }}</span>
            </p>
          </div>
        </div>
      </li>
    </ol>
    <div v-else class="flex min-h-40 flex-col items-center justify-center gap-3 text-center" role="status">
      <Icon icon="lucide:calendar-off" class="size-6 text-muted-foreground" aria-hidden="true" />
      <p class="text-xs text-muted-foreground">
        当前探针未设置有效到期日期
      </p>
    </div>
    <button
      v-if="!loading && canToggleExpansion"
      type="button"
      class="mt-3 rounded-sm text-xs font-medium text-emerald-700 outline-none transition hover:text-emerald-800 focus-visible:ring-2 focus-visible:ring-ring/50 dark:text-emerald-300 dark:hover:text-emerald-200"
      @click="expanded = !expanded"
    >
      {{ expanded ? '收起' : `展开其余 ${collapsedViewModel.hidden} 台` }}
    </button>
  </ResourcePanelShell>
</template>
