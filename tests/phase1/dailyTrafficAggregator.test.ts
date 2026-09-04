import { describe, expect, test } from 'bun:test'
import {
  aggregateDailyTraffic,
  buildRecentNaturalDayKeys,
  buildZonedDayWindow,
  resolveAnalyticsTimeZone,
} from '../../src/utils/history/trafficAggregator'

const HOUR = 60 * 60 * 1000

function utc(value: string): number {
  return Date.parse(value)
}

describe('daily traffic aggregation', () => {
  test('keeps complete authoritative UTC deltas, including true zero', () => {
    const startMs = utc('2026-01-02T00:00:00.000Z')
    const endMs = utc('2026-01-03T00:00:00.000Z')

    const [traffic] = aggregateDailyTraffic({
      timeZone: 'UTC',
      dates: ['2026-01-02'],
      nowMs: endMs + HOUR,
      deltas: [{
        startMs,
        endMs,
        uploadBytes: 120,
        downloadBytes: 340,
        sampling: 'authoritative',
      }],
    })

    expect(traffic).toMatchObject({
      date: '2026-01-02',
      uploadBytes: 120,
      downloadBytes: 340,
      source: 'metric-delta',
      quality: 'complete',
      coverage: 1,
      maxGapMs: 0,
      firstRecordAtMs: startMs,
      lastRecordAtMs: endMs,
      resetCount: 0,
    })

    const [zero] = aggregateDailyTraffic({
      timeZone: 'UTC',
      dates: ['2026-01-02'],
      nowMs: endMs + HOUR,
      deltas: [{
        startMs,
        endMs,
        uploadBytes: 0,
        downloadBytes: 0,
        sampling: 'authoritative',
      }],
    })

    expect(zero.uploadBytes).toBe(0)
    expect(zero.downloadBytes).toBe(0)
    expect(zero.quality).toBe('complete')
    expect(zero.source).toBe('metric-delta')
  })

  test('sums retained intervals around a one-hour backup restart gap', () => {
    const startMs = utc('2026-01-02T00:00:00.000Z')
    const endMs = utc('2026-01-03T00:00:00.000Z')
    const [traffic] = aggregateDailyTraffic({
      timeZone: 'UTC',
      dates: ['2026-01-02'],
      nowMs: endMs + HOUR,
      deltas: [
        {
          startMs,
          endMs: startMs + 2 * HOUR,
          uploadBytes: 20,
          downloadBytes: 40,
          sampling: 'authoritative',
        },
        {
          startMs: startMs + 3 * HOUR,
          endMs,
          uploadBytes: 210,
          downloadBytes: 420,
          sampling: 'authoritative',
        },
      ],
    })

    expect(traffic).toMatchObject({
      uploadBytes: 230,
      downloadBytes: 460,
      quality: 'partial',
      maxGapMs: HOUR,
    })
    expect(traffic.coverage).toBeCloseTo(23 / 24)
  })

  test('rejects point-sampled deltas and falls back to counter differences', () => {
    const startMs = utc('2026-01-02T00:00:00.000Z')
    const endMs = utc('2026-01-03T00:00:00.000Z')
    const [result] = aggregateDailyTraffic({
      timeZone: 'UTC',
      dates: ['2026-01-02'],
      nowMs: endMs + HOUR,
      deltas: [{
        startMs,
        endMs,
        uploadBytes: 999,
        downloadBytes: 999,
        sampling: 'sampled',
      }],
      counters: [
        { atMs: startMs, uploadBytes: 100, downloadBytes: 200 },
        { atMs: endMs, uploadBytes: 130, downloadBytes: 240 },
      ],
    })

    expect(result).toMatchObject({
      uploadBytes: 30,
      downloadBytes: 40,
      source: 'counter-diff',
      quality: 'estimated',
      coverage: 1,
    })
    expect(result.reasons).toContain('sampled-delta-rejected')
  })

  test('treats a backwards cumulative counter as a reset', () => {
    const startMs = utc('2026-01-02T00:00:00.000Z')
    const endMs = utc('2026-01-03T00:00:00.000Z')
    const [result] = aggregateDailyTraffic({
      timeZone: 'UTC',
      dates: ['2026-01-02'],
      nowMs: endMs + HOUR,
      counters: [
        { atMs: startMs, uploadBytes: 1000, downloadBytes: 500 },
        { atMs: endMs, uploadBytes: 25, downloadBytes: 700 },
      ],
    })

    expect(result.uploadBytes).toBe(25)
    expect(result.downloadBytes).toBe(200)
    expect(result.resetCount).toBe(1)
    expect(result.quality).toBe('estimated')
    expect(result.reasons).toContain('counter-reset')
  })

  test('mixes only disjoint evidence and prevents overlap double counting', () => {
    const dayStart = utc('2026-01-02T00:00:00.000Z')
    const dayEnd = utc('2026-01-03T00:00:00.000Z')
    const [mixed] = aggregateDailyTraffic({
      timeZone: 'UTC',
      dates: ['2026-01-02'],
      nowMs: dayEnd + HOUR,
      deltas: [{
        startMs: dayStart,
        endMs: dayStart + HOUR,
        uploadBytes: 10,
        downloadBytes: 20,
        sampling: 'authoritative',
      }],
      counters: [
        { atMs: dayStart + HOUR, uploadBytes: 100, downloadBytes: 200 },
        { atMs: dayStart + 2 * HOUR, uploadBytes: 130, downloadBytes: 240 },
      ],
    })

    expect(mixed.uploadBytes).toBe(40)
    expect(mixed.downloadBytes).toBe(60)
    expect(mixed.source).toBe('mixed')
    expect(mixed.quality).toBe('estimated')
    expect(mixed.coverage).toBeCloseTo(2 / 24)

    const [overlap] = aggregateDailyTraffic({
      timeZone: 'UTC',
      dates: ['2026-01-02'],
      nowMs: dayEnd + HOUR,
      deltas: [{
        startMs: dayStart,
        endMs: dayStart + HOUR,
        uploadBytes: 10,
        downloadBytes: 20,
        sampling: 'authoritative',
      }],
      counters: [
        { atMs: dayStart + HOUR / 2, uploadBytes: 100, downloadBytes: 200 },
        { atMs: dayStart + HOUR + HOUR / 2, uploadBytes: 130, downloadBytes: 240 },
      ],
    })

    expect(overlap.uploadBytes).toBe(10)
    expect(overlap.downloadBytes).toBe(20)
    expect(overlap.source).toBe('metric-delta')
    expect(overlap.reasons).toContain('counter-overlap-rejected')
  })

  test('rejects an interval that crosses a natural-day boundary', () => {
    const results = aggregateDailyTraffic({
      timeZone: 'UTC',
      dates: ['2026-01-01', '2026-01-02'],
      nowMs: utc('2026-01-03T00:00:00.000Z'),
      deltas: [{
        startMs: utc('2026-01-01T23:30:00.000Z'),
        endMs: utc('2026-01-02T00:30:00.000Z'),
        uploadBytes: 10,
        downloadBytes: 20,
        sampling: 'authoritative',
      }],
    })

    expect(results).toHaveLength(2)
    for (const result of results) {
      expect(result.uploadBytes).toBeNull()
      expect(result.downloadBytes).toBeNull()
      expect(result.quality).toBe('missing')
      expect(result.reasons).toContain('cross-day-interval-rejected')
    }
  })

  test('uses Asia/Shanghai natural-day boundaries', () => {
    const window = buildZonedDayWindow('2026-01-02', 'Asia/Shanghai', utc('2026-01-04T00:00:00.000Z'))
    expect(window.startMs).toBe(utc('2026-01-01T16:00:00.000Z'))
    expect(window.endMs).toBe(utc('2026-01-02T16:00:00.000Z'))

    const [result] = aggregateDailyTraffic({
      timeZone: 'Asia/Shanghai',
      dates: ['2026-01-02'],
      nowMs: utc('2026-01-04T00:00:00.000Z'),
      deltas: [{
        startMs: window.startMs,
        endMs: window.endMs,
        uploadBytes: 8,
        downloadBytes: 9,
        sampling: 'authoritative',
      }],
    })

    expect(result.date).toBe('2026-01-02')
    expect(result.quality).toBe('complete')
  })

  test('honors New York 23-hour spring and 25-hour autumn days', () => {
    const spring = buildZonedDayWindow('2026-03-08', 'America/New_York', utc('2026-03-10T00:00:00.000Z'))
    expect(spring.startMs).toBe(utc('2026-03-08T05:00:00.000Z'))
    expect(spring.endMs).toBe(utc('2026-03-09T04:00:00.000Z'))
    expect(spring.durationMs).toBe(23 * HOUR)

    const autumn = buildZonedDayWindow('2026-11-01', 'America/New_York', utc('2026-11-03T00:00:00.000Z'))
    expect(autumn.startMs).toBe(utc('2026-11-01T04:00:00.000Z'))
    expect(autumn.endMs).toBe(utc('2026-11-02T05:00:00.000Z'))
    expect(autumn.durationMs).toBe(25 * HOUR)
  })

  test('uses now as the effective end of today', () => {
    const nowMs = utc('2026-01-02T12:00:00.000Z')
    const window = buildZonedDayWindow('2026-01-02', 'UTC', nowMs)
    expect(window.effectiveEndMs).toBe(nowMs)
    expect(window.effectiveDurationMs).toBe(12 * HOUR)
    expect(window.isInProgress).toBe(true)

    const [result] = aggregateDailyTraffic({
      timeZone: 'UTC',
      dates: ['2026-01-02'],
      nowMs,
      deltas: [{
        startMs: window.startMs,
        endMs: nowMs,
        uploadBytes: 12,
        downloadBytes: 24,
        sampling: 'authoritative',
      }],
    })

    expect(result.coverage).toBe(1)
    expect(result.quality).toBe('complete')
    expect(result.isInProgress).toBe(true)
  })

  test('resolves browser zones and rejects invalid IANA zones', () => {
    expect(resolveAnalyticsTimeZone('browser', 'Asia/Shanghai')).toBe('Asia/Shanghai')
    expect(() => resolveAnalyticsTimeZone('Definitely/Not_A_Zone')).toThrow(RangeError)
    expect(() => buildZonedDayWindow('2026-01-02', 'Definitely/Not_A_Zone')).toThrow(RangeError)
  })

  test('builds recent natural-day labels across month and year boundaries', () => {
    const nowMs = utc('2026-01-02T16:30:00.000Z')
    expect(buildRecentNaturalDayKeys(7, 'browser', nowMs, 'Asia/Shanghai')).toEqual([
      '2025-12-28',
      '2025-12-29',
      '2025-12-30',
      '2025-12-31',
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
    ])
    expect(buildRecentNaturalDayKeys(0, 'UTC', nowMs)).toEqual([])
    expect(() => buildRecentNaturalDayKeys(-1, 'UTC', nowMs)).toThrow(RangeError)
  })

  test('attributes invalid evidence only to the day it overlaps', () => {
    const results = aggregateDailyTraffic({
      timeZone: 'UTC',
      dates: ['2026-01-01', '2026-01-02'],
      nowMs: utc('2026-01-03T00:00:00Z'),
      deltas: [
        {
          startMs: utc('2026-01-01T00:00:00Z'),
          endMs: utc('2026-01-02T00:00:00Z'),
          uploadBytes: 1,
          downloadBytes: 2,
          sampling: 'authoritative',
        },
        {
          startMs: utc('2026-01-02T00:00:00Z'),
          endMs: utc('2026-01-03T00:00:00Z'),
          uploadBytes: -1,
          downloadBytes: 2,
          sampling: 'authoritative',
        },
      ],
    })

    expect(results[0]?.quality).toBe('complete')
    expect(results[0]?.reasons).not.toContain('invalid-evidence-rejected')
    expect(results[1]?.reasons).toContain('invalid-evidence-rejected')
  })

  test('rejects counter intervals adjacent to conflicting duplicate timestamps', () => {
    const [result] = aggregateDailyTraffic({
      timeZone: 'UTC',
      dates: ['2026-01-02'],
      nowMs: utc('2026-01-03T00:00:00Z'),
      counters: [
        { atMs: utc('2026-01-02T00:00:00Z'), uploadBytes: 100, downloadBytes: 200 },
        { atMs: utc('2026-01-02T01:00:00Z'), uploadBytes: 110, downloadBytes: 210 },
        { atMs: utc('2026-01-02T01:00:00Z'), uploadBytes: 999, downloadBytes: 999 },
        { atMs: utc('2026-01-02T02:00:00Z'), uploadBytes: 120, downloadBytes: 220 },
      ],
    })

    expect(result.uploadBytes).toBeNull()
    expect(result.downloadBytes).toBeNull()
    expect(result.reasons).toContain('conflicting-counter-reading')
  })
})
