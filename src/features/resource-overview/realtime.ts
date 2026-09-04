import type { NodeData, TrafficLimitType } from '@/stores/nodes'
import { getCountryCodeFromRegion } from '@/utils/geoHelper'
import { parseNodeGroups } from '@/utils/groupHelper'
import { formatBytes, formatBytesPerSecond, getStatus } from '@/utils/helper'
import { calculateTrafficUsed } from '@/utils/nodeHelpers'
import { getEmojiByCode, getRegionDisplayName } from '@/utils/regionHelper'

export type PressureMetric = 'cpu' | 'memory' | 'disk'
export type PressureStatus = 'normal' | 'warning' | 'critical' | 'offline' | 'unknown'
export type QuotaStatus = 'normal' | 'warning' | 'critical' | 'reached' | 'exceeded' | 'offline' | 'no-limit' | 'invalid' | 'unobserved'
export type QuotaRangeMode = 'top-10' | 'all'
export type QuotaGroupFilter = { kind: 'all' } | { kind: 'named', value: string } | { kind: 'ungrouped' }
export type QuotaRegionFilter
  = | { kind: 'all' }
    | { kind: 'iso', code: string }
    | { kind: 'raw', value: string }
    | { kind: 'unassigned' }

export interface RuntimeSummaryViewModel {
  total: number
  online: number
  offline: number
  unobserved: number
  pressureAttention: number
  unknownPressure: number
  invalidTrafficSamples: number
  trafficAggregateInvalid: boolean
  netIn: number
  netOut: number
  totalTraffic: number | null
  formattedTraffic: string
  formattedNetIn: string
  formattedNetOut: string
}

export interface LiveTrafficRowViewModel {
  uuid: string
  name: string
  online: true
  download: number
  upload: number
  total: number
  sharePercentage: number | null
  formattedDownload: string
  formattedUpload: string
  downloadVisualPercentage: number
  uploadVisualPercentage: number
}

export interface LiveTrafficViewModel {
  totalTraffic: number | null
  formattedTotalTraffic: string
  rows: LiveTrafficRowViewModel[]
}

export interface PressureRowViewModel {
  uuid: string
  name: string
  online: boolean
  percentage: number | null
  formattedPercentage: string
  status: PressureStatus
  statusLabel: string
  visualPercentage: number
}

export interface PressureMatrixCellViewModel {
  metric: PressureMetric
  label: string
  percentage: number | null
  formattedPercentage: string
  status: PressureStatus
  statusLabel: string
}

export interface PressureMatrixRowViewModel {
  uuid: string
  name: string
  online: boolean
  statusObserved: boolean
  peakPercentage: number | null
  cells: PressureMatrixCellViewModel[]
}

export interface QuotaRowViewModel {
  uuid: string
  name: string
  online: boolean
  group: string
  region: string
  used: number | null
  limit: number | null
  percentage: number | null
  visualPercentage: number
  formattedUsed: string
  formattedLimit: string
  status: QuotaStatus
  statusLabel: string
}

export interface QuotaFilterSelection {
  group?: QuotaGroupFilter
  region?: QuotaRegionFilter
}

interface FilterOption<TFilter> {
  key: string
  label: string
  filter: TFilter
}

const TRAFFIC_LIMIT_TYPES = new Set<TrafficLimitType>(['up', 'down', 'min', 'max', 'sum'])

function nonNegativeFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function roundPercentage(value: number): number {
  return Math.round(value * 100) / 100
}

function finiteSum(a: number, b: number): number | null {
  const sum = a + b
  return Number.isFinite(sum) && sum >= 0 ? sum : null
}

function compareIdentity(a: Pick<NodeData, 'name' | 'uuid'>, b: Pick<NodeData, 'name' | 'uuid'>): number {
  return compareText(a.name, b.name) || compareText(a.uuid, b.uuid)
}

function compareText(a: string, b: string): number {
  if (a === b)
    return 0
  return a < b ? -1 : 1
}

function pressurePercentage(node: NodeData, metric: PressureMetric): number | null {
  if (metric === 'cpu') {
    const cpu = nonNegativeFinite(node.cpu)
    return cpu !== null && cpu <= 100 ? cpu : null
  }

  const used = nonNegativeFinite(metric === 'memory' ? node.ram : node.disk)
  const total = nonNegativeFinite(metric === 'memory' ? node.mem_total : node.disk_total)
  if (used === null || total === null || total === 0 || used > total)
    return null

  return (used / total) * 100
}

function pressureStatus(percentage: number | null, node: NodeData): PressureStatus {
  if (!node.statusObserved)
    return 'unknown'
  if (!node.online)
    return 'offline'
  if (percentage === null)
    return 'unknown'

  const status = getStatus(percentage)
  if (status === 'error')
    return 'critical'
  return status === 'warning' ? 'warning' : 'normal'
}

