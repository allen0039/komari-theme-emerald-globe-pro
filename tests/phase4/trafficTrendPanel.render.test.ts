import type { Component } from 'vue'
import type { TrafficTrendModuleContract } from '../../src/features/resource-overview/contract'
import type { TrafficTrendSnapshot } from '../../src/features/resource-overview/trafficTrend'
import { renderToString } from '@vue/server-renderer'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createServer } from 'vite'
import { createSSRApp } from 'vue'
import { buildResourceOverviewContract } from '../../src/features/resource-overview/contract'

let viteServer: Awaited<ReturnType<typeof createServer>>
let TrafficTrendPanel: Component

const module = buildResourceOverviewContract().rows.flatMap(row => row.modules).find(candidate => candidate.id === 'traffic-trend') as TrafficTrendModuleContract

const ready: TrafficTrendSnapshot = {
  state: 'ready',
  fetchedAt: Date.parse('2026-09-01T12:00:00Z'),
  sourceKind: 'metrics',
  retentionDays: 30,
  availability: 'available',
  failureKind: null,
  retryable: false,
  message: '采集：1天，缺失：0天',
  days: [{
    date: '2026-09-01',
    uploadBytes: 1024,
    downloadBytes: 2048,
    totalBytes: 3072,
    quality: 'partial',
    source: 'metric-delta',
    coverage: {
      average: 0.5,
      minimum: 1,
      availableEntities: 1,
      totalEntities: 2,
    },
    isInProgress: true,
    reasons: [],
  }],
}

function snapshot(state: TrafficTrendSnapshot['state'], message: string): TrafficTrendSnapshot {
  return { ...ready, state, message, days: [] }
}

beforeAll(async () => {
  viteServer = await createServer({
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  })
  TrafficTrendPanel = (await viteServer.ssrLoadModule('/src/components/resource-overview/TrafficTrendPanel.vue')).default
})

afterAll(async () => {
  await viteServer.close()
})

async function renderPanel(trendSnapshot: TrafficTrendSnapshot) {
  return renderToString(createSSRApp(TrafficTrendPanel, {
    module,
    snapshot: trendSnapshot,
    loading: trendSnapshot.state === 'loading',
    refreshing: false,
    onRefresh: () => Promise.resolve(),
  }))
}

describe('traffic trend panel rendering', () => {
  test('renders real daily traffic, quality evidence, and a refresh control', async () => {
    const html = await renderPanel(ready)

    expect(html).toContain('09/01')
    expect(html).toContain('1.0 KB')
    expect(html).toContain('2.0 KB')
    expect(html).toContain('下载：2.0 KB，上传：1.0 KB，总量：3.0 KB')
    expect(html).toContain('进行中')
    expect(html).toContain('指标汇总')
    expect(html).toContain('部分')
    expect(html).toContain('平均覆盖：50%')
    expect(html).toContain('最低覆盖：100%')
    expect(html).toContain('有效探针：1/2')
    expect(html).toContain('刷新趋势')
    expect(html).toContain('采集：1天，缺失：0天')
    expect(html).toContain('overflow-visible')
    expect(html).toContain('<table')
    expect(html).not.toContain('animate-pulse')
    expect(html).not.toContain('metric-delta')
    expect(html).not.toContain('partial')
    expect(html).not.toContain('missing')
  })

  test.each([
    ['empty', '没有可用的历史流量'],
    ['unsupported', '当前服务不支持历史指标'],
    ['error', '读取历史流量失败'],
  ] as const)('renders %s state message without placeholder bars', async (state, message) => {
    const html = await renderPanel(snapshot(state, message))

    expect(html).toContain(message)
    expect(html).not.toContain('animate-pulse')
    expect(html).not.toContain('downloadHeights')
  })

  test('shows a request failure before a retention warning', async () => {
    const html = await renderPanel({
      ...snapshot('error', 'raw gateway message'),
      failureKind: 'network',
      availability: 'retention-insufficient',
    })

    expect(html).toContain('历史流量网络连接失败')
    expect(html).toContain('历史记录保留时间不足，趋势可能不完整')
    expect(html.indexOf('历史流量网络连接失败')).toBeLessThan(html.indexOf('历史记录保留时间不足，趋势可能不完整'))
    expect(html).not.toContain('raw gateway message')
  })

  test('shows the recording-disabled explanation without a failure', async () => {
    const html = await renderPanel({
      ...snapshot('empty', 'fallback text'),
      availability: 'recording-disabled',
    })

    expect(html).toContain('服务端未开启历史流量记录')
    expect(html).not.toContain('fallback text')
  })
})
