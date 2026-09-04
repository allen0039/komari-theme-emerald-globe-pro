import type { TrafficTrendCoverageViewModel } from './trafficTrend'
import type { TrafficTrendAvailability } from './trafficTrendAvailability'
import type { HistoryFailureKind } from '@/utils/history/errorPolicy'
import type { TrafficQuality, TrafficReason, TrafficSource } from '@/utils/history/trafficAggregator'

const SOURCE_LABELS: Record<Exclude<TrafficSource, 'mixed'> | 'mixed', string> = {
  'metric-delta': '指标汇总',
  'counter-diff': '累计计数器差值',
  'mixed': '混合来源',
}

const QUALITY_LABELS: Record<TrafficQuality, string> = {
  complete: '完整',
  partial: '部分',
  estimated: '估算',
  missing: '缺失',
}

const REASON_LABELS: Record<TrafficReason, string> = {
  'sampled-delta-rejected': '采样流量不适合按日汇总',
  'invalid-evidence-rejected': '已忽略无效流量样本',
  'cross-day-interval-rejected': '跨自然日的流量样本未计入',
  'overlapping-delta-rejected': '重叠流量样本未重复计入',
  'counter-overlap-rejected': '与指标重叠的计数器样本未计入',
  'conflicting-counter-reading': '存在冲突的累计计数器读数',
  'counter-reset': '检测到累计计数器重置',
  'no-data': '未取得有效流量样本',
}

const FAILURE_MESSAGES: Record<Exclude<HistoryFailureKind, 'aborted'>, string> = {
  unsupported: '当前服务不支持历史流量接口',
  permission: '没有权限读取历史流量',
  timeout: '读取历史流量超时',
  network: '历史流量网络连接失败',
  protocol: '历史流量返回格式异常',
  unknown: '读取历史流量失败',
}

const AVAILABILITY_MESSAGES: Record<Exclude<TrafficTrendAvailability, 'available'>, string> = {
  'recording-disabled': '服务端未开启历史流量记录',
  'retention-insufficient': '历史记录保留时间不足，趋势可能不完整',
}

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function trafficSourceLabel(source: TrafficSource | null): string {
  return source === null ? '无来源' : SOURCE_LABELS[source]
}

export function trafficQualityLabel(quality: TrafficQuality): string {
  return QUALITY_LABELS[quality]
}

export function trafficReasonLabel(reason: TrafficReason): string {
  return REASON_LABELS[reason]
}

export function trafficCoverageLines(coverage: TrafficTrendCoverageViewModel): string[] {
  return [
    `平均覆盖：${percentage(coverage.average)}`,
    coverage.minimum === null ? '最低覆盖：无有效样本' : `最低覆盖：${percentage(coverage.minimum)}`,
    `有效探针：${coverage.availableEntities}/${coverage.totalEntities}`,
  ]
}

export function trafficFailureMessage(failureKind: HistoryFailureKind | null): string {
  if (failureKind === null || failureKind === 'aborted')
    return ''
  return FAILURE_MESSAGES[failureKind]
}

export function trafficAvailabilityMessage(availability: TrafficTrendAvailability): string {
  return availability === 'available' ? '' : AVAILABILITY_MESSAGES[availability]
}

export function trafficTrendStatusMessages(
  failureKind: HistoryFailureKind | null,
  availability: TrafficTrendAvailability,
): string[] {
  return [trafficFailureMessage(failureKind), trafficAvailabilityMessage(availability)].filter(Boolean)
}