function pressureStatusLabel(status: PressureStatus): string {
  const labels: Record<PressureStatus, string> = {
    normal: '正常',
    warning: '需关注',
    critical: '高压力',
    offline: '离线',
    unknown: '数据未知',
  }
  return labels[status]
}

function quotaStatus(percentage: number, online: boolean): QuotaStatus {
  if (!online)
    return 'offline'
  if (percentage > 100)
    return 'exceeded'
  if (percentage === 100)
    return 'reached'

  const status = getStatus(percentage)
  if (status === 'error')
    return 'critical'
  return status === 'warning' ? 'warning' : 'normal'
}

function quotaStatusLabel(status: QuotaStatus): string {
  const labels: Record<QuotaStatus, string> = {
    'normal': '正常',
    'warning': '需关注',
    'critical': '接近额度',
    'reached': '已达额度',
    'exceeded': '已超额度',
    'offline': '离线',
    'no-limit': '未设置额度',
    'invalid': '计数异常',
    'unobserved': '未收到状态',
  }
  return labels[status]
}

function buildQuotaRow(node: NodeData): QuotaRowViewModel {
  if (!node.statusObserved)
    return invalidQuotaRow(node, '未收到状态', 'unobserved')

  const limit = nonNegativeFinite(node.traffic_limit)
  if (limit === null) {
    return invalidQuotaRow(node, '额度异常')
  }
  if (limit === 0) {
    const statusLabel = node.online ? '未设置额度' : '离线 · 未设置额度'
    return {
      ...quotaRowBase(node),
      used: null,
      limit: null,
      percentage: null,
      visualPercentage: 0,
      formattedUsed: '—',
      formattedLimit: '未设置',
      status: 'no-limit',
      statusLabel,
    }
  }

  const runtimeType = node.traffic_limit_type as string
  if (!TRAFFIC_LIMIT_TYPES.has(runtimeType as TrafficLimitType))
    return invalidQuotaRow(node, '额度类型未知')

  const needsUpload = runtimeType !== 'down'
  const needsDownload = runtimeType !== 'up'
  const upload = needsUpload ? nonNegativeFinite(node.net_total_up) : 0
  const download = needsDownload ? nonNegativeFinite(node.net_total_down) : 0
  if (upload === null || download === null)
    return invalidQuotaRow(node, '计数异常')

  const used = calculateTrafficUsed(upload, download, runtimeType as TrafficLimitType)
  if (!Number.isFinite(used) || used < 0)
    return invalidQuotaRow(node, '计数异常')
  const percentage = (used / limit) * 100
  if (!Number.isFinite(percentage) || percentage < 0)
    return invalidQuotaRow(node, '比例异常')
  const status = quotaStatus(percentage, node.online)

  return {
    ...quotaRowBase(node),
    used,
    limit,
    percentage,
    visualPercentage: Math.min(percentage, 100),
    formattedUsed: formatBytes(used),
    formattedLimit: formatBytes(limit),
    status,
    statusLabel: quotaStatusLabel(status),
  }
}

function quotaRowBase(node: NodeData): Pick<QuotaRowViewModel, 'uuid' | 'name' | 'online' | 'group' | 'region'> {
  return {
    uuid: node.uuid,
    name: node.name,
    online: node.online,
    group: node.group,
    region: node.region,
  }
}

function invalidQuotaRow(node: NodeData, statusLabel: string, status: 'invalid' | 'unobserved' = 'invalid'): QuotaRowViewModel {
  const combinedStatusLabel = node.online || status === 'unobserved' ? statusLabel : `离线 · ${statusLabel}`
  return {
    ...quotaRowBase(node),
    used: null,
    limit: null,
    percentage: null,
    visualPercentage: 0,
    formattedUsed: '—',
    formattedLimit: '—',
    status,
    statusLabel: combinedStatusLabel,
  }
}

function quotaSortGroup(row: QuotaRowViewModel): number {
  if (row.percentage !== null && row.online)
    return 0
  if (row.percentage !== null)
    return 1
  return 2
}

