import type { NodeData } from '../../src/stores/nodes'
import { describe, expect, test } from 'bun:test'
import { buildCostOverviewViewModel } from '../../src/features/resource-overview/cost'
import { DEFAULT_EXCHANGE_RATES } from '../../src/utils/financeHelper'

function node(overrides: Partial<NodeData> = {}): NodeData {
  return {
    uuid: 'node-1',
    name: 'node-1',
    cpu_name: '',
    virtualization: '',
    arch: '',
    cpu_cores: 1,
    os: '',
    kernel_version: '',
    region: '',
    public_remark: '',
    mem_total: 0,
    swap_total: 0,
    disk_total: 0,
    weight: 0,
    price: 0,
    billing_cycle: 0,
    auto_renewal: false,
    currency: 'CNY',
    expired_at: '',
    group: '',
    tags: '',
    hidden: false,
    traffic_limit: 0,
    traffic_limit_type: 'sum',
    created_at: '',
    updated_at: '',
    statusObserved: true,
    online: true,
    time: '',
    cpu: 0,
    gpu: 0,
    ram: 0,
    swap: 0,
    load: 0,
    load5: 0,
    load15: 0,
    temp: 0,
    disk: 0,
    net_in: 0,
    net_out: 0,
    net_total_up: 0,
    net_total_down: 0,
    process: 0,
    connections: 0,
    connections_udp: 0,
    uptime: 0,
    ...overrides,
  }
}

const now = new Date('2026-09-01T00:00:00Z')

