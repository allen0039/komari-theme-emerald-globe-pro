import type { MaybeRefOrGetter } from 'vue'
import { useThrottleFn } from '@vueuse/core'
import { computed, onScopeDispose, ref, shallowRef, toValue, watch } from 'vue'
import { getSharedRpc } from '@/utils/rpc'

export interface NodePingHistoryPoint {
  time: string
  latency: number | null
  loss: number | null
}

export interface NodePingStatsState {
  avgLatency: number
  avgLoss: number
  avgVolatility: number
  history: NodePingHistoryPoint[]
  hasData: boolean
  perTaskStats: NodePingPerTaskStat[]
}

export interface NodePingCacheSnapshot {
  stats: NodePingStatsState
  updatedAt: number
  stale: boolean
}

export interface PingRecord {
  client: string
  task_id: number
  time: string
  value: number
}

interface SharedPingRecordsResponse {
  records?: PingRecord[]
  tasks?: PingTaskInfo[]
}

export interface PingTaskInfo {
  id: number
  name: string
}

interface SharedPingRecordsState {
  recordsByClient: Map<string, PingRecord[]>
  tasks: PingTaskInfo[]
}

interface SharedPingRecordsEntry {
  data: ReturnType<typeof shallowRef<SharedPingRecordsState | null>>
  loading: ReturnType<typeof ref<boolean>>
  error: ReturnType<typeof ref<string | null>>
  promise: Promise<void> | null
  refreshTimer: ReturnType<typeof setInterval> | null
  subscribers: number
  lastFetchedAt: number
}

export interface NodePingPerTaskStat {
  taskId: number
  name: string
  avgLatency: number
  loss: number
  history: NodePingHistoryPoint[]
}

export const NODE_PING_BAR_COUNT = 10
const CACHE_VERSION = 8
const CACHE_KEY_PREFIX = 'komari-theme-emerald-globe-pro:node-ping-stats'
const FULL_LOSS_EPSILON = 1e-6
const PING_RECORD_REFRESH_INTERVAL_MS = 60_000
const PING_CACHE_FRESH_MS = 5 * 60_000
const PING_CACHE_MAX_AGE_MS = 24 * 60 * 60_000
const sharedPingRecordsCache = new Map<number, SharedPingRecordsEntry>()
let sharedPingRecordsVisibilityListenerRegistered = false

function createEmptyStats(): NodePingStatsState {
  return {
    avgLatency: 0,
    avgLoss: 0,
    avgVolatility: 0,
    history: [],
    hasData: false,
    perTaskStats: [],
  }
}

