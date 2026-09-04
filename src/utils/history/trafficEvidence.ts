import type { TrafficHistoryResult } from './gateway'
import type { TrafficCounterReading, TrafficDeltaEvidence } from './trafficAggregator'
import type { NormalizedMetricSeries, RawStatusRecord } from './types'

export interface TrafficEvidenceWindow {
  startMs: number
  endMs: number
}

export interface EntityTrafficEvidence {
  entityId: string
  deltas: TrafficDeltaEvidence[]
  counters: TrafficCounterReading[]
}

export interface LegacyEvidenceOptions {
  sampled: boolean
  window?: TrafficEvidenceWindow
}

interface MutableEntityEvidence extends EntityTrafficEvidence {
  deltaByInterval: Map<string, TrafficDeltaEvidence>
  metricContributions: Map<string, number | null>
}

function createEntityEvidence(entityId: string): MutableEntityEvidence {
  return {
    entityId,
    deltas: [],
    counters: [],
    deltaByInterval: new Map(),
    metricContributions: new Map(),
  }
}

function getEntityEvidence(
  entities: Map<string, MutableEntityEvidence>,
  entityId: string,
): MutableEntityEvidence {
  const existing = entities.get(entityId)
  if (existing)
    return existing

  const created = createEntityEvidence(entityId)
  entities.set(entityId, created)
  return created
}

function finishEvidence(entities: Map<string, MutableEntityEvidence>): EntityTrafficEvidence[] {
  return Array.from(entities.values(), ({ entityId, deltas, counters }) => ({
    entityId,
    deltas: deltas.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs),
    counters: counters.sort((left, right) => left.atMs - right.atMs),
  }))
    .sort((left, right) => left.entityId.localeCompare(right.entityId))
}

function addMetricValue(
  evidence: MutableEntityEvidence,
  metricKey: NormalizedMetricSeries['metricKey'],
  startMs: number,
  endMs: number,
  value: number,
  tags: Record<string, string>,
): void {
  const intervalKey = `${startMs}:${endMs}`
  const tagKey = JSON.stringify(Object.entries(tags)
    .sort(([left], [right]) => left.localeCompare(right)))
  const contributionKey = `${metricKey}:${intervalKey}:${tagKey}`
  let delta = evidence.deltaByInterval.get(intervalKey)
  if (evidence.metricContributions.has(contributionKey)) {
    const previousValue = evidence.metricContributions.get(contributionKey)
    if (previousValue === value || previousValue === null)
      return
    evidence.metricContributions.set(contributionKey, null)
    if (delta) {
      if (metricKey === 'traffic.up')
        delta.uploadBytes = Number.NaN
      else
        delta.downloadBytes = Number.NaN
    }
    return
  }
  evidence.metricContributions.set(contributionKey, value)

  if (!delta) {
    delta = {
      startMs,
      endMs,
      uploadBytes: null,
      downloadBytes: null,
      sampling: 'authoritative',
    }
    evidence.deltaByInterval.set(intervalKey, delta)
    evidence.deltas.push(delta)
  }

  if (metricKey === 'traffic.up')
    delta.uploadBytes = (delta.uploadBytes ?? 0) + value
  else
    delta.downloadBytes = (delta.downloadBytes ?? 0) + value
}

export function metricsToTrafficEvidence(
  series: NormalizedMetricSeries[],
  window: TrafficEvidenceWindow,
): EntityTrafficEvidence[] {
  if (!Number.isFinite(window.startMs) || !Number.isFinite(window.endMs) || window.startMs >= window.endMs)
    throw new RangeError('Traffic evidence window must be a finite, increasing range')

  const entities = new Map<string, MutableEntityEvidence>()
  for (const metricSeries of series) {
    const evidence = getEntityEvidence(entities, metricSeries.entityId)
    if (metricSeries.downsampled && metricSeries.aggregation !== 'sum')
      continue
    const intervalMs = (metricSeries.intervalSeconds ?? 0) * 1000
    if (Number.isFinite(intervalMs) && intervalMs > 0) {
      for (const point of metricSeries.points) {
        if (point.value === null)
          continue

        const startMs = Date.parse(point.time)
        const endMs = startMs + intervalMs
        if (!Number.isFinite(startMs) || startMs < window.startMs || endMs > window.endMs)
          continue

        const tags = point.tags && Object.keys(point.tags).length > 0 ? point.tags : (metricSeries.tags ?? {})
        addMetricValue(evidence, metricSeries.metricKey, startMs, endMs, point.value, tags)
      }
      continue
    }

    if (metricSeries.downsampled)
      continue

    const points = metricSeries.points
      .map(point => ({ point, atMs: Date.parse(point.time) }))
      .filter(entry => Number.isFinite(entry.atMs))
      .sort((left, right) => left.atMs - right.atMs)
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1]!
      const current = points[index]!
      if (current.point.value === null
        || previous.atMs < window.startMs
        || current.atMs > window.endMs
        || previous.atMs >= current.atMs) {
        continue
      }
      const tags = current.point.tags && Object.keys(current.point.tags).length > 0
        ? current.point.tags
        : (metricSeries.tags ?? {})
      addMetricValue(evidence, metricSeries.metricKey, previous.atMs, current.atMs, current.point.value, tags)
    }
  }

  return finishEvidence(entities)
}

