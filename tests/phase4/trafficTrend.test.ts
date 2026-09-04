import type { DailyTrafficAggregate } from '../../src/utils/history/trafficAggregator'
import { afterEach, describe, expect, test } from 'bun:test'
import { buildTrafficTrendViewModel } from '../../src/features/resource-overview/trafficTrend'
import { aggregateTrafficTrendRequest } from '../../src/workers/trafficTrend.worker'
import {
  aggregateTrafficTrendFallback,
  aggregateTrafficTrendWithFallback,
} from '../../src/workers/trafficTrendFallback'
import {
  createTrafficTrendWorkerClient,
  TrafficTrendWorkerUnavailableError,
} from '../../src/workers/trafficTrendWorkerClient'
import { createTrafficTrendWorkerRunner } from '../../src/workers/trafficTrendWorkerRunner'

const originalWorker = globalThis.Worker

class FakeWorker {
  static instances: FakeWorker[] = []

  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly requests: unknown[] = []
  terminateCalls = 0

  constructor(_url: URL, _options: WorkerOptions) {
    FakeWorker.instances.push(this)
  }

  postMessage(request: unknown): void {
    this.requests.push(request)
  }

  terminate(): void {
    this.terminateCalls += 1
  }

  respond(response: unknown): void {
    this.onmessage?.({ data: response } as MessageEvent)
  }

  fail(): void {
    this.onerror?.({} as ErrorEvent)
  }
}

class ThrowingWorker {
  constructor(_url: URL, _options: WorkerOptions) {
    throw new Error('Workers are unavailable')
  }
}

class ThrowingPostMessageWorker extends FakeWorker {
  override postMessage(_request: unknown): void {
    throw new Error('The worker cannot accept messages')
  }
}

afterEach(() => {
  globalThis.Worker = originalWorker
  FakeWorker.instances = []
})

function day(overrides: Partial<DailyTrafficAggregate>): DailyTrafficAggregate {
  return {
    date: '2026-09-01',
    timeZone: 'Asia/Shanghai',
    startMs: 0,
    endMs: 1,
    durationMs: 1,
    effectiveEndMs: 1,
    effectiveDurationMs: 1,
    isInProgress: false,
    uploadBytes: 10,
    downloadBytes: 20,
    source: 'metric-delta',
    quality: 'complete',
    coverage: 1,
    firstRecordAtMs: 0,
    lastRecordAtMs: 1,
    maxGapMs: 0,
    resetCount: 0,
    reasons: [],
    ...overrides,
  }
}

function workerRequest(requestId: string) {
  return {
    requestId,
    result: { kind: 'metrics' as const, retentionDays: 30, series: [] },
    entityIds: ['a'],
    dates: ['2026-09-01'],
    timeZone: 'UTC',
    nowMs: Date.parse('2026-09-01T12:00:00Z'),
    window: {
      startMs: Date.parse('2026-09-01T00:00:00Z'),
      endMs: Date.parse('2026-09-02T00:00:00Z'),
    },
  }
}

async function settlement(promise: Promise<unknown>): Promise<'resolved' | 'rejected' | 'pending'> {
  return Promise.race([
    promise.then(() => 'resolved' as const, () => 'rejected' as const),
    new Promise<'pending'>(resolve => setTimeout(resolve, 10, 'pending')),
  ])
}

