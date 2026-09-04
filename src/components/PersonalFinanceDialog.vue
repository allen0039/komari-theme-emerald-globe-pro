<script setup lang="ts">
import type { NodeData } from '@/stores/nodes'
import type { CurrencyCode } from '@/utils/financeHelper'
import { Icon } from '@iconify/vue'
import { computed, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { DataTooltip } from '@/components/ui/data-tooltip'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useNodesStore } from '@/stores/nodes'
import * as financeHelper from '@/utils/financeHelper'

const nodesStore = useNodesStore()
const open = ref(false)
const initialized = ref(false)
const exchangeRates = ref(financeHelper.DEFAULT_EXCHANGE_RATES)
const baseCurrency = ref<CurrencyCode>('CNY')
const excludedNodeUuids = ref<Set<string>>(new Set())
const searchText = ref('')
const financeCurrencies: readonly CurrencyCode[] = financeHelper.DISPLAY_FINANCE_CURRENCIES

const nodes = computed(() => nodesStore.nodes)
const selectedNodes = computed(() => nodes.value.filter(node => !excludedNodeUuids.value.has(node.uuid)))
const selectedCount = computed(() => selectedNodes.value.length)
const allSelected = computed(() => nodes.value.length > 0 && selectedCount.value === nodes.value.length)
const targetExchangeRate = computed(() => exchangeRates.value[baseCurrency.value] || 1)
const filteredNodes = computed(() => {
  const query = searchText.value.trim().toLowerCase()
  if (!query)
    return nodes.value

  return nodes.value.filter(node => `${node.name} ${node.region} ${node.tags}`.toLowerCase().includes(query))
})

function formatAmount(amountCNY: number): string {
  const formatted = financeHelper.formatFinanceAmount(amountCNY * targetExchangeRate.value, baseCurrency.value)
  return `${formatted.symbol}${formatted.value}`
}

const summaryItems = computed(() => [
  {
    label: '总价值',
    value: formatAmount(financeHelper.calculateTotalValueCNY(selectedNodes.value, exchangeRates.value, false)),
  },
  {
    label: '月均支出',
    value: formatAmount(financeHelper.calculateTotalMonthlyAverageCostCNY(selectedNodes.value, exchangeRates.value, false)),
  },
  {
    label: '剩余价值',
    value: formatAmount(financeHelper.calculateTotalRemainingValueCNY(selectedNodes.value, exchangeRates.value, false)),
  },
])

function persistSelection(nextExcluded: Set<string>): void {
  excludedNodeUuids.value = nextExcluded
  financeHelper.setExcludedFinanceNodeUuids(nextExcluded)
}

function handleNodeSelection(event: Event, uuid: string): void {
  const target = event.target as HTMLInputElement
  const nextExcluded = new Set(excludedNodeUuids.value)

  if (target.checked)
    nextExcluded.delete(uuid)
  else
    nextExcluded.add(uuid)

  persistSelection(nextExcluded)
}

function selectAll(): void {
  persistSelection(new Set())
}

function clearAll(): void {
  persistSelection(new Set(nodes.value.map(node => node.uuid)))
}

function isSelected(uuid: string): boolean {
  return !excludedNodeUuids.value.has(uuid)
}

function getNodeMonthlyCost(node: NodeData): string {
  return `${formatAmount(financeHelper.calculateMonthlyAverageCostCNY(node, exchangeRates.value))}/月`
}

function getNodeRemainingValue(node: NodeData): string {
  return formatAmount(financeHelper.calculateRemainingValueCNY(node, exchangeRates.value))
}

function setBaseCurrency(event: Event): void {
  const target = event.target as HTMLSelectElement
  baseCurrency.value = financeHelper.normalizeCurrency(target.value)
  financeHelper.setStoredPersonalFinanceCurrency(baseCurrency.value)
}

async function initialize(): Promise<void> {
  if (initialized.value)
    return

  initialized.value = true
  baseCurrency.value = financeHelper.getStoredPersonalFinanceCurrency()
  excludedNodeUuids.value = new Set(financeHelper.getExcludedFinanceNodeUuids())
  const { rates } = await financeHelper.getDailyExchangeRates()
  exchangeRates.value = rates
}