function average(values: number[]): number {
  if (!values.length)
    return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function getIncludedTaskIds(records: PingRecord[]): Set<number> {
  return new Set(records.map(record => record.task_id))
}

function getCacheKey(uuid: string, hours: number): string {
  return `${CACHE_KEY_PREFIX}:${uuid}:${hours}`
}

function isValidHistoryPoint(value: unknown): value is NodePingHistoryPoint {
  if (!value || typeof value !== 'object')
    return false

  const point = value as Record<string, unknown>
  const latency = point.latency
  const loss = point.loss

  return typeof point.time === 'string'
    && (latency === null || typeof latency === 'number')
    && (loss === null || typeof loss === 'number')
}

function isValidStatsState(value: unknown): value is NodePingStatsState {
  if (!value || typeof value !== 'object')
    return false

  const state = value as Record<string, unknown>
  return typeof state.avgLatency === 'number'
    && typeof state.avgLoss === 'number'
    && typeof state.avgVolatility === 'number'
    && typeof state.hasData === 'boolean'
    && Array.isArray(state.history)
    && state.history.every(isValidHistoryPoint)
    && Array.isArray(state.perTaskStats)
    && state.perTaskStats.every((stat) => {
      if (!stat || typeof stat !== 'object')
        return false
      const task = stat as Record<string, unknown>
      return typeof task.taskId === 'number'
        && typeof task.name === 'string'
        && typeof task.avgLatency === 'number'
        && typeof task.loss === 'number'
        && Array.isArray(task.history)
        && task.history.every(isValidHistoryPoint)
    })
}

export function parseNodePingStatsCache(raw: string | null, nowMs: number): NodePingCacheSnapshot | null {
  if (!raw)
    return null

  try {
    const parsed = JSON.parse(raw) as { version?: number, updatedAt?: number, stats?: unknown }
    if (parsed.version !== CACHE_VERSION || !Number.isFinite(parsed.updatedAt) || !isValidStatsState(parsed.stats))
      return null

    const updatedAt = parsed.updatedAt!
    const age = Math.max(0, nowMs - updatedAt)
    if (age > PING_CACHE_MAX_AGE_MS)
      return null

    return { stats: parsed.stats, updatedAt, stale: age > PING_CACHE_FRESH_MS }
  }
  catch {
    return null
  }
}

export function shouldShowCachedPingFallback(snapshot: NodePingCacheSnapshot | null): boolean {
  return snapshot?.stale ?? false
}

export function getPersistableNodePingStats(sharedStats: NodePingStatsState | null): NodePingStatsState | null {
  return sharedStats?.hasData ? sharedStats : null
}

export function shouldRefreshPingRecords(lastFetchedAt: number, nowMs: number, visible: boolean): boolean {
  return visible && (lastFetchedAt === 0 || nowMs - lastFetchedAt >= PING_RECORD_REFRESH_INTERVAL_MS)
}

function readStatsCache(uuid: string, hours: number): NodePingCacheSnapshot | null {
  if (typeof window === 'undefined')
    return null

  try {
    const raw = window.localStorage.getItem(getCacheKey(uuid, hours))
    return parseNodePingStatsCache(raw, Date.now())
  }
  catch {
    return null
  }
}

function writeStatsCache(uuid: string, hours: number, value: NodePingStatsState): void {
  if (typeof window === 'undefined')
    return

  try {
    window.localStorage.setItem(
      getCacheKey(uuid, hours),
      JSON.stringify({
        version: CACHE_VERSION,
        updatedAt: Date.now(),
        stats: value,
      }),
    )
  }
  catch {
  }
}

function createSharedPingRecordsEntry(): SharedPingRecordsEntry {
  return {
    data: shallowRef<SharedPingRecordsState | null>(null),
    loading: ref(false),
    error: ref<string | null>(null),
    promise: null,
    refreshTimer: null,
    subscribers: 0,
    lastFetchedAt: 0,
  }
}

function getSharedPingRecordsEntry(hours: number): SharedPingRecordsEntry {
  const cachedEntry = sharedPingRecordsCache.get(hours)
  if (cachedEntry)
    return cachedEntry

  const nextEntry = createSharedPingRecordsEntry()
  sharedPingRecordsCache.set(hours, nextEntry)
  return nextEntry
}

function buildRecordsByClient(records: PingRecord[]): Map<string, PingRecord[]> {
  const grouped = new Map<string, PingRecord[]>()

  for (const record of records) {
    if (!record.client)
      continue

    const clientRecords = grouped.get(record.client) ?? []
    clientRecords.push(record)
    grouped.set(record.client, clientRecords)
  }

  for (const clientRecords of grouped.values()) {
    clientRecords.sort(
      (left, right) => new Date(left.time).getTime() - new Date(right.time).getTime(),
    )
  }

  return grouped
}

async function loadSharedPingRecords(entry: SharedPingRecordsEntry, hours: number): Promise<void> {
  if (entry.promise)
    return entry.promise

  const rpc = getSharedRpc()
  entry.loading.value = true
  entry.error.value = null

  entry.promise = (async () => {
    try {
      const result = await rpc.getClient().call<SharedPingRecordsResponse>('common:getRecords', {
        type: 'ping',
        // 新版 getRecords 可能只返回近期可用样本，hours 仅作为服务端查询窗口。
        hours,
      })

      entry.data.value = {
        recordsByClient: buildRecordsByClient(result?.records ?? []),
        tasks: result?.tasks ?? [],
      }
      entry.lastFetchedAt = Date.now()
    }
    catch (err) {
      entry.error.value = err instanceof Error ? err.message : '获取 Ping 历史失败'
      throw err
    }
    finally {
      entry.loading.value = false
      entry.promise = null
    }
  })()

  return entry.promise
}

function startSharedPingRecordsRefresh(entry: SharedPingRecordsEntry, hours: number): void {
  if (entry.refreshTimer)
    return

  entry.refreshTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible')
      return

    if (!shouldRefreshPingRecords(entry.lastFetchedAt, Date.now(), true))
      return

    void loadSharedPingRecords(entry, hours).catch(() => {})
  }, PING_RECORD_REFRESH_INTERVAL_MS)
}

