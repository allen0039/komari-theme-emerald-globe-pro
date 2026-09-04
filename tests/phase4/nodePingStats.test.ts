import { describe, expect, test } from 'bun:test'
import {
  buildNodePingStats,
  getPersistableNodePingStats,
  parseNodePingStatsCache,
  shouldRefreshPingRecords,
  shouldShowCachedPingFallback,
} from '../../src/composables/useNodePingStats'

describe('node ping task aggregation', () => {
  test('keeps an active task whose recent samples are all lost', () => {
    const stats = buildNodePingStats([
      { client: 'node-a', task_id: 7, time: '2026-09-01T00:00:00Z', value: -1 },
      { client: 'node-a', task_id: 7, time: '2026-09-01T00:01:00Z', value: -1 },
    ], [{ id: 7, name: '浙江电信' }])

    expect(stats.perTaskStats).toHaveLength(1)
    expect(stats.perTaskStats[0]).toMatchObject({ taskId: 7, avgLatency: -1, loss: 100 })
    expect(stats).toMatchObject({ avgLatency: -1, avgLoss: 100, hasData: true })
    expect(stats.hasData).toBe(true)
  })

  test('keeps partial loss and does not invent latency for full loss', () => {
    const stats = buildNodePingStats([
      { client: 'node-a', task_id: 1, time: '2026-09-01T00:00:00Z', value: 40 },
      { client: 'node-a', task_id: 1, time: '2026-09-01T00:01:00Z', value: -1 },
      { client: 'node-a', task_id: 2, time: '2026-09-01T00:00:00Z', value: -1 },
    ], [{ id: 1, name: '浙江联通' }, { id: 2, name: '浙江移动' }])

    expect(stats.perTaskStats.map(item => [item.taskId, item.avgLatency, item.loss]))
      .toEqual([[1, 40, 50], [2, -1, 100]])
  })
})

describe('node ping cache freshness', () => {
  test('classifies five-minute cache and discards data older than one day', () => {
    const now = Date.parse('2026-09-01T12:00:00Z')
    const stats = { avgLatency: 40, avgLoss: 0, avgVolatility: 1, history: [], hasData: true, perTaskStats: [] }
    const fresh = JSON.stringify({ version: 8, updatedAt: now - 60_000, stats })
    const stale = JSON.stringify({ version: 8, updatedAt: now - 10 * 60_000, stats })
    const expired = JSON.stringify({ version: 8, updatedAt: now - 25 * 60 * 60_000, stats })

    expect(parseNodePingStatsCache(fresh, now)?.stale).toBe(false)
    expect(parseNodePingStatsCache(stale, now)?.stale).toBe(true)
    expect(parseNodePingStatsCache(expired, now)).toBeNull()
  })

  test('rejects malformed cache data', () => {
    const now = Date.parse('2026-09-01T12:00:00Z')

    expect(parseNodePingStatsCache('{not-json', now)).toBeNull()
  })

  test('only shows a marker for stale fallback data', () => {
    const now = Date.parse('2026-09-01T12:00:00Z')
    const stats = { avgLatency: 40, avgLoss: 0, avgVolatility: 1, history: [], hasData: true, perTaskStats: [] }
    const fresh = parseNodePingStatsCache(JSON.stringify({ version: 8, updatedAt: now - 60_000, stats }), now)
    const stale = parseNodePingStatsCache(JSON.stringify({ version: 8, updatedAt: now - 10 * 60_000, stats }), now)

    expect(shouldShowCachedPingFallback(fresh)).toBe(false)
    expect(shouldShowCachedPingFallback(stale)).toBe(true)
  })

  test('does not select stale fallback data for cache persistence', () => {
    const now = Date.parse('2026-09-01T12:00:00Z')
    const stats = { avgLatency: 40, avgLoss: 0, avgVolatility: 1, history: [], hasData: true, perTaskStats: [] }
    const raw = JSON.stringify({ version: 8, updatedAt: now - 10 * 60_000, stats })
    const fallback = parseNodePingStatsCache(raw, now)

    expect(fallback).not.toBeNull()
    expect(getPersistableNodePingStats(null)).toBeNull()
    expect(parseNodePingStatsCache(raw, now + 24 * 60 * 60_000)).toBeNull()
  })
})

describe('node ping refresh visibility', () => {
  test('does not refresh hidden pages and refreshes stale visible pages', () => {
    expect(shouldRefreshPingRecords(0, 120_000, false)).toBe(false)
    expect(shouldRefreshPingRecords(0, 120_000, true)).toBe(true)
    expect(shouldRefreshPingRecords(90_000, 120_000, true)).toBe(false)
  })
})
