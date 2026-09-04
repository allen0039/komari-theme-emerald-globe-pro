export type ResourceOverviewState = 'loading' | 'ready' | 'empty' | 'error'
export type ResourceOverviewModuleId
  = | 'traffic-trend'
    | 'pressure-heatmap'
    | 'quota-ranking'
    | 'live-traffic'
    | 'cost-overview'
    | 'renewal-timeline'

interface ResourceModuleBase<TId extends ResourceOverviewModuleId, TRendering> {
  id: TId
  title: string
  gridClass: string
  numericSummary: {
    visible: true
    text: string
  }
  rendering: TRendering
}

export interface TrafficTrendModuleContract extends ResourceModuleBase<'traffic-trend', Record<string, never>> {}

export interface PressureHeatmapModuleContract extends ResourceModuleBase<'pressure-heatmap', {
  semantics: {
    containerRole: 'table'
    rowRole: 'row'
    ariaLabel: string
  }
  metrics: Array<{
    value: 'cpu' | 'memory' | 'disk'
    label: string
  }>
  displayControls: Array<{
    value: 'all' | 'cpu' | 'memory' | 'disk'
    label: string
    accessibleName: string
  }>
}> {}

export interface QuotaRankingModuleContract extends ResourceModuleBase<'quota-ranking', {
  rangeControls: Array<{
    value: 'top-10' | 'all'
    label: string
    accessibleName: string
  }>
  filters: Array<{
    id: 'group' | 'region'
    modelValue: string
    accessibleName: string
    icon: string
    controlClass: string
    options: Array<{ value: string, label: string }>
  }>
}> {}

export interface LiveTrafficModuleContract extends ResourceModuleBase<'live-traffic', {
  nameClass: string
  rowClass: string
}> {}

export interface CostOverviewModuleContract extends ResourceModuleBase<'cost-overview', Record<string, never>> {}

export interface RenewalTimelineModuleContract extends ResourceModuleBase<'renewal-timeline', {
  listClass: string
  maxItems: number
}> {}

export type ResourceOverviewModuleContract
  = | TrafficTrendModuleContract
    | PressureHeatmapModuleContract
    | QuotaRankingModuleContract
    | LiveTrafficModuleContract
    | CostOverviewModuleContract
    | RenewalTimelineModuleContract

export interface ResourceOverviewContract {
  state: ResourceOverviewState
  stateView: {
    kind: 'skeleton' | 'content' | 'empty' | 'error'
    ariaBusy: boolean
    ariaLive: 'polite' | 'assertive'
    title: string
    description: string
    retryAction?: {
      label: string
      accessibleName: string
    }
  }
  rows: Array<{
    modules: ResourceOverviewModuleContract[]
  }>
  layout: {
    pageClass: string
    summaryGridClass: string
    moduleGridClass: string
  }
  summaryMetrics: Array<{
    label: string
    value: string
    detail: string
  }>
}

export interface ResourceOverviewAsyncModuleState {
  hasFailure: boolean
  retryVersion: number
}

export type ResourceOverviewAsyncModuleEvent
  = | { type: 'module-load-failed', generation: number }
    | { type: 'retry' }

export const initialResourceOverviewAsyncModuleState: ResourceOverviewAsyncModuleState = {
  hasFailure: false,
  retryVersion: 0,
}

export function transitionResourceOverviewAsyncModuleState(
  current: ResourceOverviewAsyncModuleState,
  event: ResourceOverviewAsyncModuleEvent,
): ResourceOverviewAsyncModuleState {
  if (event.type === 'module-load-failed') {
    if (event.generation !== current.retryVersion)
      return current

    return { ...current, hasFailure: true }
  }

  return {
    hasFailure: false,
    retryVersion: current.retryVersion + 1,
  }
}

const pressureMetrics: PressureHeatmapModuleContract['rendering']['metrics'] = [
  { value: 'cpu', label: 'CPU' },
  { value: 'memory', label: '内存' },
  { value: 'disk', label: '硬盘' },
]