export function buildRuntimeSummary(nodes: readonly NodeData[]): RuntimeSummaryViewModel {
  let online = 0
  let offline = 0
  let unobserved = 0
  let pressureAttention = 0
  let unknownPressure = 0
  let invalidTrafficSamples = 0
  let netIn = 0
  let netOut = 0

  for (const node of nodes) {
    if (!node.statusObserved) {
      unobserved += 1
      continue
    }
    if (!node.online) {
      offline += 1
      continue
    }

    online += 1
    const nodeNetIn = nonNegativeFinite(node.net_in)
    const nodeNetOut = nonNegativeFinite(node.net_out)
    const nextNetIn = nodeNetIn === null ? null : finiteSum(netIn, nodeNetIn)
    const nextNetOut = nodeNetOut === null ? null : finiteSum(netOut, nodeNetOut)
    if (nextNetIn === null || nextNetOut === null) {
      invalidTrafficSamples += 1
    }
    else {
      netIn = nextNetIn
      netOut = nextNetOut
    }

    const pressures = (['cpu', 'memory', 'disk'] as const).map(metric => pressurePercentage(node, metric))
    if (pressures.includes(null))
      unknownPressure += 1
    if (pressures.some(value => value !== null && value >= 60))
      pressureAttention += 1
  }

  const totalTraffic = finiteSum(netIn, netOut)
  return {
    total: nodes.length,
    online,
    offline,
    unobserved,
    pressureAttention,
    unknownPressure,
    invalidTrafficSamples,
    trafficAggregateInvalid: totalTraffic === null,
    netIn,
    netOut,
    totalTraffic,
    formattedTraffic: totalTraffic === null ? '数据异常' : formatBytesPerSecond(totalTraffic),
    formattedNetIn: formatBytesPerSecond(netIn),
    formattedNetOut: formatBytesPerSecond(netOut),
  }
}

export function buildLiveTrafficViewModel(nodes: readonly NodeData[], limit = 5): LiveTrafficViewModel {
  const onlineNodes = nodes.filter(node => node.statusObserved && node.online)
  const candidates = onlineNodes
    .map(node => ({
      node,
      download: nonNegativeFinite(node.net_in),
      upload: nonNegativeFinite(node.net_out),
    }))
    .filter((item): item is { node: NodeData, download: number, upload: number } => item.download !== null && item.upload !== null)
    .map(item => ({ ...item, total: finiteSum(item.download, item.upload) }))
    .filter((item): item is { node: NodeData, download: number, upload: number, total: number } => item.total !== null)
    .sort((a, b) => b.total - a.total || compareIdentity(a.node, b.node))

  const candidateTotal = candidates.reduce<number | null>((sum, item) => sum === null ? null : finiteSum(sum, item.total), 0)
  const totalTraffic = candidates.length === onlineNodes.length ? candidateTotal : null
  const maxDownload = Math.max(0, ...candidates.map(item => item.download))
  const maxUpload = Math.max(0, ...candidates.map(item => item.upload))

  return {
    totalTraffic,
    formattedTotalTraffic: totalTraffic === null ? '数据异常' : formatBytesPerSecond(totalTraffic),
    rows: candidates.slice(0, Math.max(0, limit)).map(({ node, download, upload, total }) => ({
      uuid: node.uuid,
      name: node.name,
      online: true,
      download,
      upload,
      total,
      sharePercentage: totalTraffic === null ? null : totalTraffic === 0 ? 0 : roundPercentage((total / totalTraffic) * 100),
      formattedDownload: formatBytesPerSecond(download),
      formattedUpload: formatBytesPerSecond(upload),
      downloadVisualPercentage: maxDownload === 0 ? 0 : roundPercentage((download / maxDownload) * 100),
      uploadVisualPercentage: maxUpload === 0 ? 0 : roundPercentage((upload / maxUpload) * 100),
    })),
  }
}

export function buildPressureRows(nodes: readonly NodeData[], metric: PressureMetric): PressureRowViewModel[] {
  return nodes
    .map((node) => {
      const percentage = node.statusObserved ? pressurePercentage(node, metric) : null
      const status = pressureStatus(percentage, node)
      return {
        uuid: node.uuid,
        name: node.name,
        online: node.online,
        percentage,
        formattedPercentage: percentage === null ? (node.statusObserved ? '数据未知' : '未收到状态') : `${percentage.toFixed(1)}%`,
        status,
        statusLabel: node.statusObserved ? pressureStatusLabel(status) : '未收到状态',
        visualPercentage: percentage === null ? 0 : Math.min(percentage, 100),
      }
    })
    .sort((a, b) => {
      const aGroup = a.status === 'offline' ? 1 : a.percentage === null ? 2 : 0
      const bGroup = b.status === 'offline' ? 1 : b.percentage === null ? 2 : 0
      return aGroup - bGroup
        || (b.percentage ?? -1) - (a.percentage ?? -1)
        || compareText(a.name, b.name)
        || compareText(a.uuid, b.uuid)
    })
}

