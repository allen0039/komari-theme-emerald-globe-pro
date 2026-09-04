<script setup lang="ts">
import type { CostOverviewModuleContract } from '@/features/resource-overview/contract'
import type { CostOverviewViewModel } from '@/features/resource-overview/cost'
import type { CurrencyCode } from '@/utils/financeHelper'
import { Icon } from '@iconify/vue'
import { computed } from 'vue'
import { DISPLAY_FINANCE_CURRENCIES, normalizeCurrency } from '@/utils/financeHelper'
import ResourcePanelShell from './ResourcePanelShell.vue'

const props = defineProps<{
  module: CostOverviewModuleContract
  visible: boolean
  currency: CurrencyCode
  model?: CostOverviewViewModel
  loading?: boolean
}>()
const emit = defineEmits<{
  currencyChange: [currency: CurrencyCode]
}>()

const currencyOptions: readonly CurrencyCode[] = DISPLAY_FINANCE_CURRENCIES

const sourceLabels = {
  'network': '当日网络汇率',
  'cache': '当日缓存汇率',
  'stale-cache': '过期缓存汇率',
  'default': '内置估算汇率',
} as const

const metrics = computed(() => {
  if (!props.model)
    return []

  const model = props.model
  const format = (amount: CostOverviewViewModel['formattedMonthly']) => `${amount.symbol}${amount.value}`
  const coverageDetail = `${model.pricedNodes}/${model.totalNodes} 台有效价格`

  if (model.pricingStatus === 'unavailable') {
    return [
      { label: '月均基础成本', detail: '暂无可汇总价格', value: '--' },
      { label: '年化预算', detail: '等待价格数据', value: '--' },
      { label: '未来应续', detail: '暂无可计价续费', value: '--' },
      { label: '价格数据覆盖', detail: coverageDetail, value: `${model.coveragePercentage.toFixed(2)}%` },
    ]
  }

  const estimateDetail = model.pricingStatus === 'partial'
    ? `基于 ${coverageDetail} 估算`
    : `按 ${model.formattedMonthly.currency} 展示`
  return [
    { label: '月均基础成本', detail: estimateDetail, value: format(model.formattedMonthly) },
    { label: '年化预算', detail: model.pricingStatus === 'partial' ? estimateDetail : '按 12 个月估算', value: format(model.formattedAnnual) },
    { label: '未来应续', detail: `${model.dueSoonNodes} 台节点待续`, value: format(model.formattedDueSoon) },
    { label: '价格数据覆盖', detail: `${model.pricedNodes}/${model.totalNodes} 台有效价格`, value: `${model.coveragePercentage.toFixed(2)}%` },
  ]
})

const sourceLabel = computed(() => props.model ? sourceLabels[props.model.rateSource] : '')
const ranking = computed(() => props.model?.monthlyRanking ?? [])

function setDisplayCurrency(event: Event): void {
  emit('currencyChange', normalizeCurrency((event.target as HTMLSelectElement).value))
}

const summary = computed(() => {
  if (!props.visible)
    return '成本信息仅对管理员开放。'

  if (props.model?.pricingStatus === 'unavailable')
    return `数值摘要：${props.model.totalNodes} 台节点中尚无有效价格，无法估算成本。`

  if (props.model?.pricingStatus === 'partial')
    return `数值摘要：成本估算基于 ${props.model.pricedNodes}/${props.model.totalNodes} 台有效价格节点。`

  return props.module.numericSummary.text
})
</script>

