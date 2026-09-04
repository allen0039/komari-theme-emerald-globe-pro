import type {
  TrafficTrendCoverageViewModel,
  TrafficTrendDayViewModel,
  TrafficTrendSnapshot,
} from './trafficTrend'
import type { TrafficTrendAvailability } from './trafficTrendAvailability'
import type { HistoryFailureKind } from '@/utils/history/errorPolicy'

export const TRAFFIC_TREND_CACHE_TTL_MS = 15 * 60_000

const CACHE_PREFIX = 'komari-theme-emerald-globe-pro:traffic-trend:'

export interface TrafficTrendCacheKeyInput {
  origin: string
  loggedIn: boolean
  entityIds: readonly string[]
  timeZone: string
  dates: readonly string[]
  schema: number
}

export interface TrafficTrendCacheStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

interface TrafficTrendCacheEntry {
  snapshot: TrafficTrendSnapshot
  cachedAt: number
}

function normalizeEntityIds(entityIds: readonly string[]): string[] {
  return [...new Set(entityIds.map(entityId => entityId.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
}

function fnv1a32(value: string): string {
  let hash = 0x811C9DC5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteTimestamp(value)
}

function isTrafficTrendCoverage(value: unknown): value is TrafficTrendCoverageViewModel {
  if (!value || typeof value !== 'object')
    return false

  const coverage = value as Partial<TrafficTrendCoverageViewModel>
  return isFiniteTimestamp(coverage.average)
    && coverage.average >= 0
    && coverage.average <= 1
    && isNullableFiniteNumber(coverage.minimum)
    && (coverage.minimum === null || (coverage.minimum >= 0 && coverage.minimum <= 1))
    && isFiniteTimestamp(coverage.availableEntities)
    && Number.isInteger(coverage.availableEntities)
    && coverage.availableEntities >= 0
    && isFiniteTimestamp(coverage.totalEntities)
    && Number.isInteger(coverage.totalEntities)
    && coverage.totalEntities >= coverage.availableEntities
}

function isTrafficTrendDay(value: unknown): value is TrafficTrendDayViewModel {
  if (!value || typeof value !== 'object')
    return false

  const day = value as Partial<TrafficTrendDayViewModel>
  return typeof day.date === 'string'
    && isNullableFiniteNumber(day.uploadBytes)
    && isNullableFiniteNumber(day.downloadBytes)
    && isNullableFiniteNumber(day.totalBytes)
    && ['complete', 'partial', 'estimated', 'missing'].includes(day.quality ?? '')
    && (day.source === null || ['metric-delta', 'counter-diff', 'mixed'].includes(day.source ?? ''))
    && isTrafficTrendCoverage(day.coverage)
    && typeof day.isInProgress === 'boolean'
    && Array.isArray(day.reasons)
    && day.reasons.every(reason => typeof reason === 'string')
}

function isTrafficTrendAvailability(value: unknown): value is TrafficTrendAvailability {
  return ['available', 'recording-disabled', 'retention-insufficient'].includes(value as string)
}

function isHistoryFailureKind(value: unknown): value is HistoryFailureKind {
  return ['aborted', 'unsupported', 'permission', 'timeout', 'network', 'protocol', 'unknown'].includes(value as string)
}

function isTrafficTrendSnapshot(value: unknown): value is TrafficTrendSnapshot {
  if (!value || typeof value !== 'object')
    return false

  const snapshot = value as Partial<TrafficTrendSnapshot>
  return ['idle', 'loading', 'ready', 'empty', 'unsupported', 'error'].includes(snapshot.state ?? '')
    && Array.isArray(snapshot.days)
    && snapshot.days.every(isTrafficTrendDay)
    && (snapshot.fetchedAt === null || isFiniteTimestamp(snapshot.fetchedAt))
    && (snapshot.sourceKind === null || snapshot.sourceKind === 'metrics' || snapshot.sourceKind === 'records')
    && (snapshot.retentionDays === null || isFiniteTimestamp(snapshot.retentionDays))
    && isTrafficTrendAvailability(snapshot.availability)
    && (snapshot.failureKind === null || isHistoryFailureKind(snapshot.failureKind))
    && typeof snapshot.retryable === 'boolean'
    && typeof snapshot.message === 'string'
}

function isCacheEntry(value: unknown): value is TrafficTrendCacheEntry {
  if (!value || typeof value !== 'object')
    return false

  const entry = value as Partial<TrafficTrendCacheEntry>
  return isFiniteTimestamp(entry.cachedAt) && isTrafficTrendSnapshot(entry.snapshot)
}

export function buildTrafficTrendCacheKey(input: TrafficTrendCacheKeyInput): string {
  const canonical = JSON.stringify({
    origin: input.origin,
    loggedIn: input.loggedIn,
    entityIds: normalizeEntityIds(input.entityIds),
    timeZone: input.timeZone,
    dates: [...input.dates],
    schema: input.schema,
  })
  return `${CACHE_PREFIX}${fnv1a32(canonical)}`
}

export function readTrafficTrendCache(
  storage: Pick<TrafficTrendCacheStorage, 'getItem' | 'removeItem'>,
  key: string,
  nowMs = Date.now(),
): TrafficTrendSnapshot | null {
  try {
    const raw = storage.getItem(key)
    if (!raw)
      return null

    const entry: unknown = JSON.parse(raw)
    if (!isCacheEntry(entry) || nowMs - entry.cachedAt < 0 || nowMs - entry.cachedAt >= TRAFFIC_TREND_CACHE_TTL_MS) {
      storage.removeItem(key)
      return null
    }
    return entry.snapshot
  }
  catch {
    return null
  }
}

export function writeTrafficTrendCache(
  storage: Pick<TrafficTrendCacheStorage, 'setItem'>,
  key: string,
  snapshot: TrafficTrendSnapshot,
  cachedAt = Date.now(),
): void {
  try {
    storage.setItem(key, JSON.stringify({ snapshot, cachedAt } satisfies TrafficTrendCacheEntry))
  }
  catch {
    // Storage is an optional performance optimization and must never block the overview.
  }
}
