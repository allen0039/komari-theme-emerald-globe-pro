export interface TrafficTrendRequestLease<T> {
  promise: Promise<T>
  release: () => void
}

interface ActiveTrafficTrendRequest<T> {
  controller: AbortController
  promise: Promise<T>
  consumers: number
}

export function createTrafficTrendRequestPool<T>() {
  const activeRequests = new Map<string, ActiveTrafficTrendRequest<T>>()

  function acquire(
    key: string,
    start: (signal: AbortSignal) => Promise<T>,
  ): TrafficTrendRequestLease<T> {
    let active = activeRequests.get(key)
    if (!active) {
      const controller = new AbortController()
      const promise = start(controller.signal)
      active = { controller, promise, consumers: 0 }
      activeRequests.set(key, active)
      void promise.then(
        () => {
          if (activeRequests.get(key) === active)
            activeRequests.delete(key)
        },
        () => {
          if (activeRequests.get(key) === active)
            activeRequests.delete(key)
        },
      )
    }

    active.consumers += 1
    let released = false
    return {
      promise: active.promise,
      release: () => {
        if (released)
          return

        released = true
        active!.consumers -= 1
        if (active!.consumers === 0 && activeRequests.get(key) === active) {
          activeRequests.delete(key)
          active!.controller.abort()
        }
      },
    }
  }

  return { acquire }
}
