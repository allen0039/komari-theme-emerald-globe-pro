export type TrafficTrendAvailability = 'available' | 'recording-disabled' | 'retention-insufficient'

export interface TrafficTrendAvailabilityWindow {
  startMs: number
  endMs: number
}

interface ConfiguredTrafficTrendAvailabilityInput {
  recordEnabled: boolean | undefined
  recordPreserveHours: number | undefined
  window: TrafficTrendAvailabilityWindow
}

interface MetricTrafficTrendAvailabilityInput {
  recordEnabled: boolean | undefined
  retentionDays: number | null
  window: TrafficTrendAvailabilityWindow
}

const HOUR_MS = 60 * 60 * 1000

function hasEnoughRetention(retentionMs: number | null, window: TrafficTrendAvailabilityWindow): boolean {
  if (retentionMs === null)
    return true
  const requestedDurationMs = window.endMs - window.startMs
  return Number.isFinite(requestedDurationMs) && requestedDurationMs >= 0 && retentionMs >= requestedDurationMs
}

function isRecordingDisabled(recordEnabled: boolean | undefined): boolean {
  return recordEnabled === false
}

export function resolveConfiguredTrafficTrendAvailability(
  input: ConfiguredTrafficTrendAvailabilityInput,
): TrafficTrendAvailability {
  if (isRecordingDisabled(input.recordEnabled))
    return 'recording-disabled'

  const retentionMs = typeof input.recordPreserveHours === 'number' && Number.isFinite(input.recordPreserveHours)
    ? Math.max(0, input.recordPreserveHours) * HOUR_MS
    : null
  return hasEnoughRetention(retentionMs, input.window) ? 'available' : 'retention-insufficient'
}

export function resolveMetricTrafficTrendAvailability(
  input: MetricTrafficTrendAvailabilityInput,
): TrafficTrendAvailability {
  if (isRecordingDisabled(input.recordEnabled))
    return 'recording-disabled'

  const retentionMs = input.retentionDays === null || !Number.isFinite(input.retentionDays)
    ? null
    : Math.max(0, input.retentionDays) * 24 * HOUR_MS
  return hasEnoughRetention(retentionMs, input.window) ? 'available' : 'retention-insufficient'
}
