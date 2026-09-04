import { RpcError } from '@/utils/rpc'

const TIMEOUT_MESSAGE_PATTERN = /timeout|timed out|deadline exceeded/i

export type HistoryFailureKind
  = | 'aborted'
    | 'unsupported'
    | 'permission'
    | 'timeout'
    | 'network'
    | 'protocol'
    | 'unknown'

export interface HistoryFailurePolicy {
  kind: HistoryFailureKind
  retryable: boolean
  message: string
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : ''
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : ''
}

export function classifyHistoryFailure(error: unknown): HistoryFailurePolicy {
  if (errorName(error) === 'AbortError' || (error instanceof RpcError && error.code === -32010)) {
    return { kind: 'aborted', retryable: false, message: '已取消历史流量请求' }
  }
  if (errorName(error) === 'HistoryCapabilitiesUnavailableError') {
    return { kind: 'unsupported', retryable: false, message: '当前服务不支持历史流量接口' }
  }
  if (errorName(error) === 'HistoryProtocolError') {
    return { kind: 'protocol', retryable: false, message: '历史流量返回格式异常' }
  }
  if (error instanceof RpcError && [-32040, -32041, 401, 403].includes(error.code)) {
    return { kind: 'permission', retryable: false, message: '没有权限读取历史流量' }
  }
  if ((error instanceof RpcError && error.code === -32011) || TIMEOUT_MESSAGE_PATTERN.test(errorMessage(error))) {
    return { kind: 'timeout', retryable: true, message: '读取历史流量超时' }
  }
  if ((error instanceof RpcError && error.code === -32000) || error instanceof TypeError) {
    return { kind: 'network', retryable: true, message: '历史流量网络连接失败' }
  }
  return { kind: 'unknown', retryable: false, message: '读取历史流量失败' }
}

export function isRetryableHistoryFailure(error: unknown): boolean {
  return classifyHistoryFailure(error).retryable
}
