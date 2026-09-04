import type { NodeData } from '../../src/stores/nodes'
import { describe, expect, test } from 'bun:test'
import { buildRenewalTimelineViewModel } from '../../src/features/resource-overview/renewal'

function renewalNode(overrides: Partial<NodeData>): NodeData {
  return {
    uuid: 'node',
    name: 'node',
    expired_at: '',
    auto_renewal: false,
    ...overrides,
  } as NodeData
}

describe('resource renewal timeline derivation', () => {
  test('uses real expiry data, prioritizes actionable dates, and keeps invalid dates out', () => {
    const now = new Date('2026-08-31T12:00:00+08:00')
    const nodes = [
      renewalNode({ uuid: 'long', name: 'Long term', expired_at: '2150-01-01', auto_renewal: true }),
      renewalNode({ uuid: 'normal', name: 'Normal', expired_at: '2026-10-10' }),
      renewalNode({ uuid: 'warning', name: 'Warning', expired_at: '2026-09-10' }),
      renewalNode({ uuid: 'critical', name: 'Critical', expired_at: '2026-09-03', auto_renewal: true }),
      renewalNode({ uuid: 'expired', name: 'Expired', expired_at: '2026-08-29' }),
      renewalNode({ uuid: 'missing', name: 'Missing', expired_at: '' }),
      renewalNode({ uuid: 'invalid', name: 'Invalid', expired_at: 'not-a-date' }),
    ]
    const originalOrder = nodes.map(node => node.uuid)

    const viewModel = buildRenewalTimelineViewModel(nodes, now, 5)

    expect(viewModel).toMatchObject({ total: 5, upcoming30: 2, expired: 1, hidden: 0 })
    expect(viewModel.rows.map(row => row.uuid)).toEqual(['expired', 'critical', 'warning', 'normal', 'long'])
    expect(viewModel.rows[0]).toMatchObject({
      date: '2026-08-29',
      timingLabel: '已过期 2 天',
      status: 'expired',
      renewalLabel: '手动续费',
    })
    expect(viewModel.rows[1]).toMatchObject({
      timingLabel: '3 天后',
      status: 'critical',
      statusLabel: '即将到期',
      renewalLabel: '自动续费',
    })
    expect(viewModel.rows[4]).toMatchObject({ timingLabel: '长期有效', status: 'long_term' })
    expect(nodes.map(node => node.uuid)).toEqual(originalOrder)
  })

  test('reports hidden events and remains truthful when no valid expiry exists', () => {
    const now = new Date('2026-08-31T12:00:00+08:00')
    const nodes = [
      renewalNode({ uuid: 'a', name: 'A', expired_at: '2026-09-01' }),
      renewalNode({ uuid: 'b', name: 'B', expired_at: '2026-09-02' }),
      renewalNode({ uuid: 'c', name: 'C', expired_at: '2026-09-03' }),
    ]

    expect(buildRenewalTimelineViewModel(nodes, now, 2)).toMatchObject({ total: 3, hidden: 1 })
    expect(buildRenewalTimelineViewModel([
      renewalNode({ uuid: 'missing', expired_at: '' }),
      renewalNode({ uuid: 'invalid', expired_at: 'invalid' }),
    ], now)).toEqual({ total: 0, upcoming30: 0, expired: 0, hidden: 0, rows: [] })
  })

  test('filters before limiting and supports an unlimited result set', () => {
    const now = new Date('2026-08-31T12:00:00+08:00')
    const nodes = [
      renewalNode({ uuid: 'expired-old', name: 'Expired old', expired_at: '2026-08-01' }),
      renewalNode({ uuid: 'expired-new', name: 'Expired new', expired_at: '2026-08-30' }),
      renewalNode({ uuid: 'today', name: 'Today', expired_at: '2026-08-31' }),
      renewalNode({ uuid: 'soon', name: 'Soon', expired_at: '2026-09-10' }),
      renewalNode({ uuid: 'later', name: 'Later', expired_at: '2026-10-10' }),
      renewalNode({ uuid: 'long', name: 'Long term', expired_at: '2150-01-01' }),
    ]

    const upcoming = buildRenewalTimelineViewModel(nodes, now, 5, 'upcoming', 30)
    const expired = buildRenewalTimelineViewModel(nodes, now, 5, 'expired', 30)
    const all = buildRenewalTimelineViewModel(nodes, now, Number.POSITIVE_INFINITY, 'all', 30)

    expect(upcoming.rows.map(row => row.uuid)).toEqual(['today', 'soon'])
    expect(upcoming.hidden).toBe(0)
    expect(expired.rows.map(row => row.uuid)).toEqual(['today', 'expired-new', 'expired-old'])
    expect(expired.hidden).toBe(0)
    expect(all.rows.map(row => row.uuid)).toEqual(['today', 'expired-new', 'expired-old', 'soon', 'later', 'long'])
    expect(all.hidden).toBe(0)
  })
})
