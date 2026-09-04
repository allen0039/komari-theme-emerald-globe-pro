import type { Component } from 'vue'
import type { CostOverviewModuleContract } from '../../src/features/resource-overview/contract'
import type { CostOverviewViewModel } from '../../src/features/resource-overview/cost'
import type { NodeData } from '../../src/stores/nodes'
import { renderToString } from '@vue/server-renderer'
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { createServer } from 'vite'
import { createSSRApp, effectScope, nextTick, ref } from 'vue'
import { buildResourceOverviewContract } from '../../src/features/resource-overview/contract'
import * as financeHelper from '../../src/utils/financeHelper'

const getDailyExchangeRates = mock(() => Promise.resolve({
  rates: financeHelper.DEFAULT_EXCHANGE_RATES,
  source: 'default' as const,
}))

function resetExchangeRateMock() {
  getDailyExchangeRates.mockReset()
  getDailyExchangeRates.mockResolvedValue({
    rates: financeHelper.DEFAULT_EXCHANGE_RATES,
    source: 'default',
  })
}

mock.module('../../src/utils/financeHelper', () => ({
  ...financeHelper,
  getDailyExchangeRates,
}))

let viteServer: Awaited<ReturnType<typeof createServer>>
let CostOverviewPanel: Component

const module = buildResourceOverviewContract().rows.flatMap(row => row.modules).find(candidate => candidate.id === 'cost-overview') as CostOverviewModuleContract

const readyModel: CostOverviewViewModel = {
  pricingStatus: 'partial',
  monthlyCostCNY: 39.86,
  annualBudgetCNY: 478.36,
  dueSoonAmountCNY: 30,
  dueSoonNodes: 1,
  pricedNodes: 2,
  totalNodes: 3,
  coveragePercentage: 66.67,
  formattedMonthly: { currency: 'CNY', symbol: '¥', value: '39.86' },
  formattedAnnual: { currency: 'CNY', symbol: '¥', value: '478.36' },
  formattedDueSoon: { currency: 'CNY', symbol: '¥', value: '30.00' },
  monthlyRanking: [
    { uuid: 'sample-node-a', name: '样例月付节点', formattedMonthly: { currency: 'CNY', symbol: '¥', value: '30.00' }, visualPercentage: 100, billingCycleLabel: '月付' },
    { uuid: 'sample-node-b', name: '样例年付节点', formattedMonthly: { currency: 'CNY', symbol: '¥', value: '9.86' }, visualPercentage: 32.87, billingCycleLabel: '年付' },
  ],
  rateSource: 'default',
}

beforeAll(async () => {
  viteServer = await createServer({
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  })
  CostOverviewPanel = (await viteServer.ssrLoadModule('/src/components/resource-overview/CostOverviewPanel.vue')).default
})

afterAll(async () => {
  await viteServer.close()
})

beforeEach(() => {
  resetExchangeRateMock()
})