describe('traffic trend cross-node reducer', () => {
  test('worker aggregation returns one deterministic seven-day snapshot', () => {
    const response = aggregateTrafficTrendRequest(workerRequest('r1'))

    expect(response).toMatchObject({
      requestId: 'r1',
      snapshot: { state: 'empty', sourceKind: 'metrics', retentionDays: 30 },
    })
  })

  test('worker client rejects aborts and ignores a late response', async () => {
    globalThis.Worker = FakeWorker as unknown as typeof Worker
    const client = createTrafficTrendWorkerClient()
    const worker = FakeWorker.instances[0]!
    const controller = new AbortController()
    const request = client.aggregate(workerRequest('abort'), controller.signal)
    expect(worker.requests).toHaveLength(1)

    controller.abort()
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })

    worker.respond(aggregateTrafficTrendRequest(workerRequest('abort')))
    const next = client.aggregate(workerRequest('next'))
    worker.respond(aggregateTrafficTrendRequest(workerRequest('next')))
    await expect(next).resolves.toMatchObject({ sourceKind: 'metrics' })
    client.dispose()
  })

  test('worker client never reuses an aborted request ID for a late response', async () => {
    globalThis.Worker = FakeWorker as unknown as typeof Worker
    const client = createTrafficTrendWorkerClient()
    const worker = FakeWorker.instances[0]!
    const controller = new AbortController()
    const aborted = client.aggregate(workerRequest('same-id'), controller.signal)

    controller.abort()
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' })

    const reissued = client.aggregate(workerRequest('same-id'))
    worker.respond(aggregateTrafficTrendRequest(workerRequest('same-id')))

    await expect(reissued).rejects.toThrow('already been used')
    expect(worker.requests).toHaveLength(1)
    client.dispose()
  })

  test('worker client becomes unavailable after a worker error', async () => {
    globalThis.Worker = FakeWorker as unknown as typeof Worker
    const client = createTrafficTrendWorkerClient()
    const worker = FakeWorker.instances[0]!
    const pending = client.aggregate(workerRequest('worker-error'))

    worker.fail()
    await expect(pending).rejects.toThrow('failed')

    const afterFailure = client.aggregate(workerRequest('after-failure'))
    await expect(settlement(afterFailure)).resolves.toBe('rejected')
    expect(worker.requests).toHaveLength(1)
    expect(worker.terminateCalls).toBe(1)
    client.dispose()
  })

  test('falls back to segmented aggregation when worker construction fails', async () => {
    globalThis.Worker = ThrowingWorker as unknown as typeof Worker
    const request = workerRequest('worker-construction')

    const result = await aggregateTrafficTrendWithFallback(request, undefined, () => {
      return createTrafficTrendWorkerClient().aggregate(request)
    })

    expect(result).toMatchObject({ state: 'empty', sourceKind: 'metrics', retentionDays: 30 })
  })

  test('falls back to segmented aggregation after a worker runtime failure', async () => {
    globalThis.Worker = FakeWorker as unknown as typeof Worker
    const client = createTrafficTrendWorkerClient()
    const worker = FakeWorker.instances[0]!
    const request = workerRequest('worker-runtime')
    const result = aggregateTrafficTrendWithFallback(request, undefined, () => client.aggregate(request))

    worker.fail()

    await expect(result).resolves.toMatchObject({ state: 'empty', sourceKind: 'metrics' })
    client.dispose()
  })

  test('falls back to segmented aggregation when worker postMessage throws', async () => {
    globalThis.Worker = ThrowingPostMessageWorker as unknown as typeof Worker
    const client = createTrafficTrendWorkerClient()
    const request = workerRequest('worker-post-message')

    const result = await aggregateTrafficTrendWithFallback(request, undefined, () => {
      return client.aggregate(request)
    })

    expect(result).toMatchObject({ state: 'empty', sourceKind: 'metrics' })
    client.dispose()
  })

  test('reconstructs a discarded worker client before the next aggregation', async () => {
    let constructions = 0
    let firstDisposals = 0
    const recovered = aggregateTrafficTrendRequest(workerRequest('worker-recovered')).snapshot
    const runner = createTrafficTrendWorkerRunner(() => {
      constructions += 1
      if (constructions === 1) {
        return {
          aggregate: async () => {
            throw new TrafficTrendWorkerUnavailableError('Worker failed')
          },
          dispose: () => {
            firstDisposals += 1
          },
        }
      }
      return {
        aggregate: async () => recovered,
        dispose: () => {},
      }
    })

    const fallback = await runner.aggregate(workerRequest('worker-fallback'))
    const next = await runner.aggregate(workerRequest('worker-recovered'))

    expect(fallback).toMatchObject({ state: 'empty', sourceKind: 'metrics' })
    expect(next).toBe(recovered)
    expect(constructions).toBe(2)
    expect(firstDisposals).toBe(1)
    runner.dispose()
  })

  test('aborts segmented fallback while yielding between entities', async () => {
    const controller = new AbortController()
    const request = { ...workerRequest('fallback-abort'), entityIds: ['a', 'b'] }
    let yields = 0

    const result = aggregateTrafficTrendFallback(request, controller.signal, async () => {
      yields += 1
      controller.abort()
    })

    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(yields).toBe(1)
  })

  test('does not turn non-worker failures into fallback data', async () => {
    const request = workerRequest('request-error')
    const error = new Error('History request failed')

    const result = aggregateTrafficTrendWithFallback(request, undefined, async () => {
      throw error
    })

    await expect(result).rejects.toBe(error)
  })

  test('worker client terminates and rejects every pending request on dispose', async () => {
    globalThis.Worker = FakeWorker as unknown as typeof Worker
    const client = createTrafficTrendWorkerClient()
    const worker = FakeWorker.instances[0]!
    const request = client.aggregate(workerRequest('dispose'))

    client.dispose()

    await expect(request).rejects.toThrow('disposed')
    expect(worker.terminateCalls).toBe(1)
  })

  test('sums every available direction and preserves the weakest quality', () => {
    const result = buildTrafficTrendViewModel(new Map([
      ['a', [day({ uploadBytes: 10, downloadBytes: 20 })]],
      ['b', [day({ uploadBytes: 30, downloadBytes: null, quality: 'partial', coverage: 0.5 })]],
    ]), ['2026-09-01'], ['a', 'b'])

    expect(result.days[0]).toMatchObject({
      uploadBytes: 40,
      downloadBytes: 20,
      totalBytes: 60,
      quality: 'partial',
      coverage: {
        average: 0.75,
        minimum: 0.5,
        availableEntities: 2,
        totalEntities: 2,
      },
    })
  })

  test('keeps a true all-node zero distinct from missing data', () => {
    const zero = buildTrafficTrendViewModel(new Map([
      ['a', [day({ uploadBytes: 0, downloadBytes: 0 })]],
    ]), ['2026-09-01'], ['a'])
    const missing = buildTrafficTrendViewModel(new Map([
      ['a', [day({ uploadBytes: null, downloadBytes: null, quality: 'missing' })]],
    ]), ['2026-09-01'], ['a'])

    expect(zero.days[0]?.totalBytes).toBe(0)
    expect(missing.days[0]?.totalBytes).toBeNull()
  })

  test('summarizes every non-missing day as available data', () => {
    const result = buildTrafficTrendViewModel(new Map([
      ['a', [
        day({ date: '2026-09-01', quality: 'complete' }),
        day({ date: '2026-09-02', quality: 'partial', coverage: 0.5 }),
        day({ date: '2026-09-03', quality: 'estimated' }),
        day({ date: '2026-09-04', uploadBytes: null, downloadBytes: null, quality: 'missing' }),
      ]],
    ]), ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'], ['a'])

    expect(result.message).toBe('采集：3天，缺失：1天')
  })

  test('counts an absent entity as zero coverage and sorts reasons', () => {
    const result = buildTrafficTrendViewModel(new Map([
      ['a', [day({ reasons: ['no-data', 'counter-reset'], isInProgress: true })]],
      ['b', []],
    ]), ['2026-09-01'], ['a', 'b'])

    expect(result.days[0]).toMatchObject({
      uploadBytes: 10,
      downloadBytes: 20,
      totalBytes: 30,
      quality: 'partial',
      coverage: {
        average: 0.5,
        minimum: 1,
        availableEntities: 1,
        totalEntities: 2,
      },
      isInProgress: true,
      reasons: ['counter-reset', 'no-data'],
    })
  })

  test('preserves estimated quality and marks different sources as mixed', () => {
    const result = buildTrafficTrendViewModel(new Map([
      ['a', [day({ source: 'metric-delta', quality: 'partial', coverage: 0.8 })]],
      ['b', [day({ source: 'counter-diff', quality: 'estimated', coverage: 0.6 })]],
    ]), ['2026-09-01'], ['a', 'b'])

    expect(result.days[0]).toMatchObject({
      quality: 'estimated',
      source: 'mixed',
      coverage: {
        average: 0.7,
        minimum: 0.6,
        availableEntities: 2,
        totalEntities: 2,
      },
    })
  })

  test('reports all-missing coverage without treating zero traffic as missing', () => {
    const missing = buildTrafficTrendViewModel(new Map([
      ['a', [day({ uploadBytes: null, downloadBytes: null, quality: 'missing', coverage: 0 })]],
      ['b', []],
    ]), ['2026-09-01'], ['a', 'b'])
    const zero = buildTrafficTrendViewModel(new Map([
      ['a', [day({ uploadBytes: 0, downloadBytes: 0, coverage: 1 })]],
      ['b', [day({ uploadBytes: 0, downloadBytes: 0, coverage: 0.5 })]],
    ]), ['2026-09-01'], ['a', 'b'])

    expect(missing.days[0]).toMatchObject({
      quality: 'missing',
      coverage: { average: 0, minimum: null, availableEntities: 0, totalEntities: 2 },
    })
    expect(zero.days[0]).toMatchObject({
      totalBytes: 0,
      coverage: { average: 0.75, minimum: 0.5, availableEntities: 2, totalEntities: 2 },
    })
  })

  test('keeps worker and fallback coverage evidence identical', async () => {
    const request = { ...workerRequest('coverage-parity'), entityIds: ['a', 'b'] }
    const worker = aggregateTrafficTrendRequest(request).snapshot
    const fallback = await aggregateTrafficTrendFallback(request)

    expect(fallback.days).toEqual(worker.days)
  })
})