function stopSharedPingRecordsRefresh(entry: SharedPingRecordsEntry): void {
  if (!entry.refreshTimer)
    return

  clearInterval(entry.refreshTimer)
  entry.refreshTimer = null
}

function hasSharedPingRecordsSubscribers(): boolean {
  return Array.from(sharedPingRecordsCache.values()).some(entry => entry.subscribers > 0)
}

function refreshVisibleSharedPingRecords(): void {
  if (document.visibilityState !== 'visible')
    return

  const nowMs = Date.now()
  for (const [hours, entry] of sharedPingRecordsCache) {
    if (entry.subscribers > 0 && shouldRefreshPingRecords(entry.lastFetchedAt, nowMs, true))
      void loadSharedPingRecords(entry, hours).catch(() => {})
  }
}

function startSharedPingRecordsVisibilityListener(): void {
  if (sharedPingRecordsVisibilityListenerRegistered || typeof document === 'undefined')
    return

  document.addEventListener('visibilitychange', refreshVisibleSharedPingRecords)
  sharedPingRecordsVisibilityListenerRegistered = true
}

function stopSharedPingRecordsVisibilityListener(): void {
  if (!sharedPingRecordsVisibilityListenerRegistered || typeof document === 'undefined')
    return

  document.removeEventListener('visibilitychange', refreshVisibleSharedPingRecords)
  sharedPingRecordsVisibilityListenerRegistered = false
}

function retainSharedPingRecordsEntry(hours: number): () => void {
  const entry = getSharedPingRecordsEntry(hours)
  entry.subscribers += 1
  startSharedPingRecordsVisibilityListener()
  startSharedPingRecordsRefresh(entry, hours)

  let released = false
  return () => {
    if (released)
      return

    released = true
    entry.subscribers = Math.max(0, entry.subscribers - 1)
    if (entry.subscribers === 0)
      stopSharedPingRecordsRefresh(entry)
    if (!hasSharedPingRecordsSubscribers())
      stopSharedPingRecordsVisibilityListener()
  }
}

function buildPingHistory(records: PingRecord[]): NodePingHistoryPoint[] {
  const sortedRecords = records
    .map((record) => {
      const timestamp = new Date(record.time).getTime()
      return { ...record, timestamp }
    })
    .filter(record => Number.isFinite(record.timestamp))
    .sort((left, right) => left.timestamp - right.timestamp)

  if (!sortedRecords.length)
    return []

  const firstTime = sortedRecords[0]?.timestamp ?? 0
  const lastTime = sortedRecords.at(-1)?.timestamp ?? firstTime
  const bucketCount = Math.min(NODE_PING_BAR_COUNT, sortedRecords.length)
  const bucketSize = Math.max(1, (lastTime - firstTime) / bucketCount)

  return Array.from({ length: bucketCount }, (_, index) => {
    const startTime = firstTime + bucketSize * index
    const endTime = index === bucketCount - 1 ? lastTime + 1 : startTime + bucketSize
    const bucketRecords = sortedRecords.filter(
      record => record.timestamp >= startTime && record.timestamp < endTime,
    )
    const validLatencyRecords = bucketRecords.filter(record => record.value >= 0)
    const lostCount = bucketRecords.length - validLatencyRecords.length
    const latency = validLatencyRecords.length
      ? average(validLatencyRecords.map(record => record.value))
      : null
    const loss = bucketRecords.length
      ? lostCount / bucketRecords.length * 100
      : null

    return {
      time: new Date(startTime).toISOString(),
      latency,
      loss,
    }
  })
}