export function buildPressureMatrixRows(nodes: readonly NodeData[]): PressureMatrixRowViewModel[] {
  const metrics: Array<{ metric: PressureMetric, label: string }> = [
    { metric: 'cpu', label: 'CPU' },
    { metric: 'memory', label: '内存' },
    { metric: 'disk', label: '硬盘' },
  ]

  return nodes.map((node) => {
    const cells = metrics.map(({ metric, label }) => {
      const percentage = node.statusObserved ? pressurePercentage(node, metric) : null
      const status = pressureStatus(percentage, node)
      return {
        metric,
        label,
        percentage,
        formattedPercentage: percentage === null ? '—' : `${Math.round(percentage)}%`,
        status,
        statusLabel: node.statusObserved ? pressureStatusLabel(status) : '未收到状态',
      }
    })
    const validPercentages = cells.flatMap(cell => cell.percentage === null ? [] : [cell.percentage])

    return {
      uuid: node.uuid,
      name: node.name,
      online: node.online,
      statusObserved: node.statusObserved,
      peakPercentage: validPercentages.length ? Math.max(...validPercentages) : null,
      cells,
    }
  }).sort((a, b) => {
    const aGroup = !a.statusObserved ? 2 : !a.online ? 1 : 0
    const bGroup = !b.statusObserved ? 2 : !b.online ? 1 : 0
    return aGroup - bGroup
      || (b.peakPercentage ?? -1) - (a.peakPercentage ?? -1)
      || compareText(a.name, b.name)
      || compareText(a.uuid, b.uuid)
  })
}

export function buildQuotaRows(
  nodes: readonly NodeData[],
  filters: QuotaFilterSelection = {},
): QuotaRowViewModel[] {
  return nodes
    .filter(node => matchesGroupFilter(node, filters.group))
    .filter(node => matchesRegionFilter(node, filters.region))
    .map(buildQuotaRow)
    .sort((a, b) => quotaSortGroup(a) - quotaSortGroup(b)
      || (b.percentage ?? -1) - (a.percentage ?? -1)
      || compareText(a.name, b.name)
      || compareText(a.uuid, b.uuid))
}

export function selectQuotaRows(rows: readonly QuotaRowViewModel[], range: QuotaRangeMode): QuotaRowViewModel[] {
  if (range === 'all')
    return [...rows]
  return rows.filter(row => row.percentage !== null).slice(0, 10)
}

export function buildQuotaFilterOptions(nodes: readonly NodeData[]): {
  groups: Array<FilterOption<QuotaGroupFilter>>
  regions: Array<FilterOption<QuotaRegionFilter>>
} {
  const groups = new Set<string>()
  const regions = new Map<string, QuotaRegionFilter>()
  let hasUngrouped = false

  for (const node of nodes) {
    const nodeGroups = parseNodeGroups(node.group)
    nodeGroups.forEach(group => groups.add(group))
    hasUngrouped ||= nodeGroups.length === 0
    const region = normalizeRegionFilter(node.region)
    regions.set(regionFilterKey(region), region)
  }

  const groupOptions: Array<FilterOption<QuotaGroupFilter>> = [...groups]
    .sort(compareText)
    .map(value => ({ key: `group:${encodeURIComponent(value)}`, label: value, filter: { kind: 'named', value } }))
  if (hasUngrouped)
    groupOptions.push({ key: 'group-ungrouped', label: '未设置分组', filter: { kind: 'ungrouped' } })

  return {
    groups: groupOptions,
    regions: Array.from(regions.values(), filter => ({ filter, label: regionFilterLabel(filter) }))
      .sort((a, b) => compareText(a.label, b.label))
      .map(option => ({ key: `region:${encodeURIComponent(regionFilterKey(option.filter))}`, ...option })),
  }
}

function matchesGroupFilter(node: NodeData, filter: QuotaGroupFilter | undefined): boolean {
  if (!filter || filter.kind === 'all')
    return true
  const groups = parseNodeGroups(node.group)
  return filter.kind === 'ungrouped' ? groups.length === 0 : groups.includes(filter.value)
}

function normalizeRegionFilter(region: string): QuotaRegionFilter {
  const trimmed = region.trim()
  if (!trimmed)
    return { kind: 'unassigned' }
  const code = getCountryCodeFromRegion(trimmed)
  return code ? { kind: 'iso', code } : { kind: 'raw', value: trimmed }
}

function regionFilterKey(filter: QuotaRegionFilter): string {
  if (filter.kind === 'iso')
    return `iso:${filter.code}`
  if (filter.kind === 'raw')
    return `raw:${filter.value}`
  return filter.kind
}

function regionFilterLabel(filter: QuotaRegionFilter): string {
  if (filter.kind === 'iso')
    return getRegionDisplayName(getEmojiByCode(filter.code))
  if (filter.kind === 'raw')
    return filter.value
  return filter.kind === 'unassigned' ? '未设置地区' : '全部地区'
}

function matchesRegionFilter(node: NodeData, filter: QuotaRegionFilter | undefined): boolean {
  if (!filter || filter.kind === 'all')
    return true
  const nodeFilter = normalizeRegionFilter(node.region)
  return regionFilterKey(nodeFilter) === regionFilterKey(filter)
}
