import type {
  TrafficTrendWorkerRequest,
  TrafficTrendWorkerResponse,
} from './trafficTrend.worker'
import type { TrafficTrendSnapshot } from '@/features/resource-overview/trafficTrend'

interface PendingRequest {
  resolve: (snapshot: TrafficTrendSnapshot) => void
  reject: (error: unknown) => void
  signal?: AbortSignal
  onAbort?: () => void
}

export interface TrafficTrendWorkerClient {
  aggregate: (request: TrafficTrendWorkerRequest, signal?: AbortSignal) => Promise<TrafficTrendSnapshot>
  dispose: () => void
}

export class TrafficTrendWorkerUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TrafficTrendWorkerUnavailableError'
  }
}

export function isTrafficTrendWorkerUnavailableError(
  error: unknown,
): error is TrafficTrendWorkerUnavailableError {
  return error instanceof TrafficTrendWorkerUnavailableError
}

function createAbortError(message = 'Aborted'): DOMException {
  return new DOMException(message, 'AbortError')
}

export function createTrafficTrendWorkerClient(): TrafficTrendWorkerClient {
  let worker: Worker
  try {
    worker = new Worker(new URL('./trafficTrend.worker.ts', import.meta.url), { type: 'module' })
  }
  catch {
    throw new TrafficTrendWorkerUnavailableError('Traffic trend worker is unavailable')
  }
  const pending = new Map<string, PendingRequest>()
  const usedRequestIds = new Set<string>()
  let disposed = false
  let workerError: Error | null = null

  function clearPending(requestId: string): PendingRequest | undefined {
    const entry = pending.get(requestId)
    if (!entry)
      return undefined

    pending.delete(requestId)
    entry.signal?.removeEventListener('abort', entry.onAbort!)
    return entry
  }

  function rejectAll(error: unknown): void {
    for (const requestId of [...pending.keys()])
      clearPending(requestId)?.reject(error)
  }

  function failWorker(error: Error): void {
    if (disposed || workerError)
      return

    workerError = error
    disposed = true
    worker.terminate()
    rejectAll(error)
  }

  worker.onmessage = (event: MessageEvent<TrafficTrendWorkerResponse>) => {
    const response = event.data
    const entry = clearPending(response.requestId)
    if (!entry)
      return

    if ('error' in response) {
      entry.reject(new Error(response.error))
      return
    }
    entry.resolve(response.snapshot)
  }
  worker.onerror = () => {
    failWorker(new TrafficTrendWorkerUnavailableError('Traffic trend worker failed'))
  }

  function aggregate(
    request: TrafficTrendWorkerRequest,
    signal?: AbortSignal,
  ): Promise<TrafficTrendSnapshot> {
    if (workerError)
      return Promise.reject(workerError)
    if (disposed)
      return Promise.reject(new Error('Traffic trend worker client has been disposed'))
    if (usedRequestIds.has(request.requestId))
      return Promise.reject(new Error(`Traffic trend request ${request.requestId} has already been used`))
    if (signal?.aborted)
      return Promise.reject(createAbortError())

    usedRequestIds.add(request.requestId)

    return new Promise<TrafficTrendSnapshot>((resolve, reject) => {
      const onAbort = () => {
        const entry = clearPending(request.requestId)
        entry?.reject(createAbortError())
      }
      pending.set(request.requestId, { resolve, reject, signal, onAbort })
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        worker.postMessage(request)
      }
      catch (error) {
        clearPending(request.requestId)?.reject(
          new TrafficTrendWorkerUnavailableError(
            error instanceof Error ? error.message : 'Traffic trend worker is unavailable',
          ),
        )
      }
    })
  }

  function dispose(): void {
    if (disposed)
      return

    disposed = true
    worker.terminate()
    rejectAll(new Error('Traffic trend worker client has been disposed'))
  }

  return { aggregate, dispose }
}
