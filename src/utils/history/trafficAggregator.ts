export type AnalyticsTimeZone = 'browser' | 'UTC' | string
export type TrafficSource = 'metric-delta' | 'counter-diff' | 'mixed'
export type TrafficQuality = 'complete' | 'partial' | 'estimated' | 'missing'
export type TrafficReason
  = | 'sampled-delta-rejected'
    | 'invalid-evidence-rejected'
    | 'cross-day-interval-rejected'
    | 'overlapping-delta-rejected'
    | 'counter-overlap-rejected'
    | 'conflicting-counter-reading'
    | 'counter-reset'
    | 'no-data'

export interface TrafficDeltaEvidence {
  startMs: number
  endMs: number
  uploadBytes: number | null
  downloadBytes: number | null
  sampling: 'authoritative' | 'sampled'
  coverage?: 'interval' | 'point'
}

export interface TrafficCounterReading {
  atMs: number
  uploadBytes: number | null
  downloadBytes: number | null
}

export interface AggregateDailyTrafficInput {
  timeZone: AnalyticsTimeZone
  dates: string[]
  nowMs?: number
  browserTimeZone?: string
  deltas?: TrafficDeltaEvidence[]
  counters?: TrafficCounterReading[]
}

export interface ZonedDayWindow {
  date: string
  timeZone: string
  startMs: number
  endMs: number
  durationMs: number
  effectiveEndMs: number
  effectiveDurationMs: number
  isInProgress: boolean
}

export interface DailyTrafficAggregate extends ZonedDayWindow {
  uploadBytes: number | null
  downloadBytes: number | null
  source: TrafficSource | null
  quality: TrafficQuality
  coverage: number
  firstRecordAtMs: number | null
  lastRecordAtMs: number | null
  maxGapMs: number | null
  resetCount: number
  reasons: TrafficReason[]
}

interface CivilDate {
  year: number
  month: number
  day: number
}

interface AcceptedInterval {
  startMs: number
  endMs: number
  uploadBytes: number | null
  downloadBytes: number | null
  source: Exclude<TrafficSource, 'mixed'>
  reset: boolean
  coverage: 'interval' | 'point'
}

interface DayState {
  window: ZonedDayWindow
  intervals: AcceptedInterval[]
  reasons: Set<TrafficReason>
}

const DAY_MS = 24 * 60 * 60 * 1000
const SEARCH_PADDING_MS = 48 * 60 * 60 * 1000
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const formatters = new Map<string, Intl.DateTimeFormat>()
const boundaryCache = new Map<string, number>()

function getDateFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone)
  if (cached)
    return cached

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  formatters.set(timeZone, formatter)
  return formatter
}

function parseDate(date: string): CivilDate {
  const match = DATE_PATTERN.exec(date)
  if (!match)
    throw new RangeError(`Invalid Gregorian date: ${date}`)

  const civil = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }
  const check = new Date(Date.UTC(civil.year, civil.month - 1, civil.day))
  if (
    check.getUTCFullYear() !== civil.year
    || check.getUTCMonth() + 1 !== civil.month
    || check.getUTCDate() !== civil.day
  ) {
    throw new RangeError(`Invalid Gregorian date: ${date}`)
  }
  return civil
}

function civilOrdinal(civil: CivilDate): number {
  return Date.UTC(civil.year, civil.month - 1, civil.day) / DAY_MS
}

function civilAt(epochMs: number, timeZone: string): CivilDate {
  const parts = getDateFormatter(timeZone).formatToParts(new Date(epochMs))
  const values = new Map(parts.map(part => [part.type, part.value]))
  return {
    year: Number(values.get('year')),
    month: Number(values.get('month')),
    day: Number(values.get('day')),
  }
}

function addCivilDays(civil: CivilDate, days: number): CivilDate {
  const value = new Date(Date.UTC(civil.year, civil.month - 1, civil.day + days))
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  }
}

function formatCivil(civil: CivilDate): string {
  return `${civil.year.toString().padStart(4, '0')}-${civil.month.toString().padStart(2, '0')}-${civil.day.toString().padStart(2, '0')}`
}

