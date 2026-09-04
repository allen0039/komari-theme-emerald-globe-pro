<script setup lang="ts">
import type { Component } from 'vue'
import type { ResourceOverviewModuleId, ResourceOverviewState } from '@/features/resource-overview/contract'
import type { CurrencyCode } from '@/utils/financeHelper'
import { Icon } from '@iconify/vue'
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty } from '@/components/ui/empty'
import { usePublicFinance } from '@/composables/usePublicFinance'
import { useTrafficTrend } from '@/composables/useTrafficTrend'
import {
  buildResourceOverviewContract,
  initialResourceOverviewAsyncModuleState,
  resolveResourceOverviewRuntimeState,
  resolveResourceOverviewTelemetryMode,
  transitionResourceOverviewAsyncModuleState,
} from '@/features/resource-overview/contract'
import { buildLiveTrafficViewModel, buildRuntimeSummary } from '@/features/resource-overview/realtime'
import { useAppStore } from '@/stores/app'
import { useNodesStore } from '@/stores/nodes'
import * as financeHelper from '@/utils/financeHelper'

defineOptions({ name: 'ResourceOverview' })

type ResourceOverviewModuleLoader = () => Promise<Component>

const moduleLoaders: Record<ResourceOverviewModuleId, ResourceOverviewModuleLoader> = {
  'traffic-trend': () => import('@/components/resource-overview/TrafficTrendPanel.vue').then(module => module.default),
  'pressure-heatmap': () => import('@/components/resource-overview/PressureHeatmapPanel.vue').then(module => module.default),
  'quota-ranking': () => import('@/components/resource-overview/QuotaRankingPanel.vue').then(module => module.default),
  'live-traffic': () => import('@/components/resource-overview/LiveTrafficPanel.vue').then(module => module.default),
  'cost-overview': () => import('@/components/resource-overview/CostOverviewPanel.vue').then(module => module.default),
  'renewal-timeline': () => import('@/components/resource-overview/RenewalTimelinePanel.vue').then(module => module.default),
}

const route = useRoute()
const router = useRouter()
const appStore = useAppStore()
const nodesStore = useNodesStore()
const asyncModuleState = ref(initialResourceOverviewAsyncModuleState)

const pageState = computed<ResourceOverviewState>(() => {
  return resolveResourceOverviewRuntimeState({
    loading: appStore.loading,
    connectionError: appStore.connectionError,
    nodeCount: nodesStore.nodes.length,
    requestedQaState: route.query['resource-state'],
    isDevelopment: import.meta.env.DEV,
  })
})
const telemetryMode = computed(() => resolveResourceOverviewTelemetryMode(pageState.value, appStore.connectionError))
const isDegraded = computed(() => telemetryMode.value === 'cached')
const contract = computed(() => buildResourceOverviewContract({
  state: pageState.value,
  moduleLoadFailed: asyncModuleState.value.hasFailure,
}))
const runtimeSummary = computed(() => buildRuntimeSummary(nodesStore.nodes))
const liveTraffic = computed(() => buildLiveTrafficViewModel(nodesStore.nodes))
const visibleNodeUuids = computed(() => nodesStore.nodes.map(node => node.uuid))
const costDisplayCurrency = ref<CurrencyCode>('CNY')
let costCurrencyWasChanged = false

watch(() => appStore.publicFinanceCurrency, (configuredCurrency) => {
  if (!costCurrencyWasChanged)
    costDisplayCurrency.value = financeHelper.getStoredFinanceCurrency(configuredCurrency)
}, { immediate: true })

const trafficTrend = useTrafficTrend({
  entityIds: visibleNodeUuids,
  enabled: computed(() => pageState.value === 'ready'),
})
const publicFinance = usePublicFinance({
  nodes: computed(() => nodesStore.nodes),
  enabled: appStore.canViewPublicFinance,
  currency: costDisplayCurrency,
  renewalWindowDays: appStore.renewalWarningDays,
})
const summaryMetrics = computed(() => pageState.value === 'ready'
  ? [
      { label: '监控探针', value: String(runtimeSummary.value.total), detail: `在线 ${runtimeSummary.value.online} · 离线 ${runtimeSummary.value.offline}` },
      {
        label: '实时总带宽',
        value: runtimeSummary.value.formattedTraffic,
        detail: runtimeSummary.value.trafficAggregateInvalid
          ? '上下行合计超出可表示范围'
          : runtimeSummary.value.invalidTrafficSamples > 0
            ? `${runtimeSummary.value.invalidTrafficSamples} 台速率异常未计入`
            : `下行 ${runtimeSummary.value.formattedNetIn} · 上行 ${runtimeSummary.value.formattedNetOut}`,
      },
      { label: '压力提醒', value: String(runtimeSummary.value.pressureAttention), detail: runtimeSummary.value.unknownPressure > 0 ? `${runtimeSummary.value.unknownPressure} 台数据不完整` : 'CPU / 内存 / 磁盘' },
      { label: '未收到状态', value: String(runtimeSummary.value.unobserved), detail: isDegraded.value ? '当前连接已降级' : '等待首次状态上报' },
    ]
  : contract.value.summaryMetrics)
