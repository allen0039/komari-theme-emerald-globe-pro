import { describe, expect, test } from 'bun:test'
import {
  buildResourceOverviewContract,
  initialResourceOverviewAsyncModuleState,
  resolveResourceOverviewQaState,
  resolveResourceOverviewRuntimeState,
  resolveResourceOverviewTelemetryMode,
  transitionResourceOverviewAsyncModuleState,
} from '../../src/features/resource-overview/contract'

describe('resource overview presentation contract', () => {
  test('defaults to the loading skeleton and keeps empty and error guidance distinct', () => {
    const loading = buildResourceOverviewContract()
    const empty = buildResourceOverviewContract({ state: 'empty' })
    const error = buildResourceOverviewContract({ state: 'error' })

    expect(loading.state).toBe('loading')
    expect(loading.stateView).toEqual({
      kind: 'skeleton',
      ariaBusy: true,
      ariaLive: 'polite',
      title: '正在准备资源概况',
      description: '当前展示结构化占位内容，尚未读取监控或财务数据。',
    })

    expect(empty.stateView).toMatchObject({
      kind: 'empty',
      ariaBusy: false,
      title: '暂无可展示的资源记录',
    })
    expect(empty.stateView.description).toContain('调整范围')

    expect(error.stateView).toMatchObject({
      kind: 'error',
      ariaBusy: false,
      title: '资源概况暂时无法加载',
    })
    expect(error.stateView.description).toContain('检查监控服务连接')
    expect(error.stateView.description).not.toMatch(/业务数据为零|没有业务数据/)
  })

  test('keeps the approved desktop module order across the three content rows', () => {
    const contract = buildResourceOverviewContract()

    expect(contract.rows.map(row => row.modules.map(module => module.title))).toEqual([
      ['5 日上下行趋势', '资源压力热力图', '探针累计流量额度排行'],
      ['实时流量热点', '成本概览'],
      ['续费时间线'],
    ])
  })

  test('keeps stable-release state evidence and the full renewal timeline contract available', () => {
    const ready = buildResourceOverviewContract({ state: 'ready' })
    const empty = buildResourceOverviewContract({ state: 'empty' })
    const error = buildResourceOverviewContract({ state: 'error' })
    const renewal = ready.rows.flatMap(row => row.modules).find(module => module.id === 'renewal-timeline')

    expect(ready.stateView.kind).toBe('content')
    expect(empty.stateView.kind).toBe('empty')
    expect(error.stateView.kind).toBe('error')
    expect(error.stateView.retryAction?.accessibleName).toBe('重新加载资源概况模块')
    expect(renewal?.rendering).toMatchObject({
      listClass: expect.stringContaining('grid-cols-1'),
      maxItems: 5,
    })
  })

  test('provides rendering-facing page layout and module grid props in approved order', () => {
    const contract = buildResourceOverviewContract()

    expect(contract.layout).toEqual({
      pageClass: 'w-full min-w-0 overflow-x-clip px-4 py-6 sm:px-6 lg:py-8',
      summaryGridClass: 'grid grid-cols-2 md:grid-cols-4',
      moduleGridClass: 'grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-12',
    })
    expect(contract.rows.flatMap(row => row.modules).map(module => ({
      id: module.id,
      gridClass: module.gridClass,
    }))).toEqual([
      { id: 'traffic-trend', gridClass: 'h-56 self-start lg:col-span-4' },
      { id: 'pressure-heatmap', gridClass: 'h-56 self-start lg:col-span-4' },
      { id: 'quota-ranking', gridClass: 'h-56 self-start lg:col-span-4' },
      { id: 'live-traffic', gridClass: 'lg:col-span-5' },
      { id: 'cost-overview', gridClass: 'lg:col-span-7' },
      { id: 'renewal-timeline', gridClass: 'lg:col-span-12' },
    ])
  })

  test('provides simultaneous pressure table semantics and non-color risk rendering props', () => {
    const contract = buildResourceOverviewContract()
    const pressure = contract.rows.flatMap(row => row.modules).find(module => module.id === 'pressure-heatmap')

    expect(pressure?.rendering).toMatchObject({
      semantics: {
        containerRole: 'table',
        rowRole: 'row',
      },
      metrics: [
        { value: 'cpu', label: 'CPU' },
        { value: 'memory', label: '内存' },
        { value: 'disk', label: '硬盘' },
      ],
      displayControls: [
        { value: 'all', label: '全部', accessibleName: '同时显示 CPU、内存和硬盘压力' },
        { value: 'cpu', label: 'CPU', accessibleName: '仅显示 CPU 压力' },
        { value: 'memory', label: '内存', accessibleName: '仅显示内存压力' },
        { value: 'disk', label: '硬盘', accessibleName: '仅显示硬盘压力' },
      ],
    })
  })

  test('provides rendering-facing focus, fixed-row, title, and mobile timeline props', () => {
    const modules = buildResourceOverviewContract().rows.flatMap(row => row.modules)
    const ranking = modules.find(module => module.id === 'quota-ranking')
    const liveTraffic = modules.find(module => module.id === 'live-traffic')

    expect(ranking?.rendering.filters.every(filter => filter.controlClass.includes('focus-visible:ring-3'))).toBeTrue()
    expect(ranking?.rendering.filters.map(filter => filter.accessibleName)).toEqual([
      '按分组筛选额度排行',
      '按地区筛选额度排行',
    ])
    expect(liveTraffic?.rendering.rowClass).toContain('h-11')
    expect(liveTraffic?.rendering.nameClass).toContain('truncate')
  })

  test('allows QA state overrides only in development and never changes the production default', () => {
    expect(resolveResourceOverviewQaState('error', false)).toBe('loading')
    expect(resolveResourceOverviewQaState('empty', true)).toBe('empty')
    expect(resolveResourceOverviewQaState('error', true)).toBe('error')
    expect(resolveResourceOverviewQaState('unsupported', true)).toBe('loading')
    expect(resolveResourceOverviewQaState(undefined, true)).toBe('loading')
  })

  test('distinguishes initialization, true empty data, fatal connection failure, and cached degraded data', () => {
    expect(resolveResourceOverviewRuntimeState({ loading: true, connectionError: false, nodeCount: 0, isDevelopment: false })).toBe('loading')
    expect(resolveResourceOverviewRuntimeState({ loading: false, connectionError: false, nodeCount: 0, isDevelopment: false })).toBe('empty')
    expect(resolveResourceOverviewRuntimeState({ loading: false, connectionError: true, nodeCount: 0, isDevelopment: false })).toBe('error')
    expect(resolveResourceOverviewRuntimeState({ loading: false, connectionError: true, nodeCount: 3, isDevelopment: false })).toBe('ready')
    expect(buildResourceOverviewContract({ state: 'ready' }).stateView).toMatchObject({ kind: 'content', ariaBusy: false })

    expect(resolveResourceOverviewTelemetryMode('error', true)).toBe('standby')
    expect(resolveResourceOverviewTelemetryMode('ready', true)).toBe('cached')
    expect(resolveResourceOverviewTelemetryMode('ready', false)).toBe('live')
  })

  test('turns a lazy module failure into a retryable non-busy error and resets it for retry', () => {
    const failed = transitionResourceOverviewAsyncModuleState(
      initialResourceOverviewAsyncModuleState,
      { type: 'module-load-failed', generation: 0 },
    )
    const failedContract = buildResourceOverviewContract({
      state: 'loading',
      moduleLoadFailed: failed.hasFailure,
    })

    expect(failed).toEqual({ hasFailure: true, retryVersion: 0 })
    expect(failedContract.stateView).toMatchObject({
      kind: 'error',
      ariaBusy: false,
      retryAction: {
        label: '重新加载',
        accessibleName: '重新加载资源概况模块',
      },
    })

    const retried = transitionResourceOverviewAsyncModuleState(failed, { type: 'retry' })

    expect(retried).toEqual({ hasFailure: false, retryVersion: 1 })
    expect(buildResourceOverviewContract({ state: 'loading', moduleLoadFailed: retried.hasFailure }).stateView.kind).toBe('skeleton')

    const staleFailure = transitionResourceOverviewAsyncModuleState(
      retried,
      { type: 'module-load-failed', generation: 0 },
    )
    const currentFailure = transitionResourceOverviewAsyncModuleState(
      staleFailure,
      { type: 'module-load-failed', generation: 1 },
    )

    expect(staleFailure).toEqual({ hasFailure: false, retryVersion: 1 })
    expect(currentFailure).toEqual({ hasFailure: true, retryVersion: 1 })
  })
})
