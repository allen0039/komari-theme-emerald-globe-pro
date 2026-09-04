import type { NodeData } from '../../src/stores/nodes'
import { describe, expect, test } from 'bun:test'
import { createPinia, setActivePinia } from 'pinia'
import {
  buildLiveTrafficViewModel,
  buildPressureMatrixRows,
  buildPressureRows,
  buildQuotaFilterOptions,
  buildQuotaRows,
  buildRuntimeSummary,
  selectQuotaRows,
} from '../../src/features/resource-overview/realtime'
import { useNodesStore } from '../../src/stores/nodes'

function node(overrides: Partial<NodeData> = {}): NodeData {
  return {
    uuid: 'node-1',
    name: 'node-1',
    cpu_name: '',
    virtualization: '',
    arch: '',
    cpu_cores: 1,
    os: '',
    kernel_version: '',
    region: '🇨🇳',
    public_remark: '',
    mem_total: 100,
    swap_total: 0,
    disk_total: 100,
    weight: 0,
    price: 0,
    billing_cycle: 0,
    auto_renewal: false,
    currency: 'CNY',
    expired_at: '',
    group: 'core',
    tags: '',
    hidden: false,
    traffic_limit: 1000,
    traffic_limit_type: 'sum',
    created_at: '',
    updated_at: '',
    statusObserved: true,
    online: true,
    time: '',
    cpu: 20,
    gpu: 0,
    ram: 20,
    swap: 0,
    load: 0,
    load5: 0,
    load15: 0,
    temp: 0,
    disk: 20,
    net_in: 0,
    net_out: 0,
    net_total_up: 100,
    net_total_down: 200,
    process: 0,
    connections: 0,
    connections_udp: 0,
    uptime: 0,
    ...overrides,
  }
}

