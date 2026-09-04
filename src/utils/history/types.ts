import type { RpcCallOptions } from '@/utils/rpc'

export type RpcCall = <T>(method: string, params?: Record<string, unknown> | unknown[], options?: RpcCallOptions) => Promise<T>

export interface RawTrafficPoint {
  time: string
  value: number | null
  count?: number
  tags?: Record<string, string>
}

export interface RawTrafficSeries {
  metric_key: string
  entity_id: string
  tags?: Record<string, string>
  retention_days?: number
  downsampled?: boolean
  downsample_algorithm?: string
  interval_seconds?: number
  points?: RawTrafficPoint[] | null
}

export interface RawMetricsResponse {
  start?: string
  end?: string
  series: RawTrafficSeries[]
}

export interface RawStatusRecord {
  client: string
  time: string
  traffic_up?: number | null
  traffic_down?: number | null
  net_total_up?: number | null
  net_total_down?: number | null
  [key: string]: unknown
}

export interface RawRecordsResponse {
  count?: number
  records: RawStatusRecord[] | Record<string, RawStatusRecord[]>
  from?: string
  to?: string
}

export interface TrafficQuery {
  entityIds: string[]
  start: string
  end: string
  maxPoints?: number
  signal?: AbortSignal
}

export interface NormalizedMetricPoint {
  time: string
  value: number | null
  count?: number
  tags?: Record<string, string>
}

export interface NormalizedMetricSeries {
  metricKey: 'traffic.up' | 'traffic.down'
  entityId: string
  tags?: Record<string, string>
  retentionDays: number | null
  downsampled: boolean
  aggregation: string | null
  intervalSeconds: number | null
  points: NormalizedMetricPoint[]
}