function getPercentile(values: number[], percentile: number): number | null {
  if (!values.length)
    return null

  const sorted = [...values].sort((left, right) => left - right)
  const position = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * percentile))
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  const lowerValue = sorted[lowerIndex]
  const upperValue = sorted[upperIndex]

  if (lowerValue === undefined || upperValue === undefined)
    return null
  if (lowerIndex === upperIndex)
    return lowerValue

  return lowerValue + (upperValue - lowerValue) * (position - lowerIndex)
}

export function buildNodePingStats(records: PingRecord[], tasks: PingTaskInfo[]): NodePingStatsState {
  const includedTaskIds = getIncludedTaskIds(records)

  if (!includedTaskIds.size)
    return createEmptyStats()

  const filteredRecords = records.filter(record => includedTaskIds.has(record.task_id))
  const history = buildPingHistory(filteredRecords)
  const taskRecords = new Map<number, PingRecord[]>()

  for (const record of filteredRecords) {
    const currentRecords = taskRecords.get(record.task_id) ?? []
    currentRecords.push(record)
    taskRecords.set(record.task_id, currentRecords)
  }

  const latencyValues: number[] = []
  const taskLossValues: number[] = []
  const volatilityValues: number[] = []

  for (const recordsByTask of taskRecords.values()) {
    const validValues = recordsByTask
      .map(record => record.value)
      .filter(value => value >= 0)

    taskLossValues.push((recordsByTask.length - validValues.length) / recordsByTask.length * 100)

    if (!validValues.length)
      continue

    latencyValues.push(average(validValues))

    if (validValues.length > 1) {
      const p50 = getPercentile(validValues, 0.5)
      const p99 = getPercentile(validValues, 0.99)
      if (isFiniteNumber(p50) && isFiniteNumber(p99) && p50 > FULL_LOSS_EPSILON) {
        volatilityValues.push(p99 / p50)
      }
    }
  }

  const historyLatencyValues = history
    .map(point => point.latency)
    .filter(isFiniteNumber)
  const historyLossValues = history
    .map(point => point.loss)
    .filter(isFiniteNumber)

  const avgLatency = latencyValues.length
    ? average(latencyValues)
    : historyLatencyValues.length ? average(historyLatencyValues) : -1
  const avgLoss = taskLossValues.length ? average(taskLossValues) : average(historyLossValues)
  const avgVolatility = average(volatilityValues)
  const hasData = history.length > 0 || latencyValues.length > 0 || taskLossValues.length > 0

  const taskOrderMap = new Map(tasks.map((t, index) => [t.id, index]))
  const taskNameMap = new Map(tasks.map(t => [t.id, t.name]))
  const perTaskStats: NodePingPerTaskStat[] = Array.from(taskRecords.entries(), ([taskId, taskRecs]) => {
    const validValues = taskRecs.map(r => r.value).filter(v => v >= 0)
    const avgLatency = validValues.length ? average(validValues) : -1
    const loss = taskRecs.length
      ? (taskRecs.length - validValues.length) / taskRecs.length * 100
      : 100
    const name = taskNameMap.get(taskId) ?? `Ping ${taskId}`
    return { taskId, name, avgLatency, loss, history: buildPingHistory(taskRecs) }
  })
    .sort((a, b) => (taskOrderMap.get(a.taskId) ?? 0) - (taskOrderMap.get(b.taskId) ?? 0))

  return {
    avgLatency,
    avgLoss,
    avgVolatility,
    history,
    hasData,
    perTaskStats,
  }
}

