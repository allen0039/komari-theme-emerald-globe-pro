import { describe, expect, test } from 'bun:test'
import { classifyHistoryFailure } from '../../src/utils/history/errorPolicy'
import {
  HistoryCapabilitiesUnavailableError,
  HistoryProtocolError,
} from '../../src/utils/history/gateway'
import { RpcError } from '../../src/utils/rpc'

describe('history error policy', () => {
  test.each([
    [new DOMException('Aborted', 'AbortError'), 'aborted', false, '已取消历史流量请求'],
    [new HistoryCapabilitiesUnavailableError(), 'unsupported', false, '当前服务不支持历史流量接口'],
    [new HistoryProtocolError('malformed response'), 'protocol', false, '历史流量返回格式异常'],
    [new RpcError(-32041, 'Permission denied'), 'permission', false, '没有权限读取历史流量'],
    [new RpcError(-32011, 'Request timeout'), 'timeout', true, '读取历史流量超时'],
    [new RpcError(-32000, 'Network error'), 'network', true, '历史流量网络连接失败'],
    [new Error('unexpected business failure'), 'unknown', false, '读取历史流量失败'],
  ] as const)('classifies %s as a stable user-facing failure', (error, kind, retryable, message) => {
    expect(classifyHistoryFailure(error)).toEqual({ kind, retryable, message })
  })
})
