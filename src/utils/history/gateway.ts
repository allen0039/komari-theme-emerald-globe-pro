import type { NormalizedMetricSeries, RawMetricsResponse, RawRecordsResponse, RawStatusRecord, RpcCall, TrafficQuery } from './types'
import { RpcError } from '@/utils/rpc'
import { isRetryableHistoryFailure } from './errorPolicy'

const UNKNOWN_METRIC_KEY_PATTERN = /unknown metric key/i
const METRICS_RETRY_DELAY_MS = 100

export class HistoryProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HistoryProtocolError'
  }
}

export class HistoryCapabilitiesUnavailableError extends Error {
  constructor() {
    super('当前服务不支持历史流量接口')
    this.name = 'HistoryCapabilitiesUnavailableError'
  }
}

export type TrafficHistoryResult
  = { kind: 'metrics', retentionDays: number | null, series: NormalizedMetricSeries[] }
    | { kind: 'records', sampled: boolean, records: Record<string, RawStatusRecord[]> }

type LegacyRecordsResult = Extract<TrafficHistoryResult, { kind: 'records' }>

function isMetricFallback(error: unknown): boolean {
  if (!(error instanceof RpcError))
    return false
  if (error.code === -32601)
    return true
  return error.code === -32602 && UNKNOWN_METRIC_KEY_PATTERN.test(error.message)
}

function isMetricsMethodUnavailable(error: unknown): boolean {
  return error instanceof RpcError && error.code === -32601
}

function isLegacyRecordsUnavailable(error: unknown): boolean {
  return error instanceof RpcError && error.code === -32601
}

function createAbortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

function waitForMetricsRetry(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted)
    return Promise.reject(createAbortError())

  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const abort = () => {
      if (timeoutId !== null)
        clearTimeout(timeoutId)
      signal?.removeEventListener('abort', abort)
      reject(createAbortError())
    }
    timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, METRICS_RETRY_DELAY_MS)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

function normalizeTags(value: unknown): Record<string, string> {
  if (value === undefined)
    return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.values(value).some(item => typeof item !== 'string')) {
    throw new HistoryProtocolError('Invalid traffic metric tags')
  }
  return value as Record<string, string>
}

function normalizeMetrics(payload: unknown): { retentionDays: number | null, series: NormalizedMetricSeries[] } {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as RawMetricsResponse).series))
    throw new HistoryProtocolError('Invalid public:queryMetrics response')

  const series: NormalizedMetricSeries[] = []
  let retentionDays: number | null = null
  for (const item of (payload as RawMetricsResponse).series) {
    if (!item || typeof item !== 'object' || !['traffic.up', 'traffic.down'].includes(item.metric_key) || typeof item.entity_id !== 'string')
      throw new HistoryProtocolError('Invalid traffic metric series')
    if (item.downsampled === true && item.downsample_algorithm !== 'sum')
      throw new HistoryProtocolError('Expected sum-aggregated traffic metrics')
    const points = item.points ?? []
    if (!Array.isArray(points))
      throw new HistoryProtocolError('Invalid traffic metric points')
    for (const point of points) {
      if (!point || typeof point !== 'object' || typeof point.time !== 'string' || (point.value !== null && typeof point.value !== 'number'))
        throw new HistoryProtocolError('Invalid traffic metric point')
    }
    if (typeof item.retention_days === 'number' && Number.isFinite(item.retention_days))
      retentionDays = retentionDays === null ? item.retention_days : Math.min(retentionDays, item.retention_days)
    series.push({
      metricKey: item.metric_key as 'traffic.up' | 'traffic.down',
      entityId: item.entity_id,
      tags: normalizeTags(item.tags),
      retentionDays: typeof item.retention_days === 'number' ? item.retention_days : null,
      downsampled: item.downsampled === true,
      aggregation: item.downsample_algorithm ?? null,
      intervalSeconds: typeof item.interval_seconds === 'number' ? item.interval_seconds : null,
      points: points.map(point => ({
        time: point.time,
        value: point.value,
        count: point.count,
        tags: normalizeTags(point.tags),
      })),
    })
  }
  return { retentionDays, series }
}

