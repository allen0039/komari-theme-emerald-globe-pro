import type { RpcCall } from '../../src/utils/history/types'
import { describe, expect, test } from 'bun:test'
import { buildTrafficTrendCacheKey } from '../../src/features/resource-overview/trafficTrendCache'
import { createTrafficTrendRequestPool } from '../../src/features/resource-overview/trafficTrendRequestPool'
import { createHistoryGateway } from '../../src/utils/history/gateway'
import { RpcError } from '../../src/utils/rpc'

interface CapturedCall {
  method: string
  params?: Record<string, unknown> | unknown[]
  signal: AbortSignal | undefined
}

function createFakeRpc(responses: Array<unknown | Error>): { call: RpcCall, calls: CapturedCall[] } {
  const calls: CapturedCall[] = []
  return {
    calls,
    call: async <T>(method, params, options) => {
      calls.push({ method, params, signal: options?.signal })
      const response = responses.shift()
      if (response instanceof Error)
        throw response
      return response as T
    },
  }
}

const query = {
  entityIds: ['node-a'],
  start: '2026-08-26T00:00:00.000Z',
  end: '2026-09-02T00:00:00.000Z',
  maxPoints: 336,
}

function metricsResponse() {
  return {
    series: [
      {
        metric_key: 'traffic.up',
        entity_id: 'node-a',
        retention_days: 30,
        downsampled: true,
        downsample_algorithm: 'sum',
        interval_seconds: 3600,
        points: [{ time: '2026-08-26T01:00:00.000Z', value: 10 }],
      },
      {
        metric_key: 'traffic.down',
        entity_id: 'node-a',
        retention_days: 30,
        downsampled: true,
        downsample_algorithm: 'sum',
        interval_seconds: 3600,
        points: [{ time: '2026-08-26T01:00:00.000Z', value: 20 }],
      },
    ],
  }
}