describe('phase 3 realtime resource derivation', () => {
  test('builds a truthful runtime summary without turning invalid samples into zero', () => {
    const summary = buildRuntimeSummary([
      node({ uuid: 'a', name: 'a', net_in: 1024, net_out: 2048 }),
      node({ uuid: 'b', name: 'b', online: false, cpu: 99 }),
      node({ uuid: 'c', name: 'c', cpu: 85, ram: Number.NaN, net_in: Number.POSITIVE_INFINITY }),
    ])

    expect(summary).toEqual({
      total: 3,
      online: 2,
      offline: 1,
      unobserved: 0,
      pressureAttention: 1,
      unknownPressure: 1,
      invalidTrafficSamples: 1,
      trafficAggregateInvalid: false,
      netIn: 1024,
      netOut: 2048,
      totalTraffic: 3072,
      formattedTraffic: '3.0 KB/s',
      formattedNetIn: '1.0 KB/s',
      formattedNetOut: '2.0 KB/s',
    })
  })

  test('ranks only online nodes by sanitized combined traffic with stable ties', () => {
    const viewModel = buildLiveTrafficViewModel([
      node({ uuid: 'z', name: 'Zulu', net_in: 100, net_out: 100 }),
      node({ uuid: 'a', name: 'Alpha', net_in: 150, net_out: 50 }),
      node({ uuid: 'offline', name: 'Offline', online: false, net_in: 9999, net_out: 9999 }),
      node({ uuid: 'bad', name: 'Bad', net_in: Number.NaN, net_out: -1 }),
      node({ uuid: 'unobserved', name: 'Unobserved', statusObserved: false, net_in: 900, net_out: 900 }),
      node({ uuid: 'small', name: 'Small', net_in: 20, net_out: 30 }),
      node({ uuid: 'extra', name: 'Extra', net_in: 10, net_out: 10 }),
    ])

    expect(viewModel.totalTraffic).toBeNull()
    expect(viewModel.formattedTotalTraffic).toBe('数据异常')
    expect(viewModel.rows.map(row => row.uuid)).toEqual(['a', 'z', 'small', 'extra'])
    expect(viewModel.rows[0]).toMatchObject({
      download: 150,
      upload: 50,
      total: 200,
      sharePercentage: null,
      formattedDownload: '150.0 B/s',
      formattedUpload: '50.0 B/s',
    })
  })

  test('derives guarded pressure percentages and keeps offline and unknown rows explicit', () => {
    const nodes = [
      node({ uuid: 'critical', name: 'Critical', cpu: 85, ram: 90, disk: 95 }),
      node({ uuid: 'warning', name: 'Warning', cpu: 65, ram: 65 }),
      node({ uuid: 'offline', name: 'Offline', online: false, cpu: 99 }),
      node({ uuid: 'unknown', name: 'Unknown', cpu: Number.NaN, mem_total: 0, disk_total: -1 }),
      node({ uuid: 'overflow', name: 'Overflow', cpu: 101, ram: 101, disk: 101 }),
      node({ uuid: 'unobserved', name: 'Unobserved', statusObserved: false, cpu: 0 }),
    ]

    expect(buildPressureRows(nodes, 'cpu').map(row => [row.uuid, row.status, row.percentage])).toEqual([
      ['critical', 'critical', 85],
      ['warning', 'warning', 65],
      ['offline', 'offline', 99],
      ['overflow', 'unknown', null],
      ['unknown', 'unknown', null],
      ['unobserved', 'unknown', null],
    ])
    expect(buildPressureRows(nodes, 'memory').find(row => row.uuid === 'unknown')).toMatchObject({
      status: 'unknown',
      percentage: null,
      formattedPercentage: '数据未知',
    })
  })

  test('builds a compact simultaneous CPU, memory, and disk pressure matrix', () => {
    const rows = buildPressureMatrixRows([
      node({ uuid: 'normal', name: 'Normal', cpu: 20, ram: 30, disk: 40 }),
      node({ uuid: 'risk', name: 'Risk', cpu: 60, ram: 70, disk: 85 }),
      node({ uuid: 'offline', name: 'Offline', online: false, cpu: 99, ram: 99, disk: 99 }),
      node({ uuid: 'unknown', name: 'Unknown', statusObserved: false }),
    ])

    expect(rows.map(row => row.uuid)).toEqual(['risk', 'normal', 'offline', 'unknown'])
    expect(rows[0]?.cells.map(cell => [cell.metric, cell.formattedPercentage, cell.status])).toEqual([
      ['cpu', '60%', 'warning'],
      ['memory', '70%', 'warning'],
      ['disk', '85%', 'critical'],
    ])
    expect(rows[2]?.cells.every(cell => cell.status === 'offline')).toBeTrue()
    expect(rows[3]?.cells.every(cell => cell.status === 'unknown' && cell.formattedPercentage === '—')).toBeTrue()
  })

  test('supports all five quota directions, overage, and defensive invalid states', () => {
    const nodes = [
      node({ uuid: 'up', name: 'up', traffic_limit_type: 'up', net_total_up: 300, net_total_down: 700 }),
      node({ uuid: 'down', name: 'down', traffic_limit_type: 'down', net_total_up: 300, net_total_down: 700 }),
      node({ uuid: 'min', name: 'min', traffic_limit_type: 'min', net_total_up: 300, net_total_down: 700 }),
      node({ uuid: 'max', name: 'max', traffic_limit_type: 'max', net_total_up: 300, net_total_down: 700 }),
      node({ uuid: 'sum', name: 'sum', traffic_limit_type: 'sum', net_total_up: 300, net_total_down: 700 }),
      node({ uuid: 'over', name: 'over', traffic_limit_type: 'sum', net_total_up: 700, net_total_down: 700 }),
      node({ uuid: 'none', name: 'none', traffic_limit: 0 }),
      node({ uuid: 'negative', name: 'negative', net_total_up: -1 }),
      node({ uuid: 'unknown', name: 'unknown', traffic_limit_type: 'mystery' as NodeData['traffic_limit_type'] }),
      node({ uuid: 'offline', name: 'offline', online: false }),
      node({ uuid: 'up-ignores-down', name: 'up-ignores-down', traffic_limit_type: 'up', net_total_up: 200, net_total_down: Number.NaN }),
      node({ uuid: 'down-ignores-up', name: 'down-ignores-up', traffic_limit_type: 'down', net_total_up: Number.NaN, net_total_down: 400 }),
      node({ uuid: 'unobserved', name: 'unobserved', statusObserved: false }),
    ]
    const rows = buildQuotaRows(nodes)
    const byId = new Map(rows.map(row => [row.uuid, row]))

    expect(byId.get('up')).toMatchObject({ used: 300, percentage: 30, status: 'normal' })
    expect(byId.get('down')).toMatchObject({ used: 700, percentage: 70, status: 'warning' })
    expect(byId.get('min')).toMatchObject({ used: 300, percentage: 30 })
    expect(byId.get('max')).toMatchObject({ used: 700, percentage: 70 })
    expect(byId.get('sum')).toMatchObject({ used: 1000, percentage: 100, status: 'reached', statusLabel: '已达额度' })
    expect(byId.get('over')).toMatchObject({ percentage: 140, visualPercentage: 100, status: 'exceeded' })
    expect(byId.get('none')).toMatchObject({ percentage: null, status: 'no-limit', statusLabel: '未设置额度' })
    expect(byId.get('negative')).toMatchObject({ percentage: null, status: 'invalid', statusLabel: '计数异常' })
    expect(byId.get('unknown')).toMatchObject({ percentage: null, status: 'invalid', statusLabel: '额度类型未知' })
    expect(byId.get('offline')).toMatchObject({ percentage: 30, status: 'offline', statusLabel: '离线' })
    expect(byId.get('up-ignores-down')).toMatchObject({ used: 200, percentage: 20, status: 'normal' })
    expect(byId.get('down-ignores-up')).toMatchObject({ used: 400, percentage: 40, status: 'normal' })
    expect(byId.get('unobserved')).toMatchObject({ percentage: null, status: 'unobserved', statusLabel: '未收到状态' })
    expect(rows.findIndex(row => row.uuid === 'none')).toBeGreaterThan(rows.findIndex(row => row.uuid === 'up'))
  })

  test('keeps offline visible beside quota problems and classifies raw ratios before display rounding', () => {
    const rows = buildQuotaRows([
      node({ uuid: 'offline-none', name: 'offline-none', online: false, traffic_limit: 0 }),
      node({ uuid: 'offline-unknown', name: 'offline-unknown', online: false, traffic_limit_type: 'mystery' as NodeData['traffic_limit_type'] }),
      node({ uuid: 'almost-over', name: 'almost-over', traffic_limit: 100_000, net_total_up: 49_999, net_total_down: 50_000 }),
      node({ uuid: 'overflow-ratio', name: 'overflow-ratio', traffic_limit: Number.MIN_VALUE, net_total_up: Number.MAX_VALUE, net_total_down: 0 }),
    ])
    const byId = new Map(rows.map(row => [row.uuid, row]))

    expect(byId.get('offline-none')).toMatchObject({ status: 'no-limit', statusLabel: '离线 · 未设置额度' })
    expect(byId.get('offline-unknown')).toMatchObject({ status: 'invalid', statusLabel: '离线 · 额度类型未知' })
    expect(byId.get('almost-over')?.percentage).toBeCloseTo(99.999, 6)
    expect(byId.get('almost-over')).toMatchObject({ status: 'critical' })
    expect(byId.get('overflow-ratio')).toMatchObject({ percentage: null, status: 'invalid', statusLabel: '比例异常' })
  })

  test('rejects arithmetic overflow instead of formatting it as a real zero or NaN percentage', () => {
    const overflowing = node({ net_in: Number.MAX_VALUE, net_out: Number.MAX_VALUE })
    const summary = buildRuntimeSummary([overflowing])
    const live = buildLiveTrafficViewModel([overflowing])

    expect(summary).toMatchObject({
      totalTraffic: null,
      formattedTraffic: '数据异常',
      invalidTrafficSamples: 0,
      trafficAggregateInvalid: true,
    })
    expect(live.rows).toHaveLength(0)
    expect(live).toMatchObject({ totalTraffic: null, formattedTotalTraffic: '数据异常' })
  })

  test('filters quotas by semicolon groups and exact region while keeping stable options', () => {
    const nodes = [
      node({ uuid: 'b', name: 'Beta', group: 'edge; core', region: '🇯🇵' }),
      node({ uuid: 'a', name: 'Alpha', group: 'core', region: '🇨🇳' }),
      node({ uuid: 'c', name: 'Gamma', group: '', region: '' }),
    ]

    expect(buildQuotaFilterOptions(nodes)).toEqual({
      groups: [
        { key: 'group:core', label: 'core', filter: { kind: 'named', value: 'core' } },
        { key: 'group:edge', label: 'edge', filter: { kind: 'named', value: 'edge' } },
        { key: 'group-ungrouped', label: '未设置分组', filter: { kind: 'ungrouped' } },
      ],
      regions: [
        { key: 'region:iso%3ACN', label: '中国', filter: { kind: 'iso', code: 'CN' } },
        { key: 'region:iso%3AJP', label: '日本', filter: { kind: 'iso', code: 'JP' } },
        { key: 'region:unassigned', label: '未设置地区', filter: { kind: 'unassigned' } },
      ],
    })
    expect(buildQuotaRows(nodes, {
      group: { kind: 'named', value: 'core' },
      region: { kind: 'iso', code: 'JP' },
    }).map(row => row.uuid)).toEqual(['b'])

    const expandedOptions = buildQuotaFilterOptions([
      node({ uuid: 'new', name: 'New', group: 'aaa', region: '🇩🇪' }),
      ...nodes,
    ])
    expect(expandedOptions.groups.find(option => option.label === 'core')?.key).toBe('group:core')
    expect(expandedOptions.regions.find(option => option.label === '日本')?.key).toBe('region:iso%3AJP')
  })

  test('applies Top 10 after filtering and never mutates the ranked source', () => {
    const nodes = Array.from({ length: 12 }, (_, index) => node({
      uuid: `valid-${index}`,
      name: `valid-${index.toString().padStart(2, '0')}`,
      net_total_up: index * 20,
    })).concat([
      node({ uuid: 'no-limit', name: 'no-limit', traffic_limit: 0 }),
      node({ uuid: 'invalid', name: 'invalid', traffic_limit_type: 'bad' as NodeData['traffic_limit_type'] }),
    ])
    const rows = buildQuotaRows(nodes)
    const snapshot = rows.map(row => row.uuid)

    expect(selectQuotaRows(rows, 'top-10')).toHaveLength(10)
    expect(selectQuotaRows(rows, 'top-10').every(row => row.percentage !== null)).toBeTrue()
    expect(selectQuotaRows(rows, 'all')).toHaveLength(14)
    expect(rows.map(row => row.uuid)).toEqual(snapshot)
  })

  test('stays deterministic at the planned 0/1/15/50/100 node scales', () => {
    for (const count of [0, 1, 15, 50, 100]) {
      const nodes = Array.from({ length: count }, (_, index) => node({
        uuid: `node-${index}`,
        name: `node-${index.toString().padStart(3, '0')}`,
        net_in: index,
        net_out: count - index,
      }))

      expect(buildLiveTrafficViewModel(nodes).rows).toHaveLength(Math.min(5, count))
      expect(buildPressureRows(nodes, 'disk')).toHaveLength(count)
      expect(buildQuotaRows(nodes)).toHaveLength(count)
    }
  })

  test('marks nodes omitted from a successful latest-status snapshot as unobserved', () => {
    setActivePinia(createPinia())
    const store = useNodesStore()
    store.nodes = [node({ uuid: 'stale', name: 'stale', statusObserved: true, online: true, cpu: 90 })]

    store.updateNodeStatuses({})

    expect(store.nodes[0]).toMatchObject({ uuid: 'stale', statusObserved: false, online: false, cpu: 90 })
  })
})
