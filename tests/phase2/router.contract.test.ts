import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'bun:test'
import { defineComponent } from 'vue'
import { createRoutes, routes } from '../../src/router/routes'

describe('resource overview route contract', () => {
  test('registers the exact resources route', () => {
    expect(routes.map(({ path, name }) => ({ path, name }))).toEqual([
      { path: '/', name: 'home' },
      { path: '/instance/:id', name: 'instance-detail' },
      { path: '/resources', name: 'resources' },
    ])
  })

  test('defers resource module evaluation until its lazy loader is invoked', async () => {
    let resourceModuleEvaluations = 0
    const resourceModule = defineComponent({ name: 'ResourceOverviewLoaderContract' })
    const routeRecords = createRoutes(async () => {
      resourceModuleEvaluations += 1
      return resourceModule
    })

    const resourceRoute = routeRecords.find(route => route.name === 'resources')
    expect(resourceModuleEvaluations).toBe(0)
    expect(resourceRoute?.component).toBeTypeOf('function')

    if (typeof resourceRoute?.component !== 'function')
      throw new Error('resources route must use a lazy component loader')

    await expect(resourceRoute.component()).resolves.toBe(resourceModule)
    expect(resourceModuleEvaluations).toBe(1)
  })

  test('describes the implemented traffic trend and privacy-aware financial overview', async () => {
    const source = await readFile(new URL('../../src/views/ResourceOverview.vue', import.meta.url), 'utf8')

    expect(source).toContain('实时节点状态、资源风险、5 日流量趋势与受隐私设置保护的成本概览。')
    expect(source).toContain('currency: costDisplayCurrency.value')
    expect(source).toContain('onCurrencyChange: setCostDisplayCurrency')
    expect(source).toContain('setStoredFinanceCurrency(currency)')
    expect(source).not.toContain('成本数据将在后续财务隐私设置阶段接入。')
    expect(source).not.toContain('历史趋势和成本数据将在后续阶段接入。')
  })
})
