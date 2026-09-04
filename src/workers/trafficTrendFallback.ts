import type { TrafficTrendWorkerRequest } from './trafficTrend.worker'
import type { TrafficTrendSnapshot } from '@/features/resource-overview/trafficTrend'
import type { TrafficHistoryResult } from '@/utils/history/gateway'
import { buildTrafficTrendViewModel } from '@/features/resource-overview/trafficTrend'
import { aggregateDailyTraffic } from '@/utils/history/trafficAggregator'
import { historyResultToTrafficEvidence } from '@/utils/history/trafficEvidence'
import { isTrafficTrendWorkerUnavailableError } from './trafficTrendWorkerClient'

export type TrafficTrendTaskYield = () => Promise<void>

function createAbortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw createAbortError()
}

function yieldToMainThread(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function selectEntityHistoryResult(
  result: TrafficHistoryResult,
  entityId: string,
): TrafficHistoryResult {
  if (result.kind === 'metrics') {
    return {
      ...result,
      series: result.series.filter(series => series.entityId === entityId),
    }
  }
  return {
    ...result,
    records: { [entityId]: result.records[entityId] ?? [] },
  }
}

export async function aggregateTrafficTrendFallback(
  request: TrafficTrendWorkerRequest,
  signal?: AbortSignal,
  yieldTask: TrafficTrendTaskYield = yieldToMainThread,
): Promise<TrafficTrendSnapshot> {
  throwIfAborted(signal)
  const entityIds = [...new Set(request.entityIds)].sort((left, right) => left.localeCompare(right))
  const byEntity = new Map<string, ReturnType<typeof aggregateDailyTraffic>>()

  for (const [index, entityId] of entityIds.entries()) {
    throwIfAborted(signal)
    const evidence = historyResultToTrafficEvidence(
      selectEntityHistoryResult(request.result, entityId),
      request.window,
    ).find(candidate => candidate.entityId === entityId)
    byEntity.set(entityId, aggregateDailyTraffic({
      timeZone: request.timeZone,
      dates: [...request.dates],
      nowMs: request.nowMs,
      deltas: evidence?.deltas,
      counters: evidence?.counters,
    }))
    if (index < entityIds.length - 1) {
      await yieldTask()
      throwIfAborted(signal)
    }
  }

  const viewModel = buildTrafficTrendViewModel(byEntity, request.dates, request.entityIds)
  return {
    ...viewModel,
    fetchedAt: request.nowMs,
    sourceKind: request.result.kind,
    retentionDays: request.result.kind === 'metrics' ? request.result.retentionDays : null,
    availability: 'available',
    failureKind: null,
    retryable: false,
  }
}

export async function aggregateTrafficTrendWithFallback(
  request: TrafficTrendWorkerRequest,
  signal: AbortSignal | undefined,
  aggregateInWorker: () => Promise<TrafficTrendSnapshot>,
): Promise<TrafficTrendSnapshot> {
  try {
    return await aggregateInWorker()
  }
  catch (error) {
    if (!isTrafficTrendWorkerUnavailableError(error))
      throw error
    return aggregateTrafficTrendFallback(request, signal)
  }
}