watch(open, (isOpen) => {
  if (isOpen)
    void initialize()
})
</script>

<template>
  <Dialog v-model:open="open">
    <DataTooltip content="个人价值计算" placement="left" content-class="whitespace-nowrap text-[11px] px-2">
      <DialogTrigger as-child>
        <Button variant="ghost" size="icon-sm" aria-label="个人价值计算">
          <Icon icon="tabler:moneybag" :width="18" :height="18" />
        </Button>
      </DialogTrigger>
    </DataTooltip>

    <DialogContent class="max-h-[min(90vh,42rem)] max-w-2xl gap-0 overflow-hidden p-0">
      <DialogHeader class="border-b border-border/60 px-4 py-4 pr-12">
        <DialogTitle>个人价值计算</DialogTitle>
        <DialogDescription class="text-xs">
          选择只保存在当前浏览器，不会改变首页公开数据。
        </DialogDescription>
      </DialogHeader>

      <div class="grid shrink-0 grid-cols-3 gap-px bg-border/60">
        <div v-for="item in summaryItems" :key="item.label" class="min-w-0 bg-background px-3 py-3 sm:px-4">
          <div class="text-[11px] text-muted-foreground sm:text-xs">
            {{ item.label }}
          </div>
          <div class="mt-1 truncate text-sm font-bold tabular-nums sm:text-xl">
            {{ item.value }}
          </div>
        </div>
      </div>

      <div class="flex min-h-0 flex-col">
        <div class="flex flex-col gap-2 border-b border-border/60 p-4 sm:flex-row sm:items-center">
          <div class="flex min-w-0 items-center justify-between gap-3 sm:w-44 sm:shrink-0">
            <div class="text-xs text-muted-foreground">
              已计入 <span class="font-semibold text-foreground">{{ selectedCount }}</span> / {{ nodes.length }} 台
            </div>
            <select
              :value="baseCurrency"
              class="rounded-sm border border-border/70 bg-background px-2 py-1 text-xs font-medium outline-none focus:ring-2 focus:ring-ring/50"
              aria-label="个人计算币种" @change="setBaseCurrency"
            >
              <option v-for="currency in financeCurrencies" :key="currency" :value="currency">
                {{ currency }}
              </option>
            </select>
          </div>

          <div class="relative min-w-0 flex-1">
            <Icon
              icon="lucide:search" :width="14" :height="14"
              class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input v-model="searchText" placeholder="搜索服务器" class="h-8 bg-background pl-8 text-xs" />
          </div>

          <div class="flex shrink-0 justify-end gap-1">
            <Button variant="ghost" size="xs" :disabled="allSelected || nodes.length === 0" @click="selectAll">
              全选
            </Button>
            <Button variant="ghost" size="xs" :disabled="selectedCount === 0" @click="clearAll">
              清空
            </Button>
          </div>
        </div>

        <div class="p-2 sm:p-3">
          <div class="max-h-60 overflow-y-auto overscroll-contain sm:max-h-70">
            <label
              v-for="node in filteredNodes" :key="node.uuid"
              class="grid h-12 cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-sm px-2 py-2 transition-colors hover:bg-muted/60 focus-within:ring-2 focus-within:ring-ring/50 sm:h-14"
            >
              <input
                type="checkbox" :checked="isSelected(node.uuid)"
                class="size-4 shrink-0 accent-emerald-600"
                @change="handleNodeSelection($event, node.uuid)"
              >
              <span class="min-w-0">
                <span class="block truncate text-xs font-medium sm:text-sm">{{ node.name }}</span>
                <span class="block truncate text-[10px] text-muted-foreground sm:text-[11px]">
                  {{ node.region || '未设置地区' }}
                </span>
              </span>
              <span class="min-w-20 text-right tabular-nums">
                <span class="block text-xs font-medium">{{ getNodeRemainingValue(node) }}</span>
                <span class="block text-[10px] text-muted-foreground">{{ getNodeMonthlyCost(node) }}</span>
              </span>
            </label>

            <div v-if="filteredNodes.length === 0" class="py-10 text-center text-xs text-muted-foreground">
              没有匹配的服务器
            </div>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
