import type { ViteDevServer } from 'vite'
import type { Component } from 'vue'
import type { LiveTrafficModuleContract, PressureHeatmapModuleContract, QuotaRankingModuleContract, RenewalTimelineModuleContract } from '../../src/features/resource-overview/contract'
import type { NodeData } from '../../src/stores/nodes'
import { renderToString } from '@vue/server-renderer'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createServer } from 'vite'
import { createSSRApp } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { buildResourceOverviewContract } from '../../src/features/resource-overview/contract'
import { buildLiveTrafficViewModel } from '../../src/features/resource-overview/realtime'

let viteServer: ViteDevServer
let LiveTrafficPanel: Component
let PressureHeatmapPanel: Component
let QuotaRankingPanel: Component
let RenewalTimelinePanel: Component

async function renderRenewalPanel(props: Record<string, unknown>): Promise<string> {
  const app = createSSRApp(RenewalTimelinePanel, props)
  app.use(createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/instance/:id', name: 'instance-detail', component: { template: '<div />' } }],
  }))
  return renderToString(app)
}

const cachedNode = {
  uuid: 'cached-node',
  name: 'cached-node-must-not-render',
  statusObserved: true,
  online: true,
  cpu: 90,
  ram: 90,
  mem_total: 100,
  disk: 90,
  disk_total: 100,
  net_in: 1024,
  net_out: 2048,
  net_total_up: 300,
  net_total_down: 400,
  traffic_limit: 1000,
  traffic_limit_type: 'sum',
  group: 'core',
  region: '🇨🇳',
  expired_at: '2026-09-05',
  auto_renewal: true,
} as NodeData

beforeAll(async () => {
  viteServer = await createServer({
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  })
  LiveTrafficPanel = (await viteServer.ssrLoadModule('/src/components/resource-overview/LiveTrafficPanel.vue')).default
  PressureHeatmapPanel = (await viteServer.ssrLoadModule('/src/components/resource-overview/PressureHeatmapPanel.vue')).default
  QuotaRankingPanel = (await viteServer.ssrLoadModule('/src/components/resource-overview/QuotaRankingPanel.vue')).default
  RenewalTimelinePanel = (await viteServer.ssrLoadModule('/src/components/resource-overview/RenewalTimelinePanel.vue')).default
})

afterAll(async () => {
  await viteServer.close()
})

describe('phase 3 realtime panel rendering', () => {
  test('keeps cached realtime node content out of the loading skeleton', async () => {
    const modules = buildResourceOverviewContract().rows.flatMap(row => row.modules)
    const liveModule = modules.find(module => module.id === 'live-traffic') as LiveTrafficModuleContract
    const pressureModule = modules.find(module => module.id === 'pressure-heatmap') as PressureHeatmapModuleContract
    const quotaModule = modules.find(module => module.id === 'quota-ranking') as QuotaRankingModuleContract
    const renewalModule = modules.find(module => module.id === 'renewal-timeline') as RenewalTimelineModuleContract

    const [liveHtml, pressureHtml, quotaHtml, renewalHtml] = await Promise.all([
      renderToString(createSSRApp(LiveTrafficPanel, {
        module: liveModule,
        viewModel: buildLiveTrafficViewModel([cachedNode]),
        loading: true,
      })),
      renderToString(createSSRApp(PressureHeatmapPanel, { module: pressureModule, nodes: [cachedNode], loading: true })),
      renderToString(createSSRApp(QuotaRankingPanel, { module: quotaModule, nodes: [cachedNode], loading: true })),
      renderRenewalPanel({ module: renewalModule, nodes: [cachedNode], loading: true }),
    ])

    for (const html of [liveHtml, pressureHtml, quotaHtml, renewalHtml])
      expect(html).not.toContain(cachedNode.name)

    expect(liveHtml).toContain('正在读取在线探针实时带宽')
    expect(pressureHtml).toContain('正在读取 CPU、内存与磁盘压力')
    expect(quotaHtml).toContain('正在读取探针累计流量与额度')
    expect(renewalHtml).toContain('正在读取探针到期日期')
  })

  test('does not expose an empty status as a child of an ARIA list', async () => {
    const pressureModule = buildResourceOverviewContract().rows.flatMap(row => row.modules).find(module => module.id === 'pressure-heatmap') as PressureHeatmapModuleContract
    const html = await renderToString(createSSRApp(PressureHeatmapPanel, { module: pressureModule, nodes: [] }))

    expect(html).toContain('暂无探针数据')
    expect(html).not.toContain('role="list"')
  })

  test('limits the quota ranking viewport and loading skeleton to three complete rows', async () => {
    const quotaModule = buildResourceOverviewContract().rows.flatMap(row => row.modules).find(module => module.id === 'quota-ranking') as QuotaRankingModuleContract
    const nodes = Array.from({ length: 4 }, (_, index) => ({
      ...cachedNode,
      uuid: `quota-${index + 1}`,
      name: `quota-node-${index + 1}`,
    }))
    const [loadedHtml, loadingHtml] = await Promise.all([
      renderToString(createSSRApp(QuotaRankingPanel, { module: quotaModule, nodes })),
      renderToString(createSSRApp(QuotaRankingPanel, { module: quotaModule, nodes, loading: true })),
    ])

    expect(loadedHtml).toContain('max-h-[6rem] overflow-y-auto')
    expect(loadedHtml).not.toContain('max-h-[6.75rem]')
    expect(loadingHtml).toContain('max-h-[6rem] overflow-hidden')
    expect(loadingHtml.match(/<li/g)).toHaveLength(3)
  })

  test('renders renewal events from nodes instead of static placeholder names', async () => {
    const renewalModule = buildResourceOverviewContract().rows.flatMap(row => row.modules).find(module => module.id === 'renewal-timeline') as RenewalTimelineModuleContract
    const html = await renderRenewalPanel({
      module: renewalModule,
      nodes: [cachedNode],
      now: new Date('2026-08-31T12:00:00+08:00'),
    })

    expect(html).toContain(cachedNode.name)
    expect(html).toContain('2026-09-05')
    expect(html).toContain('5 天后')
    expect(html).not.toContain('edge-shanghai-enterprise-long-node-name')
    expect(html).not.toContain('续费事件时间线占位')
  })

  test('renders compact renewal filters, collapsed remainder control, and detail links', async () => {
    const renewalModule = buildResourceOverviewContract().rows.flatMap(row => row.modules).find(module => module.id === 'renewal-timeline') as RenewalTimelineModuleContract
    const nodes = Array.from({ length: 21 }, (_, index) => ({
      ...cachedNode,
      uuid: `renewal-${index + 1}`,
      name: `renewal-node-${index + 1}`,
      expired_at: `2026-09-${String(index % 20 + 1).padStart(2, '0')}`,
    }))
    const html = await renderRenewalPanel({
      module: renewalModule,
      nodes,
      now: new Date('2026-08-31T12:00:00+08:00'),
    })

    expect(html).toContain('30 天内')
    expect(html).toContain('已过期')
    expect(html).toContain('全部')
    expect(html).toContain('展开其余 16 台')
    expect(html).toContain('href="/instance/renewal-1"')
    expect(html).toContain('renewal-node-1')
    expect(html).not.toContain('renewal-node-6')
  })
})