<template>
  <ResourcePanelShell
    :title="module.title"
    :summary="summary"
    :summary-visible="module.numericSummary.visible"
    labelled-by="resource-cost-title"
  >
    <div v-if="!visible" class="flex min-h-48 items-center justify-center px-4 text-center">
      <p class="max-w-xs text-sm leading-6 text-muted-foreground">
        成本信息仅对管理员开放
      </p>
    </div>
    <div v-else-if="!model" class="flex min-h-48 items-center justify-center px-4 text-center">
      <p class="text-sm text-muted-foreground">
        {{ loading ? '正在读取成本与汇率' : '成本信息暂不可用' }}
      </p>
    </div>
    <template v-else>
      <div :class="ranking.length > 0 ? 'grid items-start gap-4 xl:grid-cols-[minmax(20rem,0.95fr)_minmax(0,1.05fr)]' : ''">
        <div class="min-w-0">
          <div class="mb-2 flex h-6 items-center justify-between gap-3 px-0.5">
            <p class="text-sm font-semibold text-foreground">
              成本摘要
            </p>
            <span class="text-xs tabular-nums text-muted-foreground">4 项指标</span>
          </div>
          <div class="grid gap-px overflow-hidden rounded-sm border border-border/50 bg-border/50 sm:grid-cols-2">
            <div
              v-for="metric in metrics"
              :key="metric.label"
              class="flex min-h-24 min-w-0 flex-col justify-between gap-4 bg-background/80 px-3 py-3 xl:min-h-[6.75rem]"
            >
              <div class="min-w-0">
                <p class="truncate text-xs font-semibold text-foreground" :title="metric.label">
                  {{ metric.label }}
                </p>
                <p class="mt-1 truncate text-[11px] text-muted-foreground" :title="metric.detail">
                  {{ metric.detail }}
                </p>
              </div>
              <p class="whitespace-nowrap text-right text-xl font-semibold tabular-nums text-foreground">
                {{ metric.value }}
              </p>
            </div>
          </div>
        </div>
        <div v-if="ranking.length > 0" class="min-w-0 border-t border-border/60 pt-3 xl:border-t-0 xl:pt-0">
          <div class="mb-2 flex h-6 items-center justify-between gap-3 px-0.5">
            <p class="text-sm font-semibold text-foreground">
              月均成本排行
            </p>
            <span class="text-xs tabular-nums text-muted-foreground">共 {{ ranking.length }} 台</span>
          </div>
          <ol class="grid max-h-55 auto-rows-6 gap-1 overflow-y-auto overscroll-contain pr-2 [scrollbar-gutter:stable]" :aria-label="`月均成本排行，共 ${ranking.length} 台`">
            <li v-for="(row, index) in ranking" :key="row.uuid" class="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)_minmax(5rem,1.25fr)_auto] items-center gap-2 rounded-sm border border-border/45 bg-muted/20 px-2">
              <span class="text-right text-xs tabular-nums text-muted-foreground">{{ index + 1 }}</span>
              <span class="truncate text-sm font-medium text-foreground" :title="row.name">{{ row.name }}</span>
              <span aria-hidden="true">
                <span class="block h-2 overflow-hidden rounded-full bg-muted">
                  <span class="block h-full rounded-full bg-emerald-600/85" :style="{ width: `${row.visualPercentage}%` }" />
                </span>
              </span>
              <span class="min-w-0 whitespace-nowrap text-right text-sm tabular-nums text-muted-foreground">
                <strong class="font-semibold text-foreground">{{ row.formattedMonthly.symbol }}{{ row.formattedMonthly.value }}</strong>
                <span class="ml-1 text-[11px]">{{ row.billingCycleLabel }}</span>
              </span>
            </li>
          </ol>
        </div>
      </div>
      <div v-if="model.pricingStatus !== 'unavailable'" class="mt-3 flex items-center gap-3 pr-12 sm:pr-0">
        <span class="text-xs text-muted-foreground">汇率来源</span>
        <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{{ sourceLabel }}</span>
        <label class="relative shrink-0">
          <span class="sr-only">成本展示币种</span>
          <select
            :value="currency"
            class="h-7 min-w-18 appearance-none rounded-sm border border-border/70 bg-background/80 py-1 pl-2 pr-7 text-xs font-semibold tabular-nums text-foreground outline-none transition-colors hover:border-emerald-600/50 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20"
            aria-label="成本展示币种"
            @change="setDisplayCurrency"
          >
            <option v-for="option in currencyOptions" :key="option" :value="option">
              {{ option }}
            </option>
          </select>
          <Icon icon="lucide:chevron-down" class="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        </label>
      </div>
      <div v-else class="mt-3 flex items-center gap-2 text-xs text-muted-foreground" role="status">
        <Icon icon="lucide:circle-dollar-sign" class="size-4 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
        <span>价格状态：尚未接入有效价格</span>
      </div>
    </template>
  </ResourcePanelShell>
</template>
