import { describe, expect, test } from 'bun:test'
import {
  resolveConfiguredTrafficTrendAvailability,
  resolveMetricTrafficTrendAvailability,
} from '../../src/features/resource-overview/trafficTrendAvailability'
import { buildZonedDayWindow } from '../../src/utils/history/trafficAggregator'

const HOUR_MS = 60 * 60 * 1000

describe('traffic trend availability', () => {
  test('blocks requests only when server-side recording is disabled', () => {
    expect(resolveConfiguredTrafficTrendAvailability({
      recordEnabled: false,
      recordPreserveHours: 720,
      window: { startMs: 0, endMs: 5 * 24 * HOUR_MS },
    })).toBe('recording-disabled')
  })

  test('compares configured retention with the exact queried window', () => {
    const window = { startMs: 1_000, endMs: 1_000 + 121 * HOUR_MS }

    expect(resolveConfiguredTrafficTrendAvailability({
      recordEnabled: true,
      recordPreserveHours: 120,
      window,
    })).toBe('retention-insufficient')
    expect(resolveConfiguredTrafficTrendAvailability({
      recordEnabled: true,
      recordPreserveHours: 121,
      window,
    })).toBe('available')
  })

  test.each([
    ['2026-03-08', 23],
    ['2026-11-01', 25],
  ])('honors the %s New York natural day length', (date, requiredHours) => {
    const day = buildZonedDayWindow(date, 'America/New_York', Date.parse(`${date}T23:59:59Z`))
    const window = { startMs: day.startMs, endMs: day.endMs }

    expect((window.endMs - window.startMs) / HOUR_MS).toBe(requiredHours)
    expect(resolveConfiguredTrafficTrendAvailability({
      recordEnabled: true,
      recordPreserveHours: requiredHours - 1,
      window,
    })).toBe('retention-insufficient')
    expect(resolveConfiguredTrafficTrendAvailability({
      recordEnabled: true,
      recordPreserveHours: requiredHours,
      window,
    })).toBe('available')
  })

  test('uses metrics retention as the completed-query source of truth', () => {
    const window = { startMs: 0, endMs: 5 * 24 * HOUR_MS }

    expect(resolveMetricTrafficTrendAvailability({
      recordEnabled: true,
      retentionDays: 4,
      window,
    })).toBe('retention-insufficient')
    expect(resolveMetricTrafficTrendAvailability({
      recordEnabled: true,
      retentionDays: 5,
      window,
    })).toBe('available')
    expect(resolveMetricTrafficTrendAvailability({
      recordEnabled: false,
      retentionDays: 30,
      window,
    })).toBe('recording-disabled')
  })
})