const orderedModules = computed(() => contract.value.rows.flatMap(row => row.modules))
const moduleComponents = computed<Record<ResourceOverviewModuleId, Component>>(() => {
  // A retry must use fresh async wrappers because Vue caches a rejected loader promise.
  const generation = asyncModuleState.value.retryVersion

  return Object.fromEntries(Object.entries(moduleLoaders).map(([id, loader]) => [
    id,
    defineAsyncComponent({
      loader: async () => {
        try {
          return await loader()
        }
        catch (error) {
          asyncModuleState.value = transitionResourceOverviewAsyncModuleState(
            asyncModuleState.value,
            { type: 'module-load-failed', generation },
          )
          throw error
        }
      },
      suspensible: false,
    }),
  ])) as Record<ResourceOverviewModuleId, Component>
})

function moduleRuntimeProps(id: ResourceOverviewModuleId): Record<string, unknown> {
  const loading = contract.value.stateView.kind === 'skeleton'
  if (id === 'traffic-trend') {
    return {
      snapshot: trafficTrend.snapshot.value,
      loading: trafficTrend.loading.value,
      refreshing: trafficTrend.refreshing.value,
      onRefresh: trafficTrend.refresh,
    }
  }
  if (id === 'live-traffic')
    return { viewModel: liveTraffic.value, loading }
  if (id === 'cost-overview') {
    const state = publicFinance.state.value
    return {
      visible: appStore.canViewPublicFinance,
      model: state.kind === 'ready' ? state.model : undefined,
      loading: state.kind === 'loading',
      currency: costDisplayCurrency.value,
      onCurrencyChange: setCostDisplayCurrency,
    }
  }
  if (id === 'renewal-timeline')
    return { nodes: nodesStore.nodes, loading, warningDays: appStore.renewalWarningDays }
  if (id === 'pressure-heatmap' || id === 'quota-ranking')
    return { nodes: nodesStore.nodes, loading }
  return {}
}

function setCostDisplayCurrency(currency: CurrencyCode): void {
  costCurrencyWasChanged = true
  costDisplayCurrency.value = currency
  financeHelper.setStoredFinanceCurrency(currency)
}

function retryOverview() {
  asyncModuleState.value = transitionResourceOverviewAsyncModuleState(
    asyncModuleState.value,
    { type: 'retry' },
  )

  if (pageState.value === 'error') {
    const { 'resource-state': _resourceState, ...query } = route.query
    void router.replace({ query })
    if (appStore.connectionError && nodesStore.nodes.length === 0 && !import.meta.env.DEV)
      window.location.reload()
  }
}
</script>

