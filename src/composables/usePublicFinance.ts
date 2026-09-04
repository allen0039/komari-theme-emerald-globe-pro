import type { MaybeRefOrGetter } from 'vue'
import type { CostOverviewViewModel } from '@/features/resource-overview/cost'
import type { NodeData } from '@/stores/nodes'
import type { CurrencyCode } from '@/utils/financeHelper'
import { computed, shallowRef, toValue, watch } from 'vue'
import { buildCostOverviewViewModel, hasPricedCostData } from '@/features/resource-overview/cost'
import { DEFAULT_EXCHANGE_RATES, getDailyExchangeRates } from '@/utils/financeHelper'

export type PublicFinanceState
  = | { kind: 'hidden' }
    | { kind: 'loading' }
    | { kind: 'ready', model: CostOverviewViewModel }

export interface UsePublicFinanceOptions {
  nodes: MaybeRefOrGetter<readonly NodeData[]>
  enabled: MaybeRefOrGetter<boolean>
  currency: MaybeRefOrGetter<CurrencyCode>
  renewalWindowDays: MaybeRefOrGetter<number>
}

export function usePublicFinance(options: UsePublicFinanceOptions) {
  const state = shallowRef<PublicFinanceState>({ kind: 'hidden' })
  const financeNodeKey = computed(() => JSON.stringify(
    toValue(options.nodes).map(node => [
      node.uuid,
      node.name,
      node.price,
      node.billing_cycle,
      node.currency,
      node.expired_at,
      node.tags,
    ]),
  ))

  watch(
    [
      () => toValue(options.enabled),
      () => toValue(options.currency),
      () => toValue(options.renewalWindowDays),
      financeNodeKey,
    ],
    async ([enabled, currency, renewalWindowDays], _previous, onCleanup) => {
      if (!enabled) {
        state.value = { kind: 'hidden' }
        return
      }

      const nodes = toValue(options.nodes)
      let cancelled = false
      if (state.value.kind !== 'ready')
        state.value = { kind: 'loading' }

      onCleanup(() => {
        cancelled = true
      })

      if (!hasPricedCostData(nodes)) {
        state.value = {
          kind: 'ready',
          model: buildCostOverviewViewModel({
            nodes,
            rates: DEFAULT_EXCHANGE_RATES,
            rateSource: 'default',
            displayCurrency: currency,
            renewalWindowDays,
            now: new Date(),
          }),
        }
        return
      }

      try {
        const { rates, source } = await getDailyExchangeRates()
        if (!cancelled) {
          state.value = {
            kind: 'ready',
            model: buildCostOverviewViewModel({
              nodes,
              rates,
              rateSource: source,
              displayCurrency: currency,
              renewalWindowDays,
              now: new Date(),
            }),
          }
        }
      }
      catch {
        if (!cancelled) {
          state.value = {
            kind: 'ready',
            model: buildCostOverviewViewModel({
              nodes,
              rates: DEFAULT_EXCHANGE_RATES,
              rateSource: 'default',
              displayCurrency: currency,
              renewalWindowDays,
              now: new Date(),
            }),
          }
        }
      }
    },
    { immediate: true },
  )

  return { state }
}
