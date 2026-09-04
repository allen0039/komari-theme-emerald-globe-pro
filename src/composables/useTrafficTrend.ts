import type { MaybeRefOrGetter } from 'vue'
import type { TrafficTrendSnapshot } from '@/features/resource-overview/trafficTrend'
import type { TrafficTrendCacheStorage } from '@/features/resource-overview/trafficTrendCache'
import { computed, onScopeDispose, shallowRef, toValue, watch } from 'vue'
import {
  resolveConfiguredTrafficTrendAvailability,
  resolveMetricTrafficTrendAvailability,
} from '@/features/resource-overview/trafficTrendAvailability'
import {
  buildTrafficTrendCacheKey,
  readTrafficTrendCache,
  writeTrafficTrendCache,
} from '@/features/resource-overview/trafficTrendCache'
import { createTrafficTrendRequestPool } from '@/features/resource-overview/trafficTrendRequestPool'
import { useAppStore } from '@/stores/app'
import { classifyHistoryFailure } from '@/utils/history/errorPolicy'
import { createHistoryGateway } from '@/utils/history/gateway'
import { buildRecentNaturalDayKeys, buildZonedDayWindow, resolveAnalyticsTimeZone } from '@/utils/history/trafficAggregator'
import { getSharedRpc } from '@/utils/rpc'
import { createTrafficTrendWorkerRunner } from '@/workers/trafficTrendWorkerRunner'

const TRAFFIC_TREND_CACHE_SCHEMA = 8
export const TRAFFIC_TREND_DAY_COUNT = 5
const TRAFFIC_TREND_MAX_POINTS_PER_DAY = 48
const TRAFFIC_TREND_MAX_POINTS = TRAFFIC_TREND_DAY_COUNT * TRAFFIC_TREND_MAX_POINTS_PER_DAY
const MANUAL_REFRESH_COOLDOWN_MS = 30_000

interface TrafficTrendContext {
  key: string
  entityIds: string[]
  dates: string[]
  timeZone: string
  nowMs: number
  window: { startMs: number, endMs: number }
}

export interface UseTrafficTrendOptions {
  entityIds: MaybeRefOrGetter<readonly string[]>
  enabled?: MaybeRefOrGetter<boolean>
}

const trafficTrendRequestPool = createTrafficTrendRequestPool<TrafficTrendSnapshot>()
const trafficTrendWorkerRunner = createTrafficTrendWorkerRunner()
let requestSequence = 0

function createSnapshot(
  state: TrafficTrendSnapshot['state'],
  message: string,
): TrafficTrendSnapshot {
  return {
    state,
    days: [],
    fetchedAt: null,
    sourceKind: null,
    retentionDays: null,
    availability: 'available',
    failureKind: null,
    retryable: false,
    message,
  }
}

