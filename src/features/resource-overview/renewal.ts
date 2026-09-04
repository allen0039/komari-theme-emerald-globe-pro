import type { NodeData } from '@/stores/nodes'
import type { ExpireStatus } from '@/utils/tagHelper'
import dayjs from 'dayjs'
import { getDaysUntilExpired, getExpireStatus } from '@/utils/tagHelper'

export type RenewalFilter = 'upcoming' | 'expired' | 'all'

export interface RenewalTimelineRowViewModel {
  uuid: string
  name: string
  date: string
  daysRemaining: number
  timingLabel: string
  renewalLabel: string
  status: ExpireStatus
  statusLabel: string
}

export interface RenewalTimelineViewModel {
  total: number
  upcoming30: number
  expired: number
  hidden: number
  rows: RenewalTimelineRowViewModel[]
}

interface SortableRenewalRow extends RenewalTimelineRowViewModel {
  timestamp: number
}

function timingLabel(daysRemaining: number, status: ExpireStatus): string {
  if (status === 'long_term')
    return '长期有效'
  if (daysRemaining === 0)
    return '今天到期'
  if (daysRemaining < 0)
    return `已过期 ${Math.abs(daysRemaining)} 天`
  return `${daysRemaining} 天后`
}

function statusLabel(status: ExpireStatus): string {
  const labels: Record<ExpireStatus, string> = {
    expired: '已过期',
    critical: '即将到期',
    warning: '临近到期',
    normal: '计划内',
    long_term: '长期有效',
  }
  return labels[status]
}

function compareRenewalRows(a: SortableRenewalRow, b: SortableRenewalRow): number {
  if (a.status === 'long_term' && b.status !== 'long_term')
    return 1
  if (b.status === 'long_term' && a.status !== 'long_term')
    return -1

  if (a.status === 'expired' && b.status === 'expired')
    return b.timestamp - a.timestamp || compareIdentity(a, b)
  if (a.status === 'expired')
    return -1
  if (b.status === 'expired')
    return 1

  return a.timestamp - b.timestamp || compareIdentity(a, b)
}

function compareIdentity(
  a: Pick<RenewalTimelineRowViewModel, 'name' | 'uuid'>,
  b: Pick<RenewalTimelineRowViewModel, 'name' | 'uuid'>,
): number {
  if (a.name !== b.name)
    return a.name < b.name ? -1 : 1
  if (a.uuid === b.uuid)
    return 0
  return a.uuid < b.uuid ? -1 : 1
}

export function buildRenewalTimelineViewModel(
  nodes: readonly NodeData[],
  now = new Date(),
  limit = 5,
  filter: RenewalFilter = 'all',
  warningWindowDays = 30,
): RenewalTimelineViewModel {
  const allRows = nodes.flatMap<SortableRenewalRow>((node) => {
    const expiredAt = node.expired_at?.trim()
    if (!expiredAt)
      return []

    const parsed = dayjs(expiredAt)
    const timestamp = parsed.valueOf()
    if (!parsed.isValid() || !Number.isFinite(timestamp))
      return []

    const daysRemaining = getDaysUntilExpired(expiredAt, now)
    const status = getExpireStatus(expiredAt, now)
    return [{
      uuid: node.uuid,
      name: node.name,
      date: parsed.format('YYYY-MM-DD'),
      daysRemaining,
      timingLabel: timingLabel(daysRemaining, status),
      renewalLabel: node.auto_renewal ? '自动续费' : '手动续费',
      status,
      statusLabel: statusLabel(status),
      timestamp,
    }]
  }).sort(compareRenewalRows)

  const safeWarningWindowDays = Number.isFinite(warningWindowDays)
    ? Math.max(0, Math.floor(warningWindowDays))
    : 30
  const filteredRows = allRows.filter((row) => {
    if (filter === 'upcoming')
      return row.daysRemaining >= 0 && row.daysRemaining <= safeWarningWindowDays
    if (filter === 'expired')
      return row.status === 'expired'
    return true
  })
  const safeLimit = limit === Number.POSITIVE_INFINITY
    ? filteredRows.length
    : Number.isFinite(limit)
      ? Math.max(0, Math.floor(limit))
      : 0

  return {
    total: allRows.length,
    upcoming30: allRows.filter(row => row.daysRemaining >= 0 && row.daysRemaining <= safeWarningWindowDays).length,
    expired: allRows.filter(row => row.status === 'expired').length,
    hidden: Math.max(0, filteredRows.length - safeLimit),
    rows: filteredRows.slice(0, safeLimit).map(({ timestamp: _timestamp, ...row }) => row),
  }
}