const pressureDisplayControls: PressureHeatmapModuleContract['rendering']['displayControls'] = [
  { value: 'all', label: '全部', accessibleName: '同时显示 CPU、内存和硬盘压力' },
  { value: 'cpu', label: 'CPU', accessibleName: '仅显示 CPU 压力' },
  { value: 'memory', label: '内存', accessibleName: '仅显示内存压力' },
  { value: 'disk', label: '硬盘', accessibleName: '仅显示硬盘压力' },
]

const rankingFilterClass = 'h-7 w-full appearance-none rounded-md border border-input bg-background pl-7 pr-5 text-[11px] text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'
const modules: Record<ResourceOverviewModuleId, ResourceOverviewModuleContract> = {
  'traffic-trend': {
    id: 'traffic-trend',
    title: '5 日上下行趋势',
    gridClass: 'h-56 self-start lg:col-span-4',
    numericSummary: {
      visible: true,
      text: '数值摘要：等待读取 5 日上传与下载流量。',
    },
    rendering: {},
  },
  'pressure-heatmap': {
    id: 'pressure-heatmap',
    title: '资源压力热力图',
    gridClass: 'h-56 self-start lg:col-span-4',
    numericSummary: {
      visible: true,
      text: '数值摘要：正在读取 CPU、内存与磁盘压力。',
    },
    rendering: {
      semantics: {
        containerRole: 'table',
        rowRole: 'row',
        ariaLabel: '资源压力表，CPU、内存和硬盘风险同时通过数值、图标和颜色标示',
      },
      metrics: pressureMetrics,
      displayControls: pressureDisplayControls,
    },
  },
  'quota-ranking': {
    id: 'quota-ranking',
    title: '探针累计流量额度排行',
    gridClass: 'h-56 self-start lg:col-span-4',
    numericSummary: {
      visible: true,
      text: '数值摘要：正在读取探针累计流量与额度。',
    },
    rendering: {
      rangeControls: [
        { value: 'top-10', label: 'Top 10', accessibleName: '显示 Top 10 额度排行' },
        { value: 'all', label: '全部', accessibleName: '显示全部额度记录' },
      ],
      filters: [
        {
          id: 'group',
          modelValue: 'all-groups',
          accessibleName: '按分组筛选额度排行',
          icon: 'lucide:layers-3',
          controlClass: rankingFilterClass,
          options: [
            { value: 'all-groups', label: '全部分组' },
            { value: 'core', label: '核心节点' },
          ],
        },
        {
          id: 'region',
          modelValue: 'all-regions',
          accessibleName: '按地区筛选额度排行',
          icon: 'lucide:map-pin',
          controlClass: rankingFilterClass,
          options: [
            { value: 'all-regions', label: '全部地区' },
            { value: 'asia', label: '亚洲' },
          ],
        },
      ],
    },
  },
  'live-traffic': {
    id: 'live-traffic',
    title: '实时流量热点',
    gridClass: 'lg:col-span-5',
    numericSummary: {
      visible: true,
      text: '数值摘要：正在读取在线探针实时带宽。',
    },
    rendering: {
      nameClass: 'truncate text-xs text-foreground',
      rowClass: 'grid h-11 min-w-0 grid-cols-[minmax(0,1fr)_minmax(5.5rem,1.15fr)_2.5rem] items-center gap-2 border-t border-border/60 px-2',
    },
  },
  'cost-overview': {
    id: 'cost-overview',
    title: '成本概览',
    gridClass: 'lg:col-span-7',
    numericSummary: {
      visible: true,
      text: '数值摘要：月度成本、年度预算、未来应续金额与价格数据覆盖率。',
    },
    rendering: {},
  },
  'renewal-timeline': {
    id: 'renewal-timeline',
    title: '续费时间线',
    gridClass: 'lg:col-span-12',
    numericSummary: {
      visible: true,
      text: '数值摘要：正在读取探针到期日期。',
    },
    rendering: {
      listClass: 'relative grid min-w-0 grid-cols-1 gap-0 md:grid-cols-5',
      maxItems: 5,
    },
  },
}

