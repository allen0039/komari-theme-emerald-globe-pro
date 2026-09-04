import type { TrafficTrendAvailability } from './trafficTrendAvailability'
import type { HistoryFailureKind } from '@/utils/history/errorPolicy'
import type {
  DailyTrafficAggregate,
  TrafficQuality,
  TrafficReason,
  TrafficSource,
} from '@/utils/history/trafficAggregator'

export type TrafficTrendState = 'idle' | 'loading' | 'ready' | 'empty' | 'unsupported' | 'error'

export interface TrafficTrendCoverageViewModel {
  average: number
  minimum: number | null
  availableEntities: number
  totalEntities: number
}

export interface TrafficTrendDayViewModel {
  date: string
  uploadBytes: number | null
  downloadBytes: number | null
  totalBytes: number | null
  quality: TrafficQuality
  source: TrafficSource | null
  coverage: TrafficTrendCoverageViewModel
  isInProgress: boolean
  reasons: TrafficReason[]
}

export interface TrafficTrendSnapshot {
  state: TrafficTrendState
  days: TrafficTrendDayViewModel[]
  fetchedAt: number | null
  sourceKind: 'metrics' | 'records' | null
  retentionDays: number | null
  availability: TrafficTrendAvailability
  failureKind: HistoryFailureKind | null
  retryable: boolean
  message: string
}

const QUALITY_RANK: Record<TrafficQuality, number> = {
  complete: 0,
  partial: 1,
  estimated: 2,
  missing: 3,
}

function getDayRows(
  byEntity: ReadonlyMap<string, readonly DailyTrafficAggregate[]>,
  entityIds: readonly string[],
  date: string,
): DailyTrafficAggregate[] {
  return entityIds.flatMap((entityId) => {
    const rows = byEntity.get(entityId) ?? []
    const row = rows.find(row => row.date === date)
    return row ? [row] : []
  })
}

export function buildTrafficTrendViewModel(
  byEntity: ReadonlyMap<string, readonly DailyTrafficAggregate[]>,
  dates: readonly string[],
  entityIds: readonly string[],
): Pick<TrafficTrendSnapshot, 'state' | 'days' | 'message'> {
  const visibleEntityIds = [...new Set(entityIds)]
  const days = dates.map((date): TrafficTrendDayViewModel => {
    const rows = getDayRows(byEntity, visibleEntityIds, date)
    const uploadRows = rows.filter(row => row.uploadBytes !== null)
    const downloadRows = rows.filter(row => row.downloadBytes !== null)
    const availableRows = rows.filter(row => row.uploadBytes !== null || row.downloadBytes !== null)
    const totalEntities = visibleEntityIds.length
    const coverage: TrafficTrendCoverageViewModel = {
      average: totalEntities === 0
        ? 0
        : availableRows.reduce((total, row) => total + row.coverage, 0) / totalEntities,
      minimum: availableRows.length > 0 ? Math.min(...availableRows.map(row => row.coverage)) : null,
      availableEntities: availableRows.length,
      totalEntities,
    }
    const uploadBytes = uploadRows.length > 0
      ? uploadRows.reduce((sum, row) => sum + row.uploadBytes!, 0)
      : null
    const downloadBytes = downloadRows.length > 0
      ? downloadRows.reduce((sum, row) => sum + row.downloadBytes!, 0)
      : null
    const measuredQuality = availableRows.reduce<TrafficQuality>((worst, row) => {
      return QUALITY_RANK[row.quality] > QUALITY_RANK[worst] ? row.quality : worst
    }, 'complete')
    let quality: TrafficQuality
    if (availableRows.length === 0) {
      quality = 'missing'
    }
    else if (measuredQuality === 'complete' && (
      coverage.availableEntities !== coverage.totalEntities || coverage.average < 1
    )) {
      quality = 'partial'
    }
    else {
      quality = measuredQuality
    }
    const sources = new Set(rows.flatMap(row => row.source === null ? [] : [row.source]))
    const source = sources.size === 0
      ? null
      : sources.size === 1
        ? sources.values().next().value!
        : 'mixed'

    return {
      date,
      uploadBytes,
      downloadBytes,
      totalBytes: uploadBytes === null || downloadBytes === null ? null : uploadBytes + downloadBytes,
      quality,
      source,
      coverage,
      isInProgress: rows.some(row => row.isInProgress),
      reasons: [...new Set(rows.flatMap(row => row.reasons))].sort(),
    }
  })
  const missingDays = days.filter(day => day.totalBytes === null).length
  const availableDays = days.length - missingDays

  return {
    state: days.every(day => day.uploadBytes === null && day.downloadBytes === null) ? 'empty' : 'ready',
    days,
    message: `采集：${availableDays}天，缺失：${missingDays}天`,
  }
}
