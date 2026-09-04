import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import {
  createHistoryGateway,
  HistoryCapabilitiesUnavailableError,
  HistoryProtocolError,
} from '../../src/utils/history/gateway'
import { RpcError } from '../../src/utils/rpc'

interface CapturedCall {
  method: string
  params?: Record<string, unknown> | unknown[]
  signal?: AbortSignal
}

function readFixture(path: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/${path}`, import.meta.url), 'utf8'))
}

function makeSequenceRpc(sequence: Array<unknown | Error>) {
  const calls: CapturedCall[] = []
  const call = async <T>(
    method: string,
    params?: Record<string, unknown> | unknown[],
    options?: { signal?: AbortSignal },
  ): Promise<T> => {
    calls.push({ method, params, signal: options?.signal })
    const next = sequence.shift()
    if (next instanceof Error)
      throw next
    return next as T
  }

  return { call, calls }
}

const request = {
  entityIds: ['node-a', 'node-b'],
  start: '2026-08-23T16:00:00Z',
  end: '2026-08-30T16:00:00Z',
  maxPoints: 336,
}

describe('traffic history gateway contract', () => {
  test('uses one explicit multi-entity sum query for Komari 1.3.2', async () => {
    const fixture = readFixture('komari-1.3.2/traffic-metrics.json')
    const rpc = makeSequenceRpc([fixture])
    const signal = new AbortController().signal

    const result = await createHistoryGateway(rpc.call).queryTraffic({ ...request, signal })

    expect(rpc.calls).toEqual([{
      method: 'public:queryMetrics',
      params: {
        metric_keys: ['traffic.up', 'traffic.down'],
        entity_ids: ['node-a', 'node-b'],
        start: request.start,
        end: request.end,
        aggregation: 'sum',
        max_points: 336,
      },
      signal,
    }])
    expect(result.kind).toBe('metrics')
    if (result.kind !== 'metrics')
      throw new Error('expected metrics result')
    expect(result.retentionDays).toBe(30)
    expect(result.series).toHaveLength(4)
    expect(result.series[2]?.points[0]?.value).toBe(0)
  })

  test('accepts null points from Komari 1.4.3 without losing partial metric data', async () => {
    const fixture = readFixture('komari-1.4.3/traffic-metrics.json')
    const rpc = makeSequenceRpc([fixture])

    const result = await createHistoryGateway(rpc.call).queryTraffic(request)

    expect(rpc.calls).toHaveLength(1)
    expect(result.kind).toBe('metrics')
    if (result.kind !== 'metrics')
      throw new Error('expected metrics result')
    expect(result.series.find(series => series.entityId === 'node-b')?.points).toEqual([])
  })

  test('queries the full natural-day range once and leaves sparse evidence intact', async () => {
    const metricPair = (points: Array<{ time: string, value: number }>) => ({
      series: [
        {
          metric_key: 'traffic.up',
          entity_id: 'node-a',
          retention_days: 5,
          downsampled: true,
          downsample_algorithm: 'sum',
          interval_seconds: 3600,
          points,
        },
        {
          metric_key: 'traffic.down',
          entity_id: 'node-a',
          retention_days: 5,
          downsampled: true,
          downsample_algorithm: 'sum',
          interval_seconds: 3600,
          points,
        },
      ],
    })
    const rpc = makeSequenceRpc([metricPair([
      { time: '2026-08-29T00:00:00Z', value: 10 },
      { time: '2026-08-29T23:00:00Z', value: 20 },
      { time: '2026-08-30T01:00:00Z', value: 1 },
    ])])

    const result = await createHistoryGateway(rpc.call).queryTraffic({
      entityIds: ['node-a'],
      start: '2026-08-29T00:00:00Z',
      end: '2026-08-31T00:00:00Z',
      maxPoints: 96,
    })

    expect(result.kind).toBe('metrics')
    expect(rpc.calls).toHaveLength(1)
    expect(rpc.calls[0]?.params).toMatchObject({
      entity_ids: ['node-a'],
      start: '2026-08-29T00:00:00Z',
      end: '2026-08-31T00:00:00Z',
      max_points: 96,
    })
    if (result.kind !== 'metrics')
      throw new Error('expected metrics result')
    expect(result.series
      .filter(series => series.metricKey === 'traffic.up')
      .flatMap(series => series.points.map(point => point.time))
      .sort()).toEqual([
      '2026-08-29T00:00:00Z',
      '2026-08-29T23:00:00Z',
      '2026-08-30T01:00:00Z',
    ])
  })

  test('does not derive retention metadata from an unexpected entity', async () => {
    const fixture = readFixture('komari-1.3.2/traffic-metrics.json') as {
      series: Array<Record<string, unknown>>
    }
    fixture.series.push({
      ...fixture.series[0],
      entity_id: 'unexpected-node',
      retention_days: 1,
    })
    const rpc = makeSequenceRpc([fixture])

    const result = await createHistoryGateway(rpc.call).queryTraffic(request)

    expect(result.kind).toBe('metrics')
    if (result.kind !== 'metrics')
      throw new Error('expected metrics result')
    expect(result.retentionDays).toBe(30)
    expect(result.series.every(series => series.entityId !== 'unexpected-node')).toBe(true)
  })

  test('does not let an empty entity list turn into a backend-wide query', async () => {
    const rpc = makeSequenceRpc([])

    const result = await createHistoryGateway(rpc.call).queryTraffic({ ...request, entityIds: [] })

    expect(result).toEqual({ kind: 'metrics', retentionDays: null, series: [] })
    expect(rpc.calls).toEqual([])
  })

  test.each([
    new RpcError(-32601, 'Method not found'),
    new RpcError(-32602, 'unknown metric key: traffic.up'),
  ])('falls back once for an unavailable metrics capability', async (metricError) => {
    const fixture = readFixture('komari-1.3.2/traffic-records.json')
    const rpc = makeSequenceRpc([metricError, fixture])

    const result = await createHistoryGateway(rpc.call).queryTraffic(request)

    expect(rpc.calls).toHaveLength(2)
    expect(rpc.calls[1]).toEqual({
      method: 'common:getRecords',
      params: {
        type: 'load',
        start: request.start,
        end: request.end,
        load_type: 'all',
        maxCount: -1,
      },
      signal: undefined,
    })
    expect(result.kind).toBe('records')
    if (result.kind !== 'records')
      throw new Error('expected records result')
    expect(result.sampled).toBe(false)
    expect(Object.keys(result.records)).toEqual(['node-a', 'node-b'])
    expect(result.records['node-a']?.[0]?.traffic_up).toBe(100)
  })

  test('reports unsupported history only when both metrics and records capabilities are absent', async () => {
    const rpc = makeSequenceRpc([
      new RpcError(-32601, 'Method not found'),
      new RpcError(-32601, 'Method not found'),
    ])

    await expect(
      createHistoryGateway(rpc.call).queryTraffic(request),
    ).rejects.toBeInstanceOf(HistoryCapabilitiesUnavailableError)
    expect(rpc.calls.map(call => call.method)).toEqual([
      'public:queryMetrics',
      'common:getRecords',
    ])
  })

  test('does not report unsupported when only metric keys are unavailable', async () => {
    const recordsError = new RpcError(-32601, 'Method not found')
    const rpc = makeSequenceRpc([
      new RpcError(-32602, 'unknown metric key: traffic.up'),
      recordsError,
    ])

    await expect(createHistoryGateway(rpc.call).queryTraffic(request)).rejects.toBe(recordsError)
    expect(rpc.calls.map(call => call.method)).toEqual([
      'public:queryMetrics',
      'common:getRecords',
    ])
  })

  test('keeps a supported-but-empty metrics response without querying records', async () => {
    const emptyMetrics = readFixture('komari-1.4.3/traffic-metrics.json') as { series: Array<{ points: unknown }> }
    emptyMetrics.series.forEach((series) => {
      series.points = null
    })
    const rpc = makeSequenceRpc([emptyMetrics])

    const result = await createHistoryGateway(rpc.call).queryTraffic(request)

    expect(result.kind).toBe('metrics')
    if (result.kind !== 'metrics')
      throw new Error('expected metrics result')
    expect(result.series.every(series => series.points.length === 0)).toBe(true)
    expect(rpc.calls.map(call => call.method)).toEqual(['public:queryMetrics'])
  })

  test.each([
    new RpcError(-32041, 'Permission denied'),
    new RpcError(-32000, 'Network error'),
    new RpcError(-32010, 'Request cancelled'),
  ])('preserves an operational records error after the metrics capability fallback', async (recordsError) => {
    const rpc = makeSequenceRpc([new RpcError(-32601, 'Method not found'), recordsError])

    await expect(createHistoryGateway(rpc.call).queryTraffic(request)).rejects.toBe(recordsError)
    expect(rpc.calls).toHaveLength(2)
  })

  test('filters grouped legacy records to the requested entity boundary', async () => {
    const records = readFixture('komari-1.3.2/traffic-records.json') as { records: Record<string, unknown> }
    records.records['stale-node'] = [{ client: 'stale-node', time: '2026-08-24T00:00:00Z' }]
    const rpc = makeSequenceRpc([new RpcError(-32601, 'Method not found'), records])

    const result = await createHistoryGateway(rpc.call).queryTraffic({ ...request, entityIds: ['node-a'] })

    expect(result.kind).toBe('records')
    if (result.kind !== 'records')
      throw new Error('expected records result')
    expect(Object.keys(result.records)).toEqual(['node-a'])
  })

  test('returns metrics when every metric series is empty', async () => {
    const emptyMetrics = readFixture('komari-1.4.3/traffic-metrics.json') as { series: Array<{ points: unknown }> }
    emptyMetrics.series.forEach((series) => {
      series.points = null
    })
    const rpc = makeSequenceRpc([emptyMetrics])

    const result = await createHistoryGateway(rpc.call).queryTraffic(request)

    expect(result.kind).toBe('metrics')
    if (result.kind !== 'metrics')
      throw new Error('expected metrics result')
    expect(result.series.every(series => series.points.length === 0)).toBe(true)
    expect(rpc.calls).toHaveLength(1)
  })

  test.each([
    new RpcError(-32041, 'Permission denied'),
    new RpcError(-32040, 'Unauthenticated'),
    new RpcError(-32010, 'Request cancelled'),
  ])('does not hide operational errors behind a records fallback', async (error) => {
    const rpc = makeSequenceRpc([error])

    await expect(createHistoryGateway(rpc.call).queryTraffic(request)).rejects.toBe(error)
    expect(rpc.calls).toHaveLength(1)
  })

  test('rejects malformed metrics without falling back', async () => {
    const rpc = makeSequenceRpc([{ series: {} }])

    await expect(createHistoryGateway(rpc.call).queryTraffic(request)).rejects.toBeInstanceOf(HistoryProtocolError)
    expect(rpc.calls).toHaveLength(1)
  })

  test('rejects downsampled metrics that do not confirm sum aggregation', async () => {
    const fixture = readFixture('komari-1.3.2/traffic-metrics.json') as {
      series: Array<Record<string, unknown>>
    }
    fixture.series.forEach((series) => {
      series.downsample_algorithm = 'avg'
    })
    const rpc = makeSequenceRpc([fixture])

    await expect(createHistoryGateway(rpc.call).queryTraffic(request)).rejects.toBeInstanceOf(HistoryProtocolError)
    expect(rpc.calls).toHaveLength(1)
  })

  test('probes the stable rpc.methods capability without adding it to normal queries', async () => {
    const rpc = makeSequenceRpc([['common:getRecords', 'public:queryMetrics']])

    const result = await createHistoryGateway(rpc.call).probeCapabilities()

    expect(rpc.calls).toEqual([{ method: 'rpc.methods', params: undefined, signal: undefined }])
    expect(result).toEqual({ metrics: true, records: true })
  })

  test('rejects a malformed capability response', async () => {
    const rpc = makeSequenceRpc([{ methods: [] }])

    await expect(createHistoryGateway(rpc.call).probeCapabilities()).rejects.toBeInstanceOf(HistoryProtocolError)
  })
})