export function useNodePingStats(
  uuid: MaybeRefOrGetter<string>,
  options?: {
    hours?: MaybeRefOrGetter<number>
    enabled?: MaybeRefOrGetter<boolean>
  },
) {
  const loading = ref(false)
  const error = ref<string | null>(null)

  const resolved = computed(() => ({
    uuid: toValue(uuid),
    hours: Math.max(1, Math.floor(toValue(options?.hours) ?? 24)),
    enabled: toValue(options?.enabled) ?? true,
  }))

  let activeHours: number | null = null
  let releaseSharedRecords: (() => void) | null = null

  function syncSharedRecordsSubscription(hours: number | null): void {
    if (activeHours === hours)
      return

    releaseSharedRecords?.()
    releaseSharedRecords = null
    activeHours = null

    if (hours === null)
      return

    releaseSharedRecords = retainSharedPingRecordsEntry(hours)
    activeHours = hours
  }

  onScopeDispose(() => {
    syncSharedRecordsSubscription(null)
  })

  // stats 由共享 getRecords 的近期样本派生，不将结果视为完整的 hours 时段数据。
  const cacheSnapshot = computed<NodePingCacheSnapshot | null>(() => {
    const { uuid: nodeUuid, hours, enabled } = resolved.value
    if (!enabled || !nodeUuid.trim())
      return null

    // 通过 getSharedPingRecordsEntry 读取（不存在则创建），确保 computed 始终对
    // entry.data 这个 shallowRef 建立响应式依赖——即便首次加载尚未返回。
    const entry = getSharedPingRecordsEntry(hours)
    if (entry.data.value)
      return null

    return readStatsCache(nodeUuid, hours)
  })

  const sharedStats = computed<NodePingStatsState | null>(() => {
    const { uuid: nodeUuid, hours, enabled } = resolved.value
    if (!enabled || !nodeUuid.trim())
      return null

    const state = getSharedPingRecordsEntry(hours).data.value
    if (!state)
      return null

    const records = state.recordsByClient.get(nodeUuid) ?? []
    return records.length ? buildNodePingStats(records, state.tasks) : createEmptyStats()
  })

  const stats = computed<NodePingStatsState>(() => sharedStats.value ?? cacheSnapshot.value?.stats ?? createEmptyStats())

  // 副作用：按需触发首次共享加载并维护 loading/error，不再命令式写入 stats。
  watch(
    resolved,
    async (next, _previous, onCleanup) => {
      let cancelled = false
      onCleanup(() => {
        cancelled = true
      })

      const { uuid: nodeUuid, hours, enabled } = next
      if (!enabled || !nodeUuid.trim()) {
        syncSharedRecordsSubscription(null)
        loading.value = false
        error.value = null
        return
      }

      syncSharedRecordsSubscription(hours)
      const entry = getSharedPingRecordsEntry(hours)
      const shouldLoadRecords = !entry.data.value
        || Date.now() - entry.lastFetchedAt >= PING_RECORD_REFRESH_INTERVAL_MS

      if (!shouldLoadRecords) {
        loading.value = false
        error.value = null
        return
      }

      const shouldShowLoading = !entry.data.value
      loading.value = shouldShowLoading
      error.value = null

      try {
        await loadSharedPingRecords(entry, hours)
      }
      catch (err) {
        if (!cancelled && shouldShowLoading)
          error.value = err instanceof Error ? err.message : '获取 Ping 历史失败'
      }
      finally {
        if (!cancelled)
          loading.value = false
      }
    },
    { immediate: true },
  )

  const perTaskStats = computed<NodePingPerTaskStat[]>(() => stats.value.perTaskStats)
  const isCached = computed(() => shouldShowCachedPingFallback(cacheSnapshot.value))
  const cachedAt = computed(() => cacheSnapshot.value ? new Date(cacheSnapshot.value.updatedAt).toISOString() : undefined)

  // 共享记录会定时刷新，节流回写 localStorage，避免多节点同时重算时密集写盘。
  const persistStats = useThrottleFn(
    (nodeUuid: string, hours: number, value: NodePingStatsState) => {
      writeStatsCache(nodeUuid, hours, value)
    },
    PING_RECORD_REFRESH_INTERVAL_MS,
    true,
    true,
  )

  watch(sharedStats, (value) => {
    const persistableStats = getPersistableNodePingStats(value)
    if (!persistableStats)
      return
    const { uuid: nodeUuid, hours, enabled } = resolved.value
    if (enabled && nodeUuid.trim())
      persistStats(nodeUuid, hours, persistableStats)
  })

  return {
    stats,
    loading,
    error,
    history: computed(() => stats.value.history),
    avgLatency: computed(() => stats.value.avgLatency),
    avgLoss: computed(() => stats.value.avgLoss),
    avgVolatility: computed(() => stats.value.avgVolatility),
    hasData: computed(() => stats.value.hasData),
    perTaskStats,
    isCached,
    cachedAt,
  }
}