function zonedDateBoundary(civil: CivilDate, timeZone: string): number {
  const cacheKey = `${timeZone}:${formatCivil(civil)}`
  const cached = boundaryCache.get(cacheKey)
  if (cached !== undefined)
    return cached

  const targetOrdinal = civilOrdinal(civil)
  const utcGuess = Date.UTC(civil.year, civil.month - 1, civil.day)
  let low = utcGuess - SEARCH_PADDING_MS
  let high = utcGuess + SEARCH_PADDING_MS

  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (civilOrdinal(civilAt(middle, timeZone)) >= targetOrdinal)
      high = middle
    else
      low = middle + 1
  }

  if (civilOrdinal(civilAt(low, timeZone)) !== targetOrdinal)
    throw new RangeError(`Natural day ${formatCivil(civil)} does not exist in ${timeZone}`)

  boundaryCache.set(cacheKey, low)
  return low
}

function isFiniteNonNegative(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0
}

function isValidInterval(interval: Pick<AcceptedInterval, 'startMs' | 'endMs'>): boolean {
  return Number.isFinite(interval.startMs)
    && Number.isFinite(interval.endMs)
    && interval.startMs < interval.endMs
}

function overlaps(left: AcceptedInterval, right: AcceptedInterval): boolean {
  return left.startMs < right.endMs && right.startMs < left.endMs
}

function findContainingDay(states: DayState[], startMs: number, endMs: number): DayState | undefined {
  return states.find(({ window }) => startMs >= window.startMs && endMs <= window.effectiveEndMs)
}

function markCrossDay(states: DayState[], startMs: number, endMs: number): void {
  for (const state of states) {
    if (startMs < state.window.effectiveEndMs && state.window.startMs < endMs)
      state.reasons.add('cross-day-interval-rejected')
  }
}

function markIntervalReason(
  states: DayState[],
  startMs: number,
  endMs: number,
  reason: TrafficReason,
): void {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
    for (const state of states)
      state.reasons.add(reason)
    return
  }
  for (const state of states) {
    if (startMs < state.window.effectiveEndMs && state.window.startMs < endMs)
      state.reasons.add(reason)
  }
}

function mergeRanges(intervals: AcceptedInterval[]): Array<{ startMs: number, endMs: number }> {
  const ranges = intervals
    .map(({ startMs, endMs }) => ({ startMs, endMs }))
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)
  const merged: Array<{ startMs: number, endMs: number }> = []

  for (const range of ranges) {
    const previous = merged.at(-1)
    if (previous && range.startMs <= previous.endMs)
      previous.endMs = Math.max(previous.endMs, range.endMs)
    else
      merged.push({ ...range })
  }
  return merged
}

function summarizeCoverage(
  intervals: AcceptedInterval[],
  window: ZonedDayWindow,
): { coverage: number, maxGapMs: number | null } {
  const ranges = mergeRanges(intervals)
  const coveredMs = ranges.reduce((total, range) => total + range.endMs - range.startMs, 0)
  const coverage = window.effectiveDurationMs > 0
    ? Math.min(1, coveredMs / window.effectiveDurationMs)
    : 0

  if (window.effectiveDurationMs <= 0)
    return { coverage, maxGapMs: null }

  let cursor = window.startMs
  let maxGapMs = 0
  for (const range of ranges) {
    maxGapMs = Math.max(maxGapMs, range.startMs - cursor)
    cursor = Math.max(cursor, range.endMs)
  }
  maxGapMs = Math.max(maxGapMs, window.effectiveEndMs - cursor)
  return { coverage, maxGapMs }
}

