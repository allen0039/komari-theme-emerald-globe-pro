import type { TrafficTrendSnapshot } from '@/features/resource-overview/trafficTrend'
import type { TrafficHistoryResult } from '@/utils/history/gateway'
import type { AnalyticsTimeZone } from '@/utils/history/trafficAggregator'
import type { TrafficEvidenceWindow } from '@/utils/history/trafficEvidence'
import { buildTrafficTrendViewModel } from '@/features/resource-overview/trafficTrend'
import { aggregateDailyTraffic } from '@/utils/history/trafficAggregator'
import { historyResultToTrafficEvidence } from '@/utils/history/trafficEvidence'

export interface TrafficTrendWorkerRequest {
  requestId: string
  result: TrafficHistoryResult
  entityIds: readonly string[]
  dates: readonly string[]
  timeZone: AnalyticsTimeZone
  nowMs: number
  window: TrafficEvidenceWindow
}

export interface TrafficTrendWorkerSuccessResponse {
  requestId: string
  snapshot: TrafficTrendSnapshot
}

export interface TrafficTrendWorkerErrorResponse {
  requestId: string
  error: string
}

export type TrafficTrendWorkerResponse = TrafficTrendWorkerSuccessResponse | TrafficTrendWorkerErrorResponse

export function aggregateTrafficTrendRequest(
  request: TrafficTrendWorkerRequest,
): TrafficTrendWorkerSuccessResponse {
  const evidenceByEntityId = new Map(
    historyResultToTrafficEvidence(request.result, request.window)
      .map(evidence => [evidence.entityId, evidence] as const),
  )
  const byEntity = new Map(
    [...new Set(request.entityIds)]
      .sort((left, right) => left.localeCompare(right))
      .map((entityId) => {
        const evidence = evidenceByEntityId.get(entityId)
        return [entityId, aggregateDailyTraffic({
          timeZone: request.timeZone,
          dates: [...request.dates],
          nowMs: request.nowMs,
          deltas: evidence?.deltas,
          counters: evidence?.counters,
        })] as const
      }),
  )
  const viewModel = buildTrafficTrendViewModel(byEntity, request.dates, request.entityIds)

  return {
    requestId: request.requestId,
    snapshot: {
      ...viewModel,
      fetchedAt: request.nowMs,
      sourceKind: request.result.kind,
      retentionDays: request.result.kind === 'metrics' ? request.result.retentionDays : null,
      availability: 'available',
      failureKind: null,
      retryable: false,
    },
  }
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<TrafficTrendWorkerRequest>) => void) | null
  postMessage: (message: TrafficTrendWorkerResponse) => void
}

interface WorkerGlobalScopeConstructor {
  new (): object
}

const workerScope = globalThis as unknown as WorkerScope
const workerGlobalScope = (globalThis as typeof globalThis & {
  WorkerGlobalScope?: WorkerGlobalScopeConstructor
}).WorkerGlobalScope

if (typeof workerGlobalScope !== 'undefined' && globalThis instanceof workerGlobalScope) {
  workerScope.onmessage = (event) => {
    try {
      workerScope.postMessage(aggregateTrafficTrendRequest(event.data))
    }
    catch (error) {
      workerScope.postMessage({
        requestId: event.data.requestId,
        error: error instanceof Error ? error.message : 'Traffic trend aggregation failed',
      })
    }
  }
}