function normalizeEntityIds(entityIds: readonly string[]): string[] {
  return [...new Set(entityIds.map(entityId => entityId.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
}

function getSessionStorage(): TrafficTrendCacheStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  }
  catch {
    return null
  }
}

function getOrigin(): string {
  return globalThis.location?.origin ?? 'http://localhost'
}

function createContext(
  entityIds: readonly string[],
  configuredTimeZone: string,
  loggedIn: boolean,
): TrafficTrendContext | null {
  const normalizedEntityIds = normalizeEntityIds(entityIds)
  if (normalizedEntityIds.length === 0)
    return null

  const nowMs = Date.now()
  const timeZone = resolveAnalyticsTimeZone(configuredTimeZone)
  const dates = buildRecentNaturalDayKeys(TRAFFIC_TREND_DAY_COUNT, timeZone, nowMs)
  const firstWindow = buildZonedDayWindow(dates[0]!, timeZone, nowMs)
  const lastWindow = buildZonedDayWindow(dates.at(-1)!, timeZone, nowMs)
  const key = buildTrafficTrendCacheKey({
    origin: getOrigin(),
    loggedIn,
    entityIds: normalizedEntityIds,
    timeZone,
    dates,
    schema: TRAFFIC_TREND_CACHE_SCHEMA,
  })

  return {
    key,
    entityIds: normalizedEntityIds,
    dates,
    timeZone,
    nowMs,
    window: { startMs: firstWindow.startMs, endMs: lastWindow.effectiveEndMs },
  }
}

function acquireTrafficTrendLoad(context: TrafficTrendContext): {
  promise: Promise<TrafficTrendSnapshot>
  release: () => void
} {
  return trafficTrendRequestPool.acquire(context.key, (signal) => {
    const requestId = `traffic-trend-${++requestSequence}`
    const rpcClient = getSharedRpc().getClient()
    const gateway = createHistoryGateway(rpcClient.call.bind(rpcClient))
    return gateway.queryTraffic({
      entityIds: context.entityIds,
      start: new Date(context.window.startMs).toISOString(),
      end: new Date(context.window.endMs).toISOString(),
      maxPoints: TRAFFIC_TREND_MAX_POINTS,
      signal,
    }).then(async (result) => {
      const request = {
        requestId,
        result,
        entityIds: context.entityIds,
        dates: context.dates,
        timeZone: context.timeZone,
        nowMs: context.nowMs,
        window: context.window,
      }
      return trafficTrendWorkerRunner.aggregate(request, signal)
    })
  })
}

export function useTrafficTrend(options: UseTrafficTrendOptions) {
  const appStore = useAppStore()
  const snapshot = shallowRef<TrafficTrendSnapshot>(createSnapshot('idle', '等待资源概况启用历史趋势'))
  const refreshing = shallowRef(false)
  const loading = computed(() => snapshot.value.state === 'loading')
  const resolved = computed(() => ({
    enabled: toValue(options.enabled) ?? true,
    entityIds: toValue(options.entityIds),
    timeZone: appStore.analyticsTimeZone,
    loggedIn: appStore.isLoggedIn,
    recordEnabled: appStore.publicSettings?.record_enabled,
    recordPreserveHours: appStore.publicSettings?.record_preserve_time,
  }))
  let activeRelease: (() => void) | null = null
  let runId = 0
  let lastManualRefreshAt = 0
  let disposed = false
  let stopWatcher: (() => void) | null = null

  async function load(forceRefresh: boolean): Promise<void> {
    if (disposed)
      return

    const currentRunId = ++runId
    activeRelease?.()
    activeRelease = null

    const current = resolved.value
    if (!current.enabled) {
      snapshot.value = createSnapshot('idle', '等待资源概况启用历史趋势')
      refreshing.value = false
      return
    }

    let context: TrafficTrendContext | null
    try {
      context = createContext(current.entityIds, current.timeZone, current.loggedIn)
    }
    catch {
      context = null
    }
    if (!context) {
      snapshot.value = createSnapshot('idle', '暂无可见探针可查询历史流量')
      refreshing.value = false
      return
    }

    const availability = resolveConfiguredTrafficTrendAvailability({
      recordEnabled: current.recordEnabled,
      recordPreserveHours: current.recordPreserveHours,
      window: context.window,
    })
    if (availability === 'recording-disabled') {
      snapshot.value = createSnapshot('empty', '服务端未开启历史流量记录')
      snapshot.value.availability = availability
      refreshing.value = false
      return
    }

    const storage = getSessionStorage()
    if (!forceRefresh && storage) {
      const cached = readTrafficTrendCache(storage, context.key)
      if (cached) {
        snapshot.value = cached
        refreshing.value = false
        return
      }
    }

    const hadData = snapshot.value.days.length > 0
    snapshot.value = hadData
      ? { ...snapshot.value, state: 'loading', availability, message: '正在更新 5 日流量趋势' }
      : { ...createSnapshot('loading', '正在读取 5 日流量趋势'), availability }
    refreshing.value = forceRefresh

    const active = acquireTrafficTrendLoad(context)
    activeRelease = active.release
    try {
      const result = await active.promise
      if (currentRunId !== runId)
        return

      snapshot.value = {
        ...result,
        availability: result.sourceKind === 'metrics'
          ? resolveMetricTrafficTrendAvailability({
              recordEnabled: current.recordEnabled,
              retentionDays: result.retentionDays,
              window: context.window,
            })
          : availability,
      }
      if (storage && (result.state === 'ready' || result.state === 'empty'))
        writeTrafficTrendCache(storage, context.key, snapshot.value)
    }
    catch (error) {
      const policy = classifyHistoryFailure(error)
      if (currentRunId !== runId || policy.kind === 'aborted')
        return
      snapshot.value = {
        ...createSnapshot(policy.kind === 'unsupported' ? 'unsupported' : 'error', policy.message),
        availability,
        failureKind: policy.kind,
        retryable: policy.retryable,
      }
    }
    finally {
      active.release()
      if (currentRunId === runId)
        refreshing.value = false
      if (activeRelease === active.release)
        activeRelease = null
    }
  }

  function refresh(): Promise<void> {
    if (disposed)
      return Promise.resolve()

    const nowMs = Date.now()
    if (nowMs - lastManualRefreshAt < MANUAL_REFRESH_COOLDOWN_MS)
      return Promise.resolve()
    lastManualRefreshAt = nowMs
    return load(true)
  }

  function dispose(): void {
    if (disposed)
      return

    disposed = true
    stopWatcher?.()
    stopWatcher = null
    runId += 1
    activeRelease?.()
    activeRelease = null
  }

  stopWatcher = watch(resolved, () => {
    void load(false)
  }, { immediate: true })

  onScopeDispose(dispose)

  return {
    snapshot,
    loading,
    refreshing,
    refresh,
    dispose,
  }
}