describe('cost overview panel rendering', () => {
  test('does not request exchange rates while public finance is disabled', async () => {
    const { usePublicFinance } = await import('../../src/composables/usePublicFinance')
    const enabled = ref(false)
    const scope = effectScope()

    const finance = scope.run(() => usePublicFinance({
      nodes: () => [],
      enabled,
      currency: () => 'CNY',
      renewalWindowDays: () => 30,
    }))
    await nextTick()

    expect(getDailyExchangeRates).not.toHaveBeenCalled()
    expect(finance?.state.value).toEqual({ kind: 'hidden' })
    scope.stop()
  })

  test('does not request exchange rates when there are no usable prices', async () => {
    const { usePublicFinance } = await import('../../src/composables/usePublicFinance')
    const scope = effectScope()
    const finance = scope.run(() => usePublicFinance({
      nodes: () => [{ price: 0, billing_cycle: 0, currency: 'CNY', expired_at: '' } as NodeData],
      enabled: () => true,
      currency: () => 'CNY',
      renewalWindowDays: () => 30,
    }))
    await nextTick()

    expect(getDailyExchangeRates).not.toHaveBeenCalled()
    expect(finance?.state.value).toMatchObject({
      kind: 'ready',
      model: { pricingStatus: 'unavailable', pricedNodes: 0 },
    })
    scope.stop()
  })

  test('requests rates once and builds the visible model with the returned source', async () => {
    const { usePublicFinance } = await import('../../src/composables/usePublicFinance')
    const returnedRates = { ...financeHelper.DEFAULT_EXCHANGE_RATES, USD: 0.25 }
    getDailyExchangeRates.mockResolvedValueOnce({ rates: returnedRates, source: 'network' })
    const scope = effectScope()
    const finance = scope.run(() => usePublicFinance({
      nodes: () => [{ price: 40, billing_cycle: 30, currency: 'CNY', expired_at: '' } as NodeData],
      enabled: () => true,
      currency: () => 'USD',
      renewalWindowDays: () => 30,
    }))

    await Promise.resolve()
    await nextTick()

    expect(getDailyExchangeRates).toHaveBeenCalledTimes(1)
    if (!finance || finance.state.value.kind !== 'ready')
      throw new Error('expected public finance to become ready')

    expect(finance.state.value.model).toMatchObject({
      rateSource: 'network',
      formattedMonthly: { currency: 'USD', symbol: '$', value: '10.00' },
    })
    scope.stop()
  })

  test('ignores realtime-only node updates after finance is ready', async () => {
    const { usePublicFinance } = await import('../../src/composables/usePublicFinance')
    const nodes = ref([{
      uuid: 'sample-node',
      name: '样例节点',
      price: 40,
      billing_cycle: 30,
      currency: 'CNY',
      expired_at: '',
      tags: '',
      online: false,
      cpu: 0,
    } as NodeData])
    const scope = effectScope()
    const finance = scope.run(() => usePublicFinance({
      nodes,
      enabled: () => true,
      currency: () => 'CNY',
      renewalWindowDays: () => 30,
    }))

    await Promise.resolve()
    await nextTick()
    const readyState = finance?.state.value

    nodes.value = [{ ...nodes.value[0]!, online: true, cpu: 72 }]
    await nextTick()
    await Promise.resolve()

    expect(getDailyExchangeRates).toHaveBeenCalledTimes(1)
    expect(finance?.state.value).toBe(readyState)
    scope.stop()
  })

  test('keeps the ready model mounted while changed pricing is refreshed', async () => {
    const { usePublicFinance } = await import('../../src/composables/usePublicFinance')
    const nodes = ref([{
      uuid: 'sample-node',
      name: '样例节点',
      price: 40,
      billing_cycle: 30,
      currency: 'CNY',
      expired_at: '',
      tags: '',
    } as NodeData])
    const scope = effectScope()
    const finance = scope.run(() => usePublicFinance({
      nodes,
      enabled: () => true,
      currency: () => 'CNY',
      renewalWindowDays: () => 30,
    }))

    await Promise.resolve()
    await nextTick()
    if (!finance || finance.state.value.kind !== 'ready')
      throw new Error('expected public finance to become ready')

    let resolveRefresh!: (value: Awaited<ReturnType<typeof getDailyExchangeRates>>) => void
    const refresh = new Promise<Awaited<ReturnType<typeof getDailyExchangeRates>>>((resolve) => {
      resolveRefresh = resolve
    })
    getDailyExchangeRates.mockImplementationOnce(() => refresh)
    nodes.value = [{ ...nodes.value[0]!, price: 60 }]
    await nextTick()

    expect(getDailyExchangeRates).toHaveBeenCalledTimes(2)
    expect(finance.state.value).toMatchObject({
      kind: 'ready',
      model: { monthlyCostCNY: 40 },
    })

    resolveRefresh({ rates: financeHelper.DEFAULT_EXCHANGE_RATES, source: 'default' })
    await refresh
    await nextTick()

    expect(finance.state.value).toMatchObject({
      kind: 'ready',
      model: { monthlyCostCNY: 60 },
    })
    scope.stop()
  })

  test('falls back to default rates and source when loading rates rejects', async () => {
    const { usePublicFinance } = await import('../../src/composables/usePublicFinance')
    getDailyExchangeRates.mockRejectedValueOnce(new Error('exchange service unavailable'))
    const scope = effectScope()
    const finance = scope.run(() => usePublicFinance({
      nodes: () => [{ price: 10, billing_cycle: 30, currency: 'USD', expired_at: '' } as NodeData],
      enabled: () => true,
      currency: () => 'CNY',
      renewalWindowDays: () => 30,
    }))

    await Promise.resolve()
    await nextTick()

    expect(getDailyExchangeRates).toHaveBeenCalledTimes(1)
    if (!finance || finance.state.value.kind !== 'ready')
      throw new Error('expected public finance to become ready')

    expect(finance.state.value.model).toMatchObject({
      rateSource: 'default',
      monthlyCostCNY: 10 / financeHelper.DEFAULT_EXCHANGE_RATES.USD,
      formattedMonthly: { currency: 'CNY', symbol: '¥', value: '67.57' },
    })
    scope.stop()
  })

  test('keeps all financial values and sources out of the hidden panel', async () => {
    const html = await renderToString(createSSRApp(CostOverviewPanel, {
      module,
      visible: false,
      currency: 'CNY',
      model: readyModel,
    }))

    expect(html).toContain('成本信息仅对管理员开放')
    expect(html).not.toContain('39.86')
    expect(html).not.toContain('478.36')
    expect(html).not.toContain('30.00')
    expect(html).not.toContain('66.67')
    expect(html).not.toContain('内置估算汇率')
  })

  test('renders model values, coverage, currency, and the exact rate source label when visible', async () => {
    const html = await renderToString(createSSRApp(CostOverviewPanel, {
      module,
      visible: true,
      currency: 'CNY',
      model: readyModel,
    }))

    expect(html).toContain('¥39.86')
    expect(html).toContain('¥478.36')
    expect(html).toContain('¥30.00')
    expect(html).toContain('66.67%')
    expect(html).toContain('CNY')
    expect(html).toContain('aria-label="成本展示币种"')
    expect(html).toContain('<select value="CNY"')
    expect(html).toContain('value="USD"')
    expect(html).toContain('pointer-events-none absolute right-2 top-1/2 size-3')
    expect(html).toContain('内置估算汇率')
    expect(html).toContain('成本摘要')
    expect(html).toContain('4 项指标')
    expect(html).toContain('月均成本排行')
    expect(html).toContain('共 2 台')
    expect(html).toContain('grid items-start gap-4 xl:grid-cols-[minmax(20rem,0.95fr)_minmax(0,1.05fr)]')
    expect(html).toContain('grid gap-px overflow-hidden rounded-sm border border-border/50 bg-border/50 sm:grid-cols-2')
    expect(html).toContain('flex min-h-24 min-w-0 flex-col justify-between gap-4 bg-background/80 px-3 py-3 xl:min-h-[6.75rem]')
    expect(html).toContain('grid max-h-55 auto-rows-6 gap-1 overflow-y-auto overscroll-contain')
    expect(html).toContain('grid-cols-[1rem_minmax(0,1fr)_minmax(5rem,1.25fr)_auto] items-center gap-2 rounded-sm border border-border/45 bg-muted/20 px-2')
    expect(html).toContain('text-right text-xs tabular-nums text-muted-foreground">1</span>')
    expect(html).toContain('truncate text-sm font-medium text-foreground')
    expect(html).toContain('whitespace-nowrap text-right text-xl font-semibold tabular-nums text-foreground')
    expect(html).not.toContain('max-h-36')
    expect(html).toContain('样例月付节点')
    expect(html).toContain('样例年付节点')
  })

  test('renders unavailable prices as a non-monetary state without a rate source', async () => {
    const html = await renderToString(createSSRApp(CostOverviewPanel, {
      module,
      visible: true,
      currency: 'CNY',
      model: {
        ...readyModel,
        pricingStatus: 'unavailable',
        monthlyCostCNY: 0,
        annualBudgetCNY: 0,
        dueSoonAmountCNY: 0,
        dueSoonNodes: 0,
        pricedNodes: 0,
        totalNodes: 23,
        coveragePercentage: 0,
        formattedMonthly: { currency: 'CNY', symbol: '¥', value: '0.00' },
        formattedAnnual: { currency: 'CNY', symbol: '¥', value: '0.00' },
        formattedDueSoon: { currency: 'CNY', symbol: '¥', value: '0.00' },
      },
    }))

    expect(html).toContain('尚未接入有效价格')
    expect(html).toContain('0/23 台有效价格')
    expect(html).not.toContain('¥0.00')
    expect(html).not.toContain('汇率来源')
  })
})
