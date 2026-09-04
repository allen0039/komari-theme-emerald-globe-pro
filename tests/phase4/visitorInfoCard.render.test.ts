import type { ViteDevServer } from 'vite'
import type { Component } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createPinia } from 'pinia'
import { createServer } from 'vite'
import { createSSRApp } from 'vue'

let viteServer: ViteDevServer
let VisitorInfoCard: Component

const storage = new Map<string, string>()

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    get length() {
      return storage.size
    },
    clear: () => storage.clear(),
    getItem: (key: string) => storage.get(key) ?? null,
    key: (index: number) => [...storage.keys()][index] ?? null,
    removeItem: (key: string) => storage.delete(key),
    setItem: (key: string, value: string) => storage.set(key, value),
  },
})

beforeAll(async () => {
  viteServer = await createServer({
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  })
  VisitorInfoCard = (await viteServer.ssrLoadModule('/src/components/VisitorInfoCard.vue')).default
})

afterAll(async () => {
  await viteServer.close()
})

describe('visitor info card safe area', () => {
  test('keeps the collapsed visitor card private and within the mobile viewport', async () => {
    const app = createSSRApp(VisitorInfoCard)
    app.use(createPinia())
    const html = await renderToString(app)
    const appSource = await Bun.file('src/App.vue').text()

    expect(html).toContain('aria-label="展开访客详细信息"')
    expect(html).toContain('id="visitor-info-details"')
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="访客详细信息"')
    expect(html).toContain('max-w-[calc(100vw-1rem)]')
    expect(html).not.toContain('2403:')
    expect(html).not.toContain('获取中')
    expect(appSource).toContain('appStore.visitorInfoCardEnabled && \'visitor-info-safe-area\'')
  })

  test('keeps IP rows structurally inside the expand-only detail region', async () => {
    const source = await Bun.file('src/components/VisitorInfoCard.vue').text()

    expect(source).toContain('value: ip.value')
    expect(source).toContain('breakAll: true')
    expect(source).toContain('expandOnly: true')
    expect(source).toContain('visitorRows.value.filter(item => expand.value || !item.expandOnly)')
  })
})