function summarize(state: DayState): DailyTrafficAggregate {
  const { window, intervals, reasons } = state
  const hasUpload = intervals.some(interval => interval.uploadBytes !== null)
  const hasDownload = intervals.some(interval => interval.downloadBytes !== null)
  const uploadBytes = hasUpload
    ? intervals.reduce((total, interval) => total + (interval.uploadBytes ?? 0), 0)
    : null
  const downloadBytes = hasDownload
    ? intervals.reduce((total, interval) => total + (interval.downloadBytes ?? 0), 0)
    : null
  const ranges = mergeRanges(intervals)
  const uploadCoverage = summarizeCoverage(intervals.filter(interval =>
    interval.uploadBytes !== null && interval.coverage === 'interval'), window)
  const downloadCoverage = summarizeCoverage(intervals.filter(interval =>
    interval.downloadBytes !== null && interval.coverage === 'interval'), window)
  const coverage = Math.min(uploadCoverage.coverage, downloadCoverage.coverage)
  const directionalGaps = [uploadCoverage.maxGapMs, downloadCoverage.maxGapMs]
    .filter((gap): gap is number => gap !== null)
  const maxGapMs = directionalGaps.length > 0 ? Math.max(...directionalGaps) : null

  const sources = new Set(intervals.map(interval => interval.source))
  const source: TrafficSource | null = sources.size === 2
    ? 'mixed'
    : (sources.values().next().value ?? null)
  if (!intervals.length)
    reasons.add('no-data')

  let quality: TrafficQuality
  if (!intervals.length || (!hasUpload && !hasDownload))
    quality = 'missing'
  else if (sources.has('counter-diff'))
    quality = 'estimated'
  else if (coverage === 1 && hasUpload && hasDownload && reasons.size === 0)
    quality = 'complete'
  else
    quality = 'partial'

  return {
    ...window,
    uploadBytes,
    downloadBytes,
    source,
    quality,
    coverage,
    firstRecordAtMs: ranges[0]?.startMs ?? null,
    lastRecordAtMs: ranges.at(-1)?.endMs ?? null,
    maxGapMs,
    resetCount: intervals.filter(interval => interval.reset).length,
    reasons: [...reasons],
  }
}

export function resolveAnalyticsTimeZone(
  timeZone: AnalyticsTimeZone,
  browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const resolved = timeZone === 'browser' ? browserTimeZone : timeZone
  if (!resolved)
    throw new RangeError('Browser time zone could not be resolved')

  getDateFormatter(resolved).format(0)
  return resolved
}

export function buildRecentNaturalDayKeys(
  count: number,
  timeZone: AnalyticsTimeZone = 'browser',
  nowMs = Date.now(),
  browserTimeZone?: string,
): string[] {
  if (!Number.isInteger(count) || count < 0)
    throw new RangeError('count must be a non-negative integer')
  if (!Number.isFinite(nowMs))
    throw new RangeError('nowMs must be finite')

  const resolvedTimeZone = resolveAnalyticsTimeZone(timeZone, browserTimeZone)
  const today = civilAt(nowMs, resolvedTimeZone)
  return Array.from({ length: count }, (_, index) => {
    return formatCivil(addCivilDays(today, index - count + 1))
  })
}

export function buildZonedDayWindow(
  date: string,
  timeZone: AnalyticsTimeZone,
  nowMs = Date.now(),
  browserTimeZone?: string,
): ZonedDayWindow {
  if (!Number.isFinite(nowMs))
    throw new RangeError('nowMs must be finite')

  const resolvedTimeZone = resolveAnalyticsTimeZone(timeZone, browserTimeZone)
  const civil = parseDate(date)
  const startMs = zonedDateBoundary(civil, resolvedTimeZone)
  const endMs = zonedDateBoundary(addCivilDays(civil, 1), resolvedTimeZone)
  const effectiveEndMs = Math.min(endMs, Math.max(startMs, nowMs))

  return {
    date,
    timeZone: resolvedTimeZone,
    startMs,
    endMs,
    durationMs: endMs - startMs,
    effectiveEndMs,
    effectiveDurationMs: effectiveEndMs - startMs,
    isInProgress: nowMs >= startMs && nowMs < endMs,
  }
}

