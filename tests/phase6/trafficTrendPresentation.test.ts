import { describe, expect, test } from 'bun:test'
import {
  trafficAvailabilityMessage,
  trafficFailureMessage,
  trafficQualityLabel,
  trafficReasonLabel,
  trafficSourceLabel,
  trafficTrendStatusMessages,
} from '../../src/features/resource-overview/trafficTrendPresentation'

describe('traffic trend presentation', () => {
  test('translates all internal traffic evidence labels', () => {
    expect(trafficSourceLabel('metric-delta')).toBe('指标汇总')
    expect(trafficSourceLabel('counter-diff')).toBe('累计计数器差值')
    expect(trafficSourceLabel('mixed')).toBe('混合来源')
    expect(trafficSourceLabel(null)).toBe('无来源')
    expect(trafficQualityLabel('complete')).toBe('完整')
    expect(trafficQualityLabel('partial')).toBe('部分')
    expect(trafficQualityLabel('estimated')).toBe('估算')
    expect(trafficQualityLabel('missing')).toBe('缺失')
    expect(trafficReasonLabel('no-data')).toBe('未取得有效流量样本')
  })

  test.each([
    ['recording-disabled', '服务端未开启历史流量记录'],
    ['retention-insufficient', '历史记录保留时间不足，趋势可能不完整'],
  ] as const)('explains availability %s', (availability, message) => {
    expect(trafficAvailabilityMessage(availability)).toBe(message)
  })

  test.each([
    ['permission', '没有权限读取历史流量'],
    ['timeout', '读取历史流量超时'],
    ['network', '历史流量网络连接失败'],
    ['protocol', '历史流量返回格式异常'],
    ['unsupported', '当前服务不支持历史流量接口'],
  ] as const)('explains failure %s without raw server text', (kind, message) => {
    expect(trafficFailureMessage(kind)).toBe(message)
  })

  test('prioritizes request failure before a retention warning', () => {
    expect(trafficTrendStatusMessages('network', 'retention-insufficient')).toEqual([
      '历史流量网络连接失败',
      '历史记录保留时间不足，趋势可能不完整',
    ])
    expect(trafficTrendStatusMessages(null, 'recording-disabled')).toEqual([
      '服务端未开启历史流量记录',
    ])
  })
})