describe('public cost overview derivation', () => {
  test('computes monthly, annual, due-soon, coverage, format, and rate source without personal exclusions', () => {
    const model = buildCostOverviewViewModel({
      nodes: [
        node({ uuid: 'monthly', price: 30, billing_cycle: 30, currency: 'CNY', expired_at: '2026-09-10' }),
        node({ uuid: 'annual', price: 120, billing_cycle: 365, currency: 'CNY', expired_at: '2027-08-01' }),
        node({ uuid: 'invalid', price: 0, billing_cycle: 0, currency: 'CNY', expired_at: '' }),
      ],
      rates: DEFAULT_EXCHANGE_RATES,
      displayCurrency: 'CNY',
      rateSource: 'default',
      now,
      renewalWindowDays: 30,
    })

    expect(model.monthlyCostCNY).toBeCloseTo(30 + 120 / 365 * 30)
    expect(model.pricingStatus).toBe('partial')
    expect(model.annualBudgetCNY).toBeCloseTo((30 + 120 / 365 * 30) * 12)
    expect(model.dueSoonAmountCNY).toBe(30)
    expect(model.dueSoonNodes).toBe(1)
    expect(model.pricedNodes).toBe(2)
    expect(model.totalNodes).toBe(3)
    expect(model.coveragePercentage).toBeCloseTo(66.67, 2)
    expect(model.formattedMonthly).toMatchObject({ currency: 'CNY', symbol: '¥', value: '39.86' })
    expect(model.formattedAnnual).toMatchObject({ currency: 'CNY', symbol: '¥', value: '478.36' })
    expect(model.formattedDueSoon).toMatchObject({ currency: 'CNY', symbol: '¥', value: '30.00' })
    expect(model.monthlyRanking).toMatchObject([
      { uuid: 'monthly', formattedMonthly: { value: '30.00' }, visualPercentage: 100, billingCycleLabel: '月付' },
      { uuid: 'annual', formattedMonthly: { value: '9.86' }, billingCycleLabel: '年付' },
    ])
    expect(model.rateSource).toBe('default')
  })

  test('excludes invalid price, cycle, currency, and free-tag nodes while retaining every visible node in coverage', () => {
    const model = buildCostOverviewViewModel({
      nodes: [
        node({ uuid: 'valid', price: 30, billing_cycle: 30, currency: 'CNY' }),
        node({ uuid: 'free', price: 30, billing_cycle: 30, currency: 'CNY', tags: '白嫖中' }),
        node({ uuid: 'nan-price', price: Number.NaN, billing_cycle: 30, currency: 'CNY' }),
        node({ uuid: 'infinite-price', price: Number.POSITIVE_INFINITY, billing_cycle: 30, currency: 'CNY' }),
        node({ uuid: 'invalid-cycle', price: 30, billing_cycle: 0, currency: 'CNY' }),
        node({ uuid: 'infinite-cycle', price: 30, billing_cycle: Number.POSITIVE_INFINITY, currency: 'CNY' }),
        node({ uuid: 'unsupported-currency', price: 30, billing_cycle: 30, currency: 'XYZ' }),
      ],
      rates: DEFAULT_EXCHANGE_RATES,
      displayCurrency: 'USD',
      rateSource: 'cache',
      now,
      renewalWindowDays: 30,
    })

    expect(model).toMatchObject({
      pricingStatus: 'partial',
      monthlyCostCNY: 30,
      annualBudgetCNY: 360,
      pricedNodes: 1,
      totalNodes: 7,
      rateSource: 'cache',
      formattedMonthly: { currency: 'USD', symbol: '$', value: '4.44' },
    })
    expect(model.coveragePercentage).toBeCloseTo(100 / 7)
  })

  test('counts one renewal price only for finite future expiries inside the configured window', () => {
    const model = buildCostOverviewViewModel({
      nodes: [
        node({ uuid: 'missing', price: 10, billing_cycle: 30, expired_at: '' }),
        node({ uuid: 'invalid', price: 20, billing_cycle: 30, expired_at: 'not-a-date' }),
        node({ uuid: 'expired', price: 30, billing_cycle: 30, expired_at: '2026-08-31' }),
        node({ uuid: 'window-start', price: 40, billing_cycle: 30, expired_at: '2026-09-01T00:00:00Z' }),
        node({ uuid: 'window-end', price: 50, billing_cycle: 30, expired_at: '2026-10-01T00:00:00Z' }),
        node({ uuid: 'outside-window', price: 60, billing_cycle: 30, expired_at: '2026-10-02T00:00:00Z' }),
        node({ uuid: 'long-term', price: 70, billing_cycle: 30, expired_at: '2150-01-01' }),
      ],
      rates: DEFAULT_EXCHANGE_RATES,
      displayCurrency: 'CNY',
      rateSource: 'network',
      now,
      renewalWindowDays: 30,
    })

    expect(model.dueSoonNodes).toBe(2)
    expect(model.dueSoonAmountCNY).toBe(90)
  })

  test('accepts the currency symbols stored by Komari billing settings', () => {
    const model = buildCostOverviewViewModel({
      nodes: [
        node({ uuid: 'cny-symbol', price: 30, billing_cycle: 30, currency: '¥' }),
        node({ uuid: 'usd-symbol', price: 120, billing_cycle: 365, currency: '$' }),
      ],
      rates: { ...DEFAULT_EXCHANGE_RATES, USD: 0.2 },
      displayCurrency: 'CNY',
      rateSource: 'network',
      now,
      renewalWindowDays: 30,
    })

    expect(model.pricingStatus).toBe('complete')
    expect(model.pricedNodes).toBe(2)
    expect(model.monthlyCostCNY).toBeCloseTo(30 + 120 / 0.2 / 365 * 30)
    expect(model.formattedMonthly).toMatchObject({ currency: 'CNY', symbol: '¥', value: '79.32' })
    expect(model.monthlyRanking).toHaveLength(2)
  })

  test('keeps every priced server in the monthly ranking for the scrollable panel', () => {
    const model = buildCostOverviewViewModel({
      nodes: Array.from({ length: 7 }, (_, index) => node({
        uuid: `priced-${index + 1}`,
        name: `priced-${index + 1}`,
        price: (index + 1) * 10,
        billing_cycle: 30,
        currency: 'CNY',
      })),
      rates: DEFAULT_EXCHANGE_RATES,
      displayCurrency: 'CNY',
      rateSource: 'default',
      now,
      renewalWindowDays: 30,
    })

    expect(model.monthlyRanking).toHaveLength(7)
    expect(model.monthlyRanking.map(row => row.uuid)).toEqual([
      'priced-7',
      'priced-6',
      'priced-5',
      'priced-4',
      'priced-3',
      'priced-2',
      'priced-1',
    ])
  })

  test('does not mutate its input nodes', () => {
    const nodes = [
      node({ uuid: 'usd', price: 10, billing_cycle: 30, currency: 'USD', expired_at: '2026-09-10' }),
      node({ uuid: 'free', price: 20, billing_cycle: 30, tags: '白嫖中' }),
    ]
    const before = structuredClone(nodes)

    buildCostOverviewViewModel({
      nodes,
      rates: DEFAULT_EXCHANGE_RATES,
      displayCurrency: 'CNY',
      rateSource: 'stale-cache',
      now,
      renewalWindowDays: 30,
    })

    expect(nodes).toEqual(before)
  })

  test('marks missing price data as unavailable instead of a zero-cost estimate', () => {
    const model = buildCostOverviewViewModel({
      nodes: [
        node({ uuid: 'free', price: 0, billing_cycle: 0, currency: 'CNY' }),
        node({ uuid: 'unsupported', price: 30, billing_cycle: 30, currency: 'XYZ' }),
      ],
      rates: DEFAULT_EXCHANGE_RATES,
      displayCurrency: 'CNY',
      rateSource: 'default',
      now,
      renewalWindowDays: 30,
    })

    expect(model).toMatchObject({
      pricingStatus: 'unavailable',
      pricedNodes: 0,
      totalNodes: 2,
      coveragePercentage: 0,
    })
  })
})
