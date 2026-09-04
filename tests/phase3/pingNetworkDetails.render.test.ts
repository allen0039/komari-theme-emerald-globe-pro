import type { ViteDevServer } from 'vite'
import type { Component } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createServer } from 'vite'
import { createSSRApp } from 'vue'

let viteServer: ViteDevServer
let NodePingNetworkDetails: Component
let NodePingNetworkSummaryRow: Component

const networks = [
  ['上海电信', '42ms', '2.5%', 'bg-blue-500'],
  ['上海联通', '55ms', '0.0%', 'bg-rose-500'],
  ['上海移动', '61ms', '5.0%', 'bg-emerald-500'],
].map(([name, latency, loss, identityClass], index) => ({
  name,
  latency,
  loss,
  identityClass,
  latencyToneClass: 'text-emerald-600',
  lossToneClass: 'text-amber-600',
  latencyBars: [{ key: `latency-${index}`, className: 'bg-emerald-500/80', tooltip: `${latency}` }],
  lossBars: [{ key: `loss-${index}`, className: 'bg-amber-500/80', tooltip: `${loss}` }],
}))

beforeAll(async () => {
  viteServer = await createServer({
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  })
  NodePingNetworkDetails = (await viteServer.ssrLoadModule('/src/components/NodePingNetworkDetails.vue')).default
  NodePingNetworkSummaryRow = (await viteServer.ssrLoadModule('/src/components/NodePingNetworkSummaryRow.vue')).default
})

afterAll(async () => {
  await viteServer.close()
})

describe('three-network detail rendering', () => {
  test('renders per-network packet loss with the same ordering as latency', async () => {
    const [latencyHtml, lossHtml] = await Promise.all([
      renderToString(createSSRApp(NodePingNetworkSummaryRow, {
        label: '三网',
        metric: 'latency',
        networks,
      })),
      renderToString(createSSRApp(NodePingNetworkSummaryRow, {
        label: '丢包',
        metric: 'loss',
        networks,
      })),
    ])

    for (const network of networks) {
      expect(latencyHtml).toContain(network.latency)
      expect(lossHtml).toContain(network.loss)
    }

    expect(latencyHtml).toContain('三网')
    expect(lossHtml).toContain('丢包')
    expect(lossHtml.indexOf(networks[0]!.loss)).toBeLessThan(lossHtml.indexOf(networks[1]!.loss))
    expect(lossHtml.indexOf(networks[1]!.loss)).toBeLessThan(lossHtml.indexOf(networks[2]!.loss))
  })

  test('keeps latency and packet loss in their own three-network panels', async () => {
    const [latencyHtml, lossHtml] = await Promise.all([
      renderToString(createSSRApp(NodePingNetworkDetails, {
        title: '延迟',
        metric: 'latency',
        networks,
        tooltip: '三网延迟',
        accessibleLabel: '测试节点三网延迟明细',
      })),
      renderToString(createSSRApp(NodePingNetworkDetails, {
        title: '丢包',
        metric: 'loss',
        networks,
        tooltip: '三网丢包',
        accessibleLabel: '测试节点三网丢包明细',
      })),
    ])

    for (const network of networks) {
      expect(latencyHtml).toContain(network.name)
      expect(latencyHtml).toContain(network.latency)
      expect(lossHtml).toContain(network.name)
      expect(lossHtml).toContain(network.loss)
    }

    expect(latencyHtml).toContain('aria-label="测试节点三网延迟明细"')
    expect(lossHtml).toContain('aria-label="测试节点三网丢包明细"')
    expect(latencyHtml).not.toContain(networks[0]!.loss)
    expect(lossHtml).not.toContain(networks[0]!.latency)
  })
})
