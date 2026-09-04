import type { TrafficTrendSnapshot } from '../../src/features/resource-overview/trafficTrend'
import { describe, expect, test } from 'bun:test'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, nextTick, ref } from 'vue'
import { useTrafficTrend } from '../../src/composables/useTrafficTrend'
import {
  buildTrafficTrendCacheKey,
  readTrafficTrendCache,
  writeTrafficTrendCache,
} from '../../src/features/resource-overview/trafficTrendCache'

function snapshot(): TrafficTrendSnapshot {
  return {
    state: 'empty',
    days: [],
    fetchedAt: 1,
    sourceKind: 'metrics',
    retentionDays: 30,
    availability: 'available',
    failureKind: null,
    retryable: false,
    message: '没有可用流量数据',
  }
}

function createStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}

describe('traffic trend cache', () => {
  test('isolates cache by login state, visible nodes and time zone', () => {
    const base = {
      origin: 'https://probe.test',
      loggedIn: false,
      entityIds: ['b', 'a'],
      timeZone: 'UTC',
      dates: ['2026-08-26', '2026-09-01'],
      schema: 1,
    }
    const guest = buildTrafficTrendCacheKey(base)

    expect(buildTrafficTrendCacheKey({ ...base, entityIds: ['a', 'b'] })).toBe(guest)
    expect(buildTrafficTrendCacheKey({ ...base, loggedIn: true })).not.toBe(guest)
    expect(buildTrafficTrendCacheKey({ ...base, entityIds: ['a'] })).not.toBe(guest)
    expect(buildTrafficTrendCacheKey({ ...base, timeZone: 'Asia/Shanghai' })).not.toBe(guest)
    expect(buildTrafficTrendCacheKey({ ...base, schema: 7 })).not.toBe(buildTrafficTrendCacheKey({ ...base, schema: 8 }))
  })

  test('rejects a cached day using the retired numeric coverage shape', () => {
    const storage = createStorage()
    const key = 'retired-coverage-cache'
    storage.setItem(key, JSON.stringify({
      cachedAt: 1_000_000,
      snapshot: {
        ...snapshot(),
        state: 'ready',
        days: [{
          date: '2026-09-01',
          uploadBytes: 0,
          downloadBytes: 0,
          totalBytes: 0,
          quality: 'complete',
          source: 'metric-delta',
          coverage: 1,
          isInProgress: false,
          reasons: [],
        }],
      },
    }))

    expect(readTrafficTrendCache(storage, key, 1_000_001)).toBeNull()
    expect(storage.getItem(key)).toBeNull()
  })

  test('accepts fresh cache entries and rejects expired entries', () => {
    const storage = createStorage()
    const key = 'trend-cache'
    const cachedAt = 1_000_000
    writeTrafficTrendCache(storage, key, snapshot(), cachedAt)

    expect(readTrafficTrendCache(storage, key, cachedAt + 14 * 60_000)).toEqual(snapshot())
    expect(readTrafficTrendCache(storage, key, cachedAt + 15 * 60_000)).toBeNull()
    expect(readTrafficTrendCache(storage, key, cachedAt + 16 * 60_000)).toBeNull()
  })

  test('dispose permanently stops the route-scoped watcher before it can issue a request', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: createStorage(),
    })
    setActivePinia(createPinia())
    const enabled = ref(false)
    const entityIds = ref(['node-a'])
    const scope = effectScope()
    const trend = scope.run(() => useTrafficTrend({ entityIds, enabled }))!

    await nextTick()
    expect(trend.snapshot.value.state).toBe('idle')

    trend.dispose()
    enabled.value = true
    await nextTick()

    expect(trend.snapshot.value.state).toBe('idle')
    scope.stop()
  })
})