describe('traffic trend request budget', () => {
  test('uses one metrics request when the batch capability succeeds', async () => {
    const rpc = createFakeRpc([metricsResponse()])

    const result = await createHistoryGateway(rpc.call).queryTraffic(query)

    expect(result.kind).toBe('metrics')
    expect(rpc.calls.map(call => call.method)).toEqual(['public:queryMetrics'])
  })

  test('uses at most two requests when metrics falls back to records', async () => {
    const rpc = createFakeRpc([
      new RpcError(-32601, 'Method not found'),
      { records: { 'node-a': [] } },
    ])

    const result = await createHistoryGateway(rpc.call).queryTraffic(query)

    expect(result.kind).toBe('records')
    expect(rpc.calls.map(call => call.method)).toEqual([
      'public:queryMetrics',
      'common:getRecords',
    ])
  })

  test('retries a transient metrics failure once without falling back to records', async () => {
    const rpc = createFakeRpc([
      new RpcError(-32000, 'Network error'),
      metricsResponse(),
    ])

    const result = await createHistoryGateway(rpc.call).queryTraffic(query)

    expect(result.kind).toBe('metrics')
    expect(rpc.calls.map(call => call.method)).toEqual([
      'public:queryMetrics',
      'public:queryMetrics',
    ])
  })

  test('does not use records after the one permitted metrics retry', async () => {
    const rpc = createFakeRpc([
      new RpcError(-32011, 'Request timeout'),
      new RpcError(-32601, 'Method not found'),
    ])

    await expect(createHistoryGateway(rpc.call).queryTraffic(query)).rejects.toMatchObject({ code: -32601 })
    expect(rpc.calls.map(call => call.method)).toEqual([
      'public:queryMetrics',
      'public:queryMetrics',
    ])
  })

  test('cancels retry backoff without issuing a second request', async () => {
    const rpc = createFakeRpc([new RpcError(-32000, 'Network error')])
    const controller = new AbortController()
    const pending = createHistoryGateway(rpc.call).queryTraffic({ ...query, signal: controller.signal })

    await Promise.resolve()
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(rpc.calls).toHaveLength(1)
  })

  test('uses one outer-range metrics request for every natural day', async () => {
    const rpc = createFakeRpc([metricsResponse()])

    const result = await createHistoryGateway(rpc.call).queryTraffic({
      ...query,
      entityIds: ['node-a', 'node-b'],
      start: '2026-08-29T00:00:00.000Z',
      end: '2026-09-03T00:00:00.000Z',
      maxPoints: 240,
    })

    expect(result.kind).toBe('metrics')
    expect(rpc.calls).toHaveLength(1)
    expect(rpc.calls[0]?.params).toEqual({
      metric_keys: ['traffic.up', 'traffic.down'],
      entity_ids: ['node-a', 'node-b'],
      start: '2026-08-29T00:00:00.000Z',
      end: '2026-09-03T00:00:00.000Z',
      aggregation: 'sum',
      max_points: 240,
    })
  })

  test('keeps empty metrics evidence without a records fallback', async () => {
    const sparse = metricsResponse()
    sparse.series.forEach((series) => {
      series.interval_seconds = 3600
      series.points = []
    })
    const rpc = createFakeRpc([sparse])

    const result = await createHistoryGateway(rpc.call).queryTraffic({
      ...query,
      start: '2026-08-29T00:00:00.000Z',
      end: '2026-09-03T00:00:00.000Z',
      maxPoints: 240,
    })

    expect(result.kind).toBe('metrics')
    if (result.kind !== 'metrics')
      throw new Error('expected metrics result')
    expect(result.series.every(series => series.points.length === 0)).toBe(true)
    expect(rpc.calls).toHaveLength(1)
  })

  test('keeps sparse metrics without segmented repair requests', async () => {
    const sparse = metricsResponse()
    sparse.series.forEach((series) => {
      series.points = [{ time: '2026-09-01T00:00:00.000Z', value: 10 }]
    })
    const rpc = createFakeRpc([sparse])

    const result = await createHistoryGateway(rpc.call).queryTraffic(query)

    expect(result.kind).toBe('metrics')
    expect(rpc.calls).toHaveLength(1)
    expect(rpc.calls[0]?.method).toBe('public:queryMetrics')
  })

  test('makes no request for an empty UUID list', async () => {
    const rpc = createFakeRpc([])

    await createHistoryGateway(rpc.call).queryTraffic({ ...query, entityIds: [] })

    expect(rpc.calls).toHaveLength(0)
  })

  test('shares one promise for concurrent consumers of the same key', () => {
    const pool = createTrafficTrendRequestPool<string>()
    let starts = 0
    let resolve!: (value: string) => void
    const first = pool.acquire('same-key', (_signal) => {
      starts += 1
      return new Promise<string>((done) => {
        resolve = done
      })
    })
    const second = pool.acquire('same-key', () => {
      starts += 1
      return Promise.resolve('unexpected')
    })

    expect(first.promise).toBe(second.promise)
    expect(starts).toBe(1)
    resolve('ready')
    first.release()
    second.release()
  })

  test('keeps guest and admin cache keys isolated', () => {
    const base = {
      origin: 'https://probe.test',
      loggedIn: false,
      entityIds: ['node-a'],
      timeZone: 'UTC',
      dates: ['2026-08-26', '2026-09-01'],
      schema: 1,
    }

    expect(buildTrafficTrendCacheKey({ ...base, loggedIn: true })).not.toBe(buildTrafficTrendCacheKey(base))
  })

  test('aborts a pending chain when its final consumer releases it', () => {
    const pool = createTrafficTrendRequestPool<never>()
    let signal: AbortSignal | undefined
    const request = pool.acquire('pending-key', (requestSignal) => {
      signal = requestSignal
      return new Promise<never>(() => {})
    })

    expect(signal?.aborted).toBe(false)
    request.release()
    expect(signal?.aborted).toBe(true)
  })

  test('releases a failed chain without an unhandled derived rejection', async () => {
    const pool = createTrafficTrendRequestPool<string>()
    const failure = new Error('request failed')
    const first = pool.acquire('retry-key', () => Promise.reject(failure))

    await expect(first.promise).rejects.toBe(failure)

    let retryStarts = 0
    const retry = pool.acquire('retry-key', () => {
      retryStarts += 1
      return Promise.resolve('recovered')
    })
    await expect(retry.promise).resolves.toBe('recovered')
    expect(retryStarts).toBe(1)
    retry.release()
  })
})
