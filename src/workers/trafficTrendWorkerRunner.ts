import type { TrafficTrendWorkerRequest } from './trafficTrend.worker'
import type { TrafficTrendWorkerClient } from './trafficTrendWorkerClient'
import type { TrafficTrendSnapshot } from '@/features/resource-overview/trafficTrend'
import { aggregateTrafficTrendWithFallback } from './trafficTrendFallback'
import { createTrafficTrendWorkerClient, isTrafficTrendWorkerUnavailableError } from './trafficTrendWorkerClient'

export interface TrafficTrendWorkerRunner {
  aggregate: (request: TrafficTrendWorkerRequest, signal?: AbortSignal) => Promise<TrafficTrendSnapshot>
  dispose: () => void
}

export function createTrafficTrendWorkerRunner(
  createClient: () => TrafficTrendWorkerClient = createTrafficTrendWorkerClient,
): TrafficTrendWorkerRunner {
  let client: TrafficTrendWorkerClient | null = null

  function getClient(): TrafficTrendWorkerClient {
    if (!client)
      client = createClient()
    return client
  }

  function discardClient(): void {
    client?.dispose()
    client = null
  }

  async function aggregate(
    request: TrafficTrendWorkerRequest,
    signal?: AbortSignal,
  ): Promise<TrafficTrendSnapshot> {
    return aggregateTrafficTrendWithFallback(request, signal, async () => {
      try {
        return await getClient().aggregate(request, signal)
      }
      catch (error) {
        if (isTrafficTrendWorkerUnavailableError(error))
          discardClient()
        throw error
      }
    })
  }

  return { aggregate, dispose: discardClient }
}
