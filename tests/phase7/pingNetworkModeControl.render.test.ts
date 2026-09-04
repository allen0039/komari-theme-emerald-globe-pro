import type { Component } from 'vue'
import { readFileSync } from 'node:fs'
import { renderToString } from '@vue/server-renderer'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createServer } from 'vite'
import { createSSRApp } from 'vue'

let viteServer: Awaited<ReturnType<typeof createServer>>
let PingNetworkModeControl: Component

beforeAll(async () => {
  viteServer = await createServer({
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  })
  PingNetworkModeControl = (await viteServer.ssrLoadModule('/src/components/PingNetworkModeControl.vue')).default
})

afterAll(async () => {
  await viteServer.close()
})

async function renderControl(modelValue: boolean): Promise<string> {
  return renderToString(createSSRApp(PingNetworkModeControl, { modelValue }))
}

describe('ping network mode control', () => {
  test('renders explicit summary and detail controls with pressed state', async () => {
    const summary = await renderControl(false)
    const details = await renderControl(true)

    for (const html of [summary, details]) {
      expect(html).toContain('摘要')
      expect(html).toContain('明细')
      expect(html).toContain('显示三网摘要')
      expect(html).toContain('显示三网明细')
      expect(html).toContain('h-11')
      expect(html).toContain('md:h-8')
      expect(html).not.toContain('h-10')
    }
    expect(summary).toContain('aria-pressed="true"')
    expect(details).toContain('aria-pressed="true"')
    expect(summary.indexOf('aria-label="显示三网摘要"')).toBeLessThan(summary.indexOf('aria-label="显示三网明细"'))
  })

  test('replaces the tooltip switch control in HomeView while preserving v-model storage', () => {
    const source = readFileSync(new URL('../../src/views/HomeView.vue', import.meta.url), 'utf8')

    expect(source).toContain('import PingNetworkModeControl from \'@/components/PingNetworkModeControl.vue\'')
    expect(source).toContain('v-model="appStore.showPingNetworkDetails"')
    expect(source).not.toContain('import { DataTooltip } from \'@/components/ui/data-tooltip\'')
    expect(source).not.toContain('import { Switch } from \'@/components/ui/switch\'')
  })
})
