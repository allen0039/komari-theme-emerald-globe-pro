import type { NodeData } from '@/stores/nodes'
import type {
  CurrencyCode,
  ExchangeRates,
  ExchangeRateSource,
} from '@/utils/financeHelper'
import {
  calculateMonthlyAverageCostCNY,
  calculateValueCNY,
  formatFinanceAmount,
  resolveCurrency,
} from '@/utils/financeHelper'
import { getBillingCycleText } from '@/utils/tagHelper'

const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface MonthlyCostRankingRow {
  uuid: string
  name: string
  formattedMonthly: ReturnType<typeof formatFinanceAmount>
  visualPercentage: number
  billingCycleLabel: string
}

export interface CostOverviewViewModel {
  pricingStatus: 'unavailable' | 'partial' | 'complete'
  monthlyCostCNY: number
  annualBudgetCNY: number
  dueSoonAmountCNY: number
  dueSoonNodes: number
  pricedNodes: number
  totalNodes: number
  coveragePercentage: number
  formattedMonthly: ReturnType<typeof formatFinanceAmount>
  formattedAnnual: ReturnType<typeof formatFinanceAmount>
  formattedDueSoon: ReturnType<typeof formatFinanceAmount>
  monthlyRanking: MonthlyCostRankingRow[]
  rateSource: ExchangeRateSource
}

export interface CostOverviewInput {
  nodes: readonly NodeData[]
  rates: ExchangeRates
  displayCurrency: CurrencyCode
  rateSource: ExchangeRateSource
  now: Date
  renewalWindowDays: number
}

export function buildCostOverviewViewModel(input: CostOverviewInput): CostOverviewViewModel {
  const pricedNodes = input.nodes.filter(isPricedNode)
  const monthlyCostCNY = pricedNodes.reduce(
    (sum, node) => sum + calculateMonthlyAverageCostCNY(node, input.rates),
    0,
  )
  const annualBudgetCNY = monthlyCostCNY * 12
  const dueSoonNodes = pricedNodes.filter(node => expiresWithinWindow(node, input.now, input.renewalWindowDays))
  const dueSoonAmountCNY = dueSoonNodes.reduce(
    (sum, node) => sum + calculateValueCNY(node, input.rates),
    0,
  )
  const displayRate = input.rates[input.displayCurrency] || 1
  const format = (amountCNY: number) => formatFinanceAmount(amountCNY * displayRate, input.displayCurrency)
  const monthlyRanking = buildMonthlyCostRanking(pricedNodes, input.rates, format)
  const pricingStatus = pricedNodes.length === 0
    ? 'unavailable'
    : pricedNodes.length === input.nodes.length
      ? 'complete'
      : 'partial'

  return {
    pricingStatus,
    monthlyCostCNY,
    annualBudgetCNY,
    dueSoonAmountCNY,
    dueSoonNodes: dueSoonNodes.length,
    pricedNodes: pricedNodes.length,
    totalNodes: input.nodes.length,
    coveragePercentage: input.nodes.length === 0 ? 0 : pricedNodes.length / input.nodes.length * 100,
    formattedMonthly: format(monthlyCostCNY),
    formattedAnnual: format(annualBudgetCNY),
    formattedDueSoon: format(dueSoonAmountCNY),
    monthlyRanking,
    rateSource: input.rateSource,
  }
}

export function hasPricedCostData(nodes: readonly NodeData[]): boolean {
  return nodes.some(isPricedNode)
}

function buildMonthlyCostRanking(
  nodes: readonly NodeData[],
  rates: ExchangeRates,
  format: (amountCNY: number) => ReturnType<typeof formatFinanceAmount>,
): MonthlyCostRankingRow[] {
  const ranked = nodes
    .map(node => ({ node, monthlyCostCNY: calculateMonthlyAverageCostCNY(node, rates) }))
    .filter((item): item is { node: NodeData, monthlyCostCNY: number } => Number.isFinite(item.monthlyCostCNY) && item.monthlyCostCNY > 0)
    .sort((a, b) => b.monthlyCostCNY - a.monthlyCostCNY || compareNodeIdentity(a.node, b.node))

  const highestMonthlyCost = ranked[0]?.monthlyCostCNY || 0
  return ranked.map(({ node, monthlyCostCNY }) => ({
    uuid: node.uuid,
    name: node.name,
    formattedMonthly: format(monthlyCostCNY),
    visualPercentage: highestMonthlyCost === 0 ? 0 : monthlyCostCNY / highestMonthlyCost * 100,
    billingCycleLabel: formatBillingCycleLabel(node.billing_cycle),
  }))
}

function compareNodeIdentity(a: Pick<NodeData, 'name' | 'uuid'>, b: Pick<NodeData, 'name' | 'uuid'>): number {
  if (a.name !== b.name)
    return a.name < b.name ? -1 : 1

  if (a.uuid !== b.uuid)
    return a.uuid < b.uuid ? -1 : 1

  return 0
}

function formatBillingCycleLabel(billingCycle: number): string {
  const label = getBillingCycleText(billingCycle)
  return label === '月' || label === '年' ? `${label}付` : label
}

function isPricedNode(node: NodeData): boolean {
  const price = Number(node.price)
  const billingCycle = Number(node.billing_cycle)
  return Number.isFinite(price)
    && price > 0
    && Number.isFinite(billingCycle)
    && billingCycle > 0
    && resolveCurrency(node.currency) !== null
    && !node.tags?.includes('白嫖中')
}

function expiresWithinWindow(node: NodeData, now: Date, renewalWindowDays: number): boolean {
  const expiry = new Date(node.expired_at).getTime()
  if (!Number.isFinite(expiry))
    return false

  const nowTime = now.getTime()
  const deadline = nowTime + renewalWindowDays * MS_PER_DAY
  return expiry >= nowTime && expiry <= deadline
}
