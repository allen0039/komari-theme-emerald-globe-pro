import type { ViteDevServer } from 'vite'
import type { Component } from 'vue'
import type { PressureHeatmapModuleContract } from '../../src/features/resource-overview/contract'
import type { NodeData } from '../../src/stores/nodes'
import { renderToString } from '@vue/server-renderer'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createServer } from 'vite'
import { createSSRApp } from 'vue'
import {
  buildResourceOverviewContract,
} from '../../src/features/resource-overview/contract'

let viteServer: ViteDevServer
let PressureHeatmapPanel: Component

beforeAll(async () => {
  viteServer = await createServer({
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  })
  PressureHeatmapPanel = (await viteServer.ssrLoadModule('/src/components/resource-overview/PressureHeatmapPanel.vue')).default
})

afterAll(async () => {
  await viteServer.close()
})

describe('pressure heatmap panel rendering', () => {
  test('defaults to all metrics and exposes direct all-or-single display controls', async () => {
    const pressureModule = buildResourceOverviewContract().rows.flatMap(row => row.modules).find(module => module.id === 'pressure-heatmap') as PressureHeatmapModuleContract
    const nodes = [
      { uuid: 'normal', name: 'normal', statusObserved: true, online: true, cpu: 20, ram: 30, mem_total: 100, disk: 40, disk_total: 100 },
      { uuid: 'warning', name: 'warning', statusObserved: true, online: true, cpu: 60, ram: 70, mem_total: 100, disk: 80, disk_total: 100 },
    ] as NodeData[]

    const html = await renderToString(createSSRApp(PressureHeatmapPanel, { module: pressureModule, nodes }))

    expect(html).toContain('压力显示模式与指标')
    expect(html).toContain('同时显示 CPU、内存和硬盘压力')
    expect(html).toContain('仅显示 CPU 压力')
    expect(html).toContain('仅显示内存压力')
    expect(html).toContain('仅显示硬盘压力')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('role="table"')
    expect(html).toContain('role="columnheader"')
    expect(html).toContain('CPU 60%，需关注')
    expect(html).toContain('内存 70%，需关注')
    expect(html).toContain('硬盘 80%，高压力')
    expect(html.match(/<svg/g)).toHaveLength(3)
    expect(html).toContain('bg-warning/20')
    expect(html).toContain('bg-destructive/10')
    expect(html).not.toContain('role="tab"')
  })
})