<template>
  <section
    :class="contract.layout.pageClass"
    aria-labelledby="resource-overview-title"
    :aria-busy="contract.stateView.ariaBusy"
  >
    <div class="mb-5 flex flex-wrap items-start gap-4">
      <Button as-child variant="ghost" size="sm" class="-ml-2 text-muted-foreground hover:text-foreground">
        <RouterLink :to="{ name: 'home' }" aria-label="返回首页">
          <Icon icon="lucide:arrow-left" aria-hidden="true" />
          返回首页
        </RouterLink>
      </Button>
      <div class="min-w-0 flex-1 basis-full sm:basis-auto">
        <p class="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300">
          Resource telemetry
        </p>
        <h1 id="resource-overview-title" class="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          资源概况
        </h1>
        <p class="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          实时节点状态、资源风险、5 日流量趋势与受隐私设置保护的成本概览。
        </p>
      </div>
    </div>

    <div class="mb-5 flex items-center gap-3" aria-hidden="true">
      <span class="size-1.5 shrink-0 rounded-full bg-emerald-600 shadow-[0_0_0_5px] shadow-emerald-500/10" />
      <span class="h-px min-w-0 flex-1 bg-gradient-to-r from-emerald-600/80 via-emerald-500/25 to-transparent" />
      <span class="font-mono text-[9px] uppercase tracking-[0.22em] text-emerald-700/70 dark:text-emerald-300/70">telemetry {{ telemetryMode }}</span>
    </div>

    <template v-if="contract.stateView.kind === 'skeleton' || contract.stateView.kind === 'content'">
      <div
        v-if="contract.stateView.kind === 'skeleton'"
        class="mb-4 flex items-start gap-3 border-y border-border/70 bg-muted/25 px-3 py-3"
        role="status"
        :aria-live="contract.stateView.ariaLive"
      >
        <Icon icon="lucide:loader-circle" class="mt-0.5 shrink-0 animate-spin text-emerald-700 motion-reduce:animate-none dark:text-emerald-300" aria-hidden="true" />
        <div class="min-w-0">
          <p class="text-sm font-medium text-foreground">
            {{ contract.stateView.title }}
          </p>
          <p class="mt-0.5 text-xs leading-5 text-muted-foreground">
            {{ contract.stateView.description }}
          </p>
        </div>
      </div>

      <div
        v-else-if="isDegraded"
        class="mb-4 flex items-start gap-3 border-y border-warning/40 bg-warning/10 px-3 py-3 text-amber-950 dark:text-amber-100"
        role="status"
        aria-live="polite"
      >
        <Icon icon="lucide:wifi-off" class="mt-0.5 shrink-0" aria-hidden="true" />
        <div class="min-w-0">
          <p class="text-sm font-medium">
            连接已降级
          </p>
          <p class="mt-0.5 text-xs leading-5">
            当前显示最后一次收到的探针状态，恢复连接后会自动更新。
          </p>
        </div>
      </div>

      <section class="mb-4 border-y border-border/80 bg-background/70" aria-labelledby="resource-summary-title">
        <h2 id="resource-summary-title" class="sr-only">
          运行摘要
        </h2>
        <div :class="contract.layout.summaryGridClass">
          <div
            v-for="(metric, index) in summaryMetrics"
            :key="metric.label"
            class="min-w-0 px-3 py-4 sm:px-4"
            :class="[
              index % 2 !== 0 ? 'border-l border-border/70' : '',
              index >= 2 ? 'border-t border-border/70 md:border-t-0' : '',
              index > 0 ? 'md:border-l md:border-border/70' : '',
            ]"
          >
            <p class="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground" :title="metric.label">
              {{ metric.label }}
            </p>
            <p class="mt-2 text-xl font-semibold tabular-nums text-foreground">
              {{ metric.value }}
            </p>
            <p class="mt-1 min-h-8 text-[11px] leading-4 text-muted-foreground" :title="metric.detail">
              {{ metric.detail }}
            </p>
          </div>
        </div>
      </section>

      <div :class="contract.layout.moduleGridClass">
        <div
          v-for="module in orderedModules"
          :key="module.id"
          class="col-span-1 min-w-0"
          :class="module.gridClass"
        >
          <component
            :is="moduleComponents[module.id]"
            :key="`${module.id}-${asyncModuleState.retryVersion}`"
            :module="module"
            v-bind="moduleRuntimeProps(module.id)"
          />
        </div>
      </div>
    </template>

    <div
      v-else-if="contract.stateView.kind === 'empty'"
      class="flex min-h-96 items-center justify-center border-y border-border/80 bg-background/70"
      role="status"
      :aria-live="contract.stateView.ariaLive"
    >
      <Empty class="max-w-xl" :description="contract.stateView.title">
        <p class="text-sm font-medium text-foreground">
          {{ contract.stateView.title }}
        </p>
        <p class="max-w-md text-center text-xs leading-5 text-muted-foreground">
          {{ contract.stateView.description }}
        </p>
      </Empty>
    </div>

    <Alert
      v-else
      variant="destructive"
      class="min-h-40 content-center border-destructive/30 bg-destructive/5"
      :aria-live="contract.stateView.ariaLive"
    >
      <Icon icon="lucide:circle-alert" aria-hidden="true" />
      <AlertTitle>{{ contract.stateView.title }}</AlertTitle>
      <AlertDescription>{{ contract.stateView.description }}</AlertDescription>
      <div v-if="contract.stateView.retryAction" class="mt-4">
        <Button
          type="button"
          variant="outline"
          class="focus-visible:ring-destructive/40"
          :aria-label="contract.stateView.retryAction.accessibleName"
          @click="retryOverview"
        >
          <Icon icon="lucide:refresh-cw" aria-hidden="true" />
          {{ contract.stateView.retryAction.label }}
        </Button>
      </div>
    </Alert>
  </section>
</template>
