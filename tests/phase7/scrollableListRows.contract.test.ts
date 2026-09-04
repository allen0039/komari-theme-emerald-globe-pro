import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'

const costOverviewSource = readFileSync(new URL('../../src/components/resource-overview/CostOverviewPanel.vue', import.meta.url), 'utf8')
const nodeGeneralCardsSource = readFileSync(new URL('../../src/components/NodeGeneralCards.vue', import.meta.url), 'utf8')
const personalFinanceSource = readFileSync(new URL('../../src/components/PersonalFinanceDialog.vue', import.meta.url), 'utf8')
const pressureHeatmapSource = readFileSync(new URL('../../src/components/resource-overview/PressureHeatmapPanel.vue', import.meta.url), 'utf8')
const quotaRankingSource = readFileSync(new URL('../../src/components/resource-overview/QuotaRankingPanel.vue', import.meta.url), 'utf8')

describe('scrollable list row sizing', () => {
  test('keeps resource overview scrollports aligned to complete rows', () => {
    expect(quotaRankingSource).toContain('max-h-[6rem] overflow-y-auto')
    expect(quotaRankingSource).toContain('class="grid h-8 min-w-0')
    expect(pressureHeatmapSource).toContain('max-h-[8.5rem] overflow-y-auto')
    expect(pressureHeatmapSource).toContain('class="grid h-7 min-w-0')
    expect(costOverviewSource).toContain('grid max-h-55 auto-rows-6 gap-1 overflow-y-auto overscroll-contain')
    expect(costOverviewSource).toContain('rounded-sm border border-border/45 bg-muted/20')
    expect(costOverviewSource).toContain('grid gap-px overflow-hidden rounded-sm border border-border/50 bg-border/50 sm:grid-cols-2')
    expect(costOverviewSource).toContain('xl:min-h-[6.75rem]')
    expect(costOverviewSource).not.toContain('max-h-36 space-y-1.5')
  })

  test('uses complete row counts in the compact and modal finance lists', () => {
    expect(nodeGeneralCardsSource).toContain('grid h-14 auto-rows-4 grid-cols-2 gap-x-4 gap-y-1 overflow-auto')
    expect(personalFinanceSource).toContain('class="p-2 sm:p-3"')
    expect(personalFinanceSource).toContain('max-h-60 overflow-y-auto overscroll-contain sm:max-h-70')
    expect(personalFinanceSource).toContain('class="grid h-12 cursor-pointer')
    expect(personalFinanceSource).toContain('sm:h-14')
    expect(personalFinanceSource).not.toContain('max-h-[min(50vh,22rem)]')
  })
})