export function aggregateDailyTraffic(input: AggregateDailyTrafficInput): DailyTrafficAggregate[] {
  const nowMs = input.nowMs ?? Date.now()
  const timeZone = resolveAnalyticsTimeZone(input.timeZone, input.browserTimeZone)
  const states = input.dates.map(date => ({
    window: buildZonedDayWindow(date, timeZone, nowMs),
    intervals: [],
    reasons: new Set<TrafficReason>(),
  }))

  const deltas = [...(input.deltas ?? [])].sort((left, right) => left.startMs - right.startMs)
  for (const delta of deltas) {
    const uploadValid = delta.uploadBytes === null || isFiniteNonNegative(delta.uploadBytes)
    const downloadValid = delta.downloadBytes === null || isFiniteNonNegative(delta.downloadBytes)
    const hasValue = delta.uploadBytes !== null || delta.downloadBytes !== null
    const valuesValid = uploadValid && downloadValid && hasValue
    if (!isValidInterval(delta) || !valuesValid) {
      markIntervalReason(states, delta.startMs, delta.endMs, 'invalid-evidence-rejected')
      continue
    }
    if (delta.sampling === 'sampled') {
      for (const state of states) {
        if (delta.startMs < state.window.effectiveEndMs && state.window.startMs < delta.endMs)
          state.reasons.add('sampled-delta-rejected')
      }
      continue
    }

    const state = findContainingDay(states, delta.startMs, delta.endMs)
    if (!state) {
      markCrossDay(states, delta.startMs, delta.endMs)
      continue
    }
    const interval: AcceptedInterval = {
      ...delta,
      source: 'metric-delta',
      reset: false,
      coverage: delta.coverage ?? 'interval',
    }
    if (state.intervals.some(existing => overlaps(existing, interval))) {
      state.reasons.add('overlapping-delta-rejected')
      continue
    }
    state.intervals.push(interval)
  }

  const sortedCounters = [...(input.counters ?? [])]
    .filter(counter => Number.isFinite(counter.atMs))
    .sort((left, right) => left.atMs - right.atMs)
  const counters: Array<TrafficCounterReading & { conflict: boolean }> = []
  for (const counter of sortedCounters) {
    const previous = counters.at(-1)
    if (!previous || previous.atMs !== counter.atMs) {
      counters.push({ ...counter, conflict: false })
      continue
    }
    if (previous.uploadBytes !== counter.uploadBytes || previous.downloadBytes !== counter.downloadBytes)
      previous.conflict = true
  }
  for (let index = 1; index < counters.length; index += 1) {
    const previous = counters[index - 1]!
    const current = counters[index]!
    if (previous.atMs === current.atMs)
      continue
    if (previous.conflict || current.conflict) {
      markIntervalReason(states, previous.atMs, current.atMs, 'conflicting-counter-reading')
      continue
    }

    const previousUpload = previous.uploadBytes
    const currentUpload = current.uploadBytes
    const previousDownload = previous.downloadBytes
    const currentDownload = current.downloadBytes
    const uploadValid = isFiniteNonNegative(previousUpload) && isFiniteNonNegative(currentUpload)
    const downloadValid = isFiniteNonNegative(previousDownload) && isFiniteNonNegative(currentDownload)
    if (!uploadValid && !downloadValid)
      continue

    const uploadReset = uploadValid && currentUpload < previousUpload
    const downloadReset = downloadValid && currentDownload < previousDownload
    const interval: AcceptedInterval = {
      startMs: previous.atMs,
      endMs: current.atMs,
      uploadBytes: uploadValid
        ? (uploadReset ? currentUpload : currentUpload - previousUpload)
        : null,
      downloadBytes: downloadValid
        ? (downloadReset ? currentDownload : currentDownload - previousDownload)
        : null,
      source: 'counter-diff',
      reset: uploadReset || downloadReset,
      coverage: 'interval',
    }
    const state = findContainingDay(states, interval.startMs, interval.endMs)
    if (!state) {
      markCrossDay(states, interval.startMs, interval.endMs)
      continue
    }
    if (state.intervals.some(existing => overlaps(existing, interval))) {
      state.reasons.add('counter-overlap-rejected')
      continue
    }
    state.intervals.push(interval)
    if (interval.reset)
      state.reasons.add('counter-reset')
  }

  return states.map(summarize)
}