function normalizeRecords(payload: unknown): Record<string, RawStatusRecord[]> {
  if (!payload || typeof payload !== 'object')
    throw new HistoryProtocolError('Invalid common:getRecords response')
  const records = (payload as RawRecordsResponse).records
  if (!records || Array.isArray(records) || typeof records !== 'object')
    throw new HistoryProtocolError('Expected grouped load records')
  for (const [uuid, rows] of Object.entries(records)) {
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || typeof row.time !== 'string'))
      throw new HistoryProtocolError(`Invalid records for ${uuid}`)
  }
  return records as Record<string, RawStatusRecord[]>
}

function minimumRetentionDays(series: NormalizedMetricSeries[]): number | null {
  const values = series
    .map(item => item.retentionDays)
    .filter((value): value is number => value !== null)
  return values.length > 0 ? Math.min(...values) : null
}

export function createHistoryGateway(call: RpcCall) {
  async function queryMetricSeries(
    query: TrafficQuery,
    entityIds: string[],
    start: string,
    end: string,
    maxPoints: number,
  ): Promise<NormalizedMetricSeries[]> {
    const payload = await call<RawMetricsResponse>('public:queryMetrics', {
      metric_keys: ['traffic.up', 'traffic.down'],
      entity_ids: entityIds,
      start,
      end,
      aggregation: 'sum',
      max_points: maxPoints,
    }, { signal: query.signal })
    return normalizeMetrics(payload).series.filter(item => entityIds.includes(item.entityId))
  }

  async function queryLegacyRecords(query: TrafficQuery, entityIds: string[]): Promise<LegacyRecordsResult> {
    const payload = await call<RawRecordsResponse>('common:getRecords', {
      type: 'load',
      start: query.start,
      end: query.end,
      load_type: 'all',
      maxCount: -1,
    }, { signal: query.signal })
    const records = normalizeRecords(payload)
    return {
      kind: 'records',
      sampled: false,
      records: Object.fromEntries(entityIds.map(entityId => [entityId, records[entityId] ?? []])),
    }
  }

  async function queryTraffic(query: TrafficQuery): Promise<TrafficHistoryResult> {
    const entityIds = [...new Set(query.entityIds.filter(entityId => entityId.length > 0))]
    if (entityIds.length === 0)
      return { kind: 'metrics', retentionDays: null, series: [] }

    let series: NormalizedMetricSeries[]
    try {
      series = await queryMetricSeries(query, entityIds, query.start, query.end, query.maxPoints ?? 500)
    }
    catch (error) {
      if (isRetryableHistoryFailure(error)) {
        await waitForMetricsRetry(query.signal)
        series = await queryMetricSeries(query, entityIds, query.start, query.end, query.maxPoints ?? 500)
      }
      else if (!isMetricFallback(error)) {
        throw error
      }
      else {
        const metricsMethodUnavailable = isMetricsMethodUnavailable(error)

        try {
          return await queryLegacyRecords(query, entityIds)
        }
        catch (recordsError) {
          if (metricsMethodUnavailable && isLegacyRecordsUnavailable(recordsError))
            throw new HistoryCapabilitiesUnavailableError()
          throw recordsError
        }
      }
    }

    return {
      kind: 'metrics',
      retentionDays: minimumRetentionDays(series),
      series,
    }
  }

  async function probeCapabilities(): Promise<{ metrics: boolean, records: boolean }> {
    const methods = await call<string[]>('rpc.methods')
    if (!Array.isArray(methods) || methods.some(method => typeof method !== 'string'))
      throw new HistoryProtocolError('Invalid rpc.methods response')
    return {
      metrics: methods.includes('public:queryMetrics'),
      records: methods.includes('common:getRecords'),
    }
  }

  return { queryTraffic, probeCapabilities }
}
