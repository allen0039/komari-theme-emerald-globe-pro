import type { NormalizedMetricSeries, RawStatusRecord } from '../../src/utils/history/types'
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { aggregateDailyTraffic } from '../../src/utils/history/trafficAggregator'
import { historyResultToTrafficEvidence, metricsToTrafficEvidence, recordsToTrafficEvidence } from '../../src/utils/history/trafficEvidence'

function readFixture<T>(path: string): T {
  return JSON.parse(readFileSync(new URL(`../fixtures/${path}`, import.meta.url), 'utf8')) as T
}

function normalizeFixtureSeries(path: string): NormalizedMetricSeries[] {
  const fixture = readFixture<{ series: Array<Record<string, unknown>> }>(path)
  return fixture.series.map(item => ({
    metricKey: item.metric_key as NormalizedMetricSeries['metricKey'],
    entityId: item.entity_id as string,
    retentionDays: item.retention_days as number,
    downsampled: item.downsampled === true,
    aggregation: item.downsample_algorithm as string,
    intervalSeconds: item.interval_seconds as number,
    points: ((item.points ?? []) as Array<Record<string, unknown>>).map(point => ({
      time: point.time as string,
      value: point.value as number | null,
      count: point.count as number,
    })),
  }))
}

describe('traffic evidence adapters', () => {
  test('combines upload and download metric buckets into authoritative intervals', () => {
    const series = normalizeFixtureSeries('komari-1.3.2/traffic-metrics.json')
    const evidence = metricsToTrafficEvidence(series, {
      startMs: Date.parse('2026-08-24T00:00:00Z'),
      endMs: Date.parse('2026-08-24T01:00:00Z'),
    })

    expect(evidence).toHaveLength(2)
    expect(evidence[0]).toMatchObject({
      entityId: 'node-a',
      counters: [],
      deltas: [
        { uploadBytes: 100, downloadBytes: 400, sampling: 'authoritative' },
        { uploadBytes: 200, downloadBytes: 500, sampling: 'authoritative' },
      ],
    })
    expect(evidence[1]?.deltas).toEqual([expect.objectContaining({
      uploadBytes: 0,
      downloadBytes: 0,
      sampling: 'authoritative',
    })])
  })

  test('uses adjacent raw metric timestamps and skips the unbounded first point', () => {
    const evidence = metricsToTrafficEvidence([{
      metricKey: 'traffic.up',
      entityId: 'node-a',
      retentionDays: 30,
      downsampled: false,
      aggregation: null,
      intervalSeconds: null,
      points: [
        { time: '2026-08-24T00:00:00Z', value: 999 },
        { time: '2026-08-24T00:01:00Z', value: 12 },
        { time: '2026-08-24T00:02:00Z', value: 18 },
      ],
    }], {
      startMs: Date.parse('2026-08-24T00:00:00Z'),
      endMs: Date.parse('2026-08-24T00:02:00Z'),
    })

    expect(evidence[0]?.deltas).toEqual([
      expect.objectContaining({ uploadBytes: 12 }),
      expect.objectContaining({ uploadBytes: 18 }),
    ])
  })

  test('rejects a whole metric bucket that only partially overlaps the query window', () => {
    const evidence = metricsToTrafficEvidence([{
      metricKey: 'traffic.up',
      entityId: 'node-a',
      retentionDays: 30,
      downsampled: true,
      aggregation: 'sum',
      intervalSeconds: 3600,
      points: [{ time: '2026-08-23T23:30:00Z', value: 50 }],
    }], {
      startMs: Date.parse('2026-08-24T00:00:00Z'),
      endMs: Date.parse('2026-08-24T01:00:00Z'),
    })

    expect(evidence[0]?.deltas).toEqual([])
  })

  test('sums distinct metric tags but ignores an exact duplicate contribution', () => {
    const base: NormalizedMetricSeries = {
      metricKey: 'traffic.up',
      entityId: 'node-a',
      tags: { device: 'eth0' },
      retentionDays: 30,
      downsampled: true,
      aggregation: 'sum',
      intervalSeconds: 3600,
      points: [{ time: '2026-08-24T00:00:00Z', value: 10 }],
    }
    const evidence = metricsToTrafficEvidence([
      base,
      { ...base, points: [...base.points] },
      { ...base, tags: { device: 'eth1' }, points: [{ time: '2026-08-24T00:00:00Z', value: 5 }] },
    ], {
      startMs: Date.parse('2026-08-24T00:00:00Z'),
      endMs: Date.parse('2026-08-24T01:00:00Z'),
    })

    expect(evidence[0]?.deltas[0]?.uploadBytes).toBe(15)
  })

  test('turns conflicting duplicate metric contributions into invalid evidence', () => {
    const base: NormalizedMetricSeries = {
      metricKey: 'traffic.up',
      entityId: 'node-a',
      tags: { device: 'eth0' },
      retentionDays: 30,
      downsampled: true,
      aggregation: 'sum',
      intervalSeconds: 3600,
      points: [{ time: '2026-08-24T00:00:00Z', value: 10 }],
    }
    const [evidence] = metricsToTrafficEvidence([
      base,
      { ...base, points: [{ time: '2026-08-24T00:00:00Z', value: 12 }] },
    ], {
      startMs: Date.parse('2026-08-24T00:00:00Z'),
      endMs: Date.parse('2026-08-24T01:00:00Z'),
    })

    const [daily] = aggregateDailyTraffic({
      timeZone: 'UTC',
      dates: ['2026-08-24'],
      nowMs: Date.parse('2026-08-24T01:00:00Z'),
      ...evidence,
    })
    expect(daily.uploadBytes).toBeNull()
    expect(daily.reasons).toContain('invalid-evidence-rejected')
  })

  test('does not treat a non-sum downsampled series as authoritative evidence', () => {
    const evidence = metricsToTrafficEvidence([{
      metricKey: 'traffic.up',
      entityId: 'node-a',
      retentionDays: 30,
      downsampled: true,
      aggregation: 'avg',
      intervalSeconds: 3600,
      points: [{ time: '2026-08-24T00:00:00Z', value: 12 }],
    }], {
      startMs: Date.parse('2026-08-24T00:00:00Z'),
      endMs: Date.parse('2026-08-24T01:00:00Z'),
    })

    expect(evidence[0]?.deltas).toEqual([])
  })

  test('uses counters when legacy deltas are all zero but counters grow', () => {
    const records: Record<string, RawStatusRecord[]> = {
      'node-a': [
        { client: 'node-a', time: '2026-08-24T00:00:00Z', traffic_up: 0, traffic_down: 0, net_total_up: 100, net_total_down: 200 },
        { client: 'node-a', time: '2026-08-24T01:00:00Z', traffic_up: 0, traffic_down: 0, net_total_up: 130, net_total_down: 240 },
      ],
    }

    const [evidence] = recordsToTrafficEvidence(records, { sampled: false })
    expect(evidence.deltas).toEqual([])

    const [daily] = aggregateDailyTraffic({
      timeZone: 'UTC',
      dates: ['2026-08-24'],
      nowMs: Date.parse('2026-08-25T00:00:00Z'),
      ...evidence,
    })
    expect(daily).toMatchObject({
      uploadBytes: 30,
      downloadBytes: 40,
      source: 'counter-diff',
      quality: 'estimated',
    })
  })

  test('keeps stable all-zero legacy deltas as real zero traffic', () => {
    const fixture = readFixture<{ records: Record<string, RawStatusRecord[]> }>('komari-1.3.2/traffic-records.json')
    const evidence = recordsToTrafficEvidence({ 'node-b': fixture.records['node-b'] }, { sampled: false })

    expect(evidence[0]?.deltas).toHaveLength(2)
    expect(evidence[0]?.deltas.every(delta =>
      delta.uploadBytes === 0
      && delta.downloadBytes === 0
      && delta.sampling === 'authoritative')).toBe(true)
  })

  test('includes the first unsampled legacy sum bucket without shifting it', () => {
    const fixture = readFixture<{ records: Record<string, RawStatusRecord[]> }>('komari-1.3.2/traffic-records.json')
    const [evidence] = recordsToTrafficEvidence({ 'node-a': fixture.records['node-a'] }, { sampled: false })

    expect(evidence.deltas).toEqual([
      expect.objectContaining({
        startMs: Date.parse('2026-08-24T00:00:00Z'),
        uploadBytes: 100,
        downloadBytes: 200,
      }),
      expect.objectContaining({
        startMs: Date.parse('2026-08-24T01:00:00Z'),
        uploadBytes: 10,
        downloadBytes: 20,
      }),
    ])
    expect(evidence.deltas.reduce((total, delta) => total + (delta.uploadBytes ?? 0), 0)).toBe(110)

    const [daily] = aggregateDailyTraffic({
      timeZone: 'UTC',
      dates: ['2026-08-24'],
      nowMs: Date.parse('2026-08-25T00:00:00Z'),
      ...evidence,
    })
    expect(daily).toMatchObject({
      uploadBytes: 110,
      downloadBytes: 220,
      quality: 'partial',
      coverage: 0,
      maxGapMs: 24 * 60 * 60 * 1000,
    })
  })

  test('falls back the whole mixed window when one zero bucket conflicts with counters', () => {
    const records: Record<string, RawStatusRecord[]> = {
      'node-a': [
        { client: 'node-a', time: '2026-08-24T00:00:00Z', traffic_up: 5, traffic_down: 6, net_total_up: 100, net_total_down: 200 },
        { client: 'node-a', time: '2026-08-24T01:00:00Z', traffic_up: 0, traffic_down: 0, net_total_up: 110, net_total_down: 220 },
        { client: 'node-a', time: '2026-08-24T02:00:00Z', traffic_up: 7, traffic_down: 8, net_total_up: 117, net_total_down: 228 },
      ],
    }

    const [evidence] = recordsToTrafficEvidence(records, { sampled: false })

    expect(evidence.deltas).toEqual([])
    expect(evidence.counters).toHaveLength(3)
  })

  test('marks sampled legacy deltas unsafe and keeps counters for fallback', () => {
    const fixture = readFixture<{ records: Record<string, RawStatusRecord[]> }>('komari-1.3.2/traffic-records.json')
    const [evidence] = recordsToTrafficEvidence({ 'node-a': fixture.records['node-a'] }, { sampled: true })

    expect(evidence.deltas[0]?.sampling).toBe('sampled')
    const [daily] = aggregateDailyTraffic({
      timeZone: 'UTC',
      dates: ['2026-08-24'],
      nowMs: Date.parse('2026-08-25T00:00:00Z'),
      ...evidence,
    })
    expect(daily.source).toBe('counter-diff')
    expect(daily.reasons).toContain('sampled-delta-rejected')
  })

  test('falls back to counters when traffic delta fields are missing', () => {
    const records: Record<string, RawStatusRecord[]> = {
      'node-a': [
        { client: 'node-a', time: '2026-08-24T00:00:00Z', net_total_up: 10, net_total_down: 20 },
        { client: 'node-a', time: '2026-08-24T01:00:00Z', net_total_up: 15, net_total_down: 27 },
      ],
    }

    const [evidence] = recordsToTrafficEvidence(records, { sampled: false })
    expect(evidence.deltas).toEqual([])
    expect(evidence.counters).toHaveLength(2)
  })

  test('keeps a one-direction metric interval as partial evidence', () => {
    const [evidence] = metricsToTrafficEvidence([{
      metricKey: 'traffic.up',
      entityId: 'node-a',
      retentionDays: 30,
      downsampled: true,
      aggregation: 'sum',
      intervalSeconds: 3600,
      points: [{ time: '2026-08-24T00:00:00Z', value: 12 }],
    }], {
      startMs: Date.parse('2026-08-24T00:00:00Z'),
      endMs: Date.parse('2026-08-24T01:00:00Z'),
    })

    const [daily] = aggregateDailyTraffic({
      timeZone: 'UTC',
      dates: ['2026-08-24'],
      nowMs: Date.parse('2026-08-24T01:00:00Z'),
      ...evidence,
    })
    expect(daily).toMatchObject({
      uploadBytes: 12,
      downloadBytes: null,
      quality: 'partial',
      coverage: 0,
      maxGapMs: 60 * 60 * 1000,
    })
  })

  test('converts a gateway result through one public adapter', () => {
    const evidence = historyResultToTrafficEvidence({
      kind: 'records',
      sampled: false,
      records: {
        'node-a': [
          { client: 'node-a', time: '2026-08-24T00:00:00Z', net_total_up: 1, net_total_down: 2 },
          { client: 'node-a', time: '2026-08-24T00:01:00Z', net_total_up: 3, net_total_down: 5 },
        ],
      },
    }, {
      startMs: Date.parse('2026-08-24T00:00:00Z'),
      endMs: Date.parse('2026-08-24T01:00:00Z'),
    })

    expect(evidence[0]).toMatchObject({ entityId: 'node-a', deltas: [] })
    expect(evidence[0]?.counters).toHaveLength(2)
  })
})