const stateViews: Record<ResourceOverviewState, ResourceOverviewContract['stateView']> = {
  loading: {
    kind: 'skeleton',
    ariaBusy: true,
    ariaLive: 'polite',
    title: '正在准备资源概况',
    description: '当前展示结构化占位内容，尚未读取监控或财务数据。',
  },
  ready: {
    kind: 'content',
    ariaBusy: false,
    ariaLive: 'polite',
    title: '资源概况已更新',
    description: '实时资源模块使用当前探针状态。',
  },
  empty: {
    kind: 'empty',
    ariaBusy: false,
    ariaLive: 'polite',
    title: '暂无可展示的资源记录',
    description: '当前范围内没有可展示的资源记录。后续接入数据后，可调整范围或确认节点是否已纳入监控。',
  },
  error: {
    kind: 'error',
    ariaBusy: false,
    ariaLive: 'assertive',
    title: '资源概况暂时无法加载',
    description: '请稍后重试，或检查监控服务连接是否可用。',
    retryAction: {
      label: '重新加载',
      accessibleName: '重新加载资源概况模块',
    },
  },
}

export function buildResourceOverviewContract(options: {
  state?: ResourceOverviewState
  moduleLoadFailed?: boolean
} = {}): ResourceOverviewContract {
  const state = options.moduleLoadFailed ? 'error' : options.state ?? 'loading'
  const stateView = options.moduleLoadFailed
    ? {
        ...stateViews.error,
        description: '页面模块加载失败。请检查网络连接后重新加载。',
      }
    : stateViews[state]

  return {
    state,
    stateView,
    rows: [
      { modules: [modules['traffic-trend'], modules['pressure-heatmap'], modules['quota-ranking']] },
      { modules: [modules['live-traffic'], modules['cost-overview']] },
      { modules: [modules['renewal-timeline']] },
    ],
    layout: {
      pageClass: 'w-full min-w-0 overflow-x-clip px-4 py-6 sm:px-6 lg:py-8',
      summaryGridClass: 'grid grid-cols-2 md:grid-cols-4',
      moduleGridClass: 'grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-12',
    },
    summaryMetrics: [
      { label: '监控探针', value: '—', detail: '等待数据接入' },
      { label: '近 7 日流量', value: '—', detail: '上传与下载' },
      { label: '压力提醒', value: '—', detail: 'CPU / 内存 / 磁盘' },
      { label: '近期续费', value: '—', detail: '未来 30 天' },
    ],
  }
}

export function resolveResourceOverviewQaState(
  requestedState: unknown,
  isDevelopment: boolean,
): ResourceOverviewState {
  if (!isDevelopment)
    return 'loading'

  if (requestedState === 'empty' || requestedState === 'error' || requestedState === 'loading')
    return requestedState

  return 'loading'
}

export function resolveResourceOverviewRuntimeState(options: {
  loading: boolean
  connectionError: boolean
  nodeCount: number
  requestedQaState?: unknown
  isDevelopment: boolean
}): ResourceOverviewState {
  if (options.isDevelopment && ['loading', 'empty', 'error'].includes(String(options.requestedQaState)))
    return resolveResourceOverviewQaState(options.requestedQaState, true)
  if (options.loading)
    return 'loading'
  if (options.nodeCount === 0)
    return options.connectionError ? 'error' : 'empty'
  return 'ready'
}

export function resolveResourceOverviewTelemetryMode(
  state: ResourceOverviewState,
  connectionError: boolean,
): 'cached' | 'live' | 'standby' {
  if (state !== 'ready')
    return 'standby'

  return connectionError ? 'cached' : 'live'
}