function isFiniteNonNegative(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0
}

function counterChanged(previous: TrafficCounterReading, current: TrafficCounterReading): boolean {
  return (isFiniteNonNegative(previous.uploadBytes)
    && isFiniteNonNegative(current.uploadBytes)
    && previous.uploadBytes !== current.uploadBytes)
  || (isFiniteNonNegative(previous.downloadBytes)
    && isFiniteNonNegative(current.downloadBytes)
    && previous.downloadBytes !== current.downloadBytes)
}

function counterDirectionChanged(previous: number | null, current: number | null): boolean {
  return isFiniteNonNegative(previous) && isFiniteNonNegative(current) && previous !== current
}

export function recordsToTrafficEvidence(
  records: Record<string, RawStatusRecord[]>,
  options: LegacyEvidenceOptions,
): EntityTrafficEvidence[] {
  const entities = new Map<string, MutableEntityEvidence>()

  for (const [entityId, entityRecords] of Object.entries(records)) {
    const evidence = getEntityEvidence(entities, entityId)
    const ordered = entityRecords
      .map(record => ({ record, atMs: Date.parse(record.time) }))
      .filter((entry): entry is { record: RawStatusRecord, atMs: number } => Number.isFinite(entry.atMs))
      .filter(entry => !options.window
        || (entry.atMs >= options.window.startMs && entry.atMs < options.window.endMs))
      .sort((left, right) => left.atMs - right.atMs)

    for (const { record, atMs } of ordered) {
      const counter: TrafficCounterReading = {
        atMs,
        uploadBytes: typeof record.net_total_up === 'number' ? record.net_total_up : null,
        downloadBytes: typeof record.net_total_down === 'number' ? record.net_total_down : null,
      }
      if (counter.uploadBytes !== null || counter.downloadBytes !== null)
        evidence.counters.push(counter)
    }

    const candidateDeltas: TrafficDeltaEvidence[] = []
    let unreliableDeltaFound = false
    for (let index = 0; index < ordered.length; index += 1) {
      const current = ordered[index]!
      const uploadBytes = typeof current.record.traffic_up === 'number' ? current.record.traffic_up : null
      const downloadBytes = typeof current.record.traffic_down === 'number' ? current.record.traffic_down : null
      if (uploadBytes !== null || downloadBytes !== null) {
        candidateDeltas.push({
          startMs: current.atMs,
          endMs: current.atMs + 1,
          uploadBytes,
          downloadBytes,
          sampling: options.sampled ? 'sampled' : 'authoritative',
          coverage: 'point',
        })
      }

      if (index === 0)
        continue
      const previousRecord = ordered[index - 1]!.record
      const previousUpload = typeof previousRecord.net_total_up === 'number' ? previousRecord.net_total_up : null
      const currentUpload = typeof current.record.net_total_up === 'number' ? current.record.net_total_up : null
      const previousDownload = typeof previousRecord.net_total_down === 'number' ? previousRecord.net_total_down : null
      const currentDownload = typeof current.record.net_total_down === 'number' ? current.record.net_total_down : null
      unreliableDeltaFound = unreliableDeltaFound
        || ((uploadBytes === null || uploadBytes === 0)
          && counterDirectionChanged(previousUpload, currentUpload))
        || ((downloadBytes === null || downloadBytes === 0)
          && counterDirectionChanged(previousDownload, currentDownload))
    }

    const hasCounterMovement = evidence.counters.some((counter, index) => index > 0
      && counterChanged(evidence.counters[index - 1]!, counter))
    const useDeltas = candidateDeltas.length > 0
      && (options.sampled || !unreliableDeltaFound || !hasCounterMovement)
    if (useDeltas)
      evidence.deltas.push(...candidateDeltas)
    if (useDeltas && !options.sampled)
      evidence.counters = []
  }

  return finishEvidence(entities)
}

export function historyResultToTrafficEvidence(
  result: TrafficHistoryResult,
  window: TrafficEvidenceWindow,
): EntityTrafficEvidence[] {
  if (result.kind === 'metrics')
    return metricsToTrafficEvidence(result.series, window)
  return recordsToTrafficEvidence(result.records, { sampled: result.sampled, window })
}
