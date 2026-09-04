import type { RpcError } from '../../src/utils/rpc'
import { afterEach, describe, expect, test } from 'bun:test'
import { KomariRpc, RpcClient } from '../../src/utils/rpc'

const originalFetch = globalThis.fetch
const originalWebSocket = globalThis.WebSocket

interface SentRpcRequest {
  id: number
  method: string
}

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readonly sent: SentRpcRequest[] = []
  readyState = FakeWebSocket.CONNECTING
  closeCalls = 0
  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as SentRpcRequest)
  }

  respond(id: number, result: unknown): void {
    this.onmessage?.({
      data: JSON.stringify({ jsonrpc: '2.0', id, result }),
    } as MessageEvent)
  }

  close(): void {
    this.closeCalls++
    this.readyState = FakeWebSocket.CLOSED
  }

  emitClose(): void {
    this.onclose?.({ code: 1000, reason: '' } as CloseEvent)
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.WebSocket = originalWebSocket
  FakeWebSocket.instances = []
})

function installAbortableFetch(): void {
  globalThis.fetch = ((_input, init) => new Promise((_resolve, reject) => {
    const signal = init?.signal
    signal?.addEventListener('abort', () => {
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })) as typeof fetch
}

describe('RpcClient cancellation contract', () => {
  test('does not start an HTTP request when the caller signal is already aborted', async () => {
    let fetchCalls = 0
    globalThis.fetch = (() => {
      fetchCalls++
      return Promise.reject(new Error('must not be called'))
    }) as typeof fetch
    const controller = new AbortController()
    controller.abort()
    const client = new RpcClient({ baseUrl: 'https://example.test/api/rpc2' })

    const promise = client.call('public:queryMetrics', {}, { signal: controller.signal })

    await expect(promise).rejects.toMatchObject<RpcError>({ code: -32010 })
    expect(fetchCalls).toBe(0)
  })

  test('maps an in-flight caller abort to the Komari cancellation code', async () => {
    installAbortableFetch()
    const client = new RpcClient({ baseUrl: 'https://example.test/api/rpc2', timeout: 1000 })
    const controller = new AbortController()

    const promise = client.call('public:queryMetrics', {}, { signal: controller.signal })
    controller.abort()

    await expect(promise).rejects.toMatchObject<RpcError>({ code: -32010 })
  })

  test('distinguishes the transport timeout from caller cancellation', async () => {
    installAbortableFetch()
    const client = new RpcClient({ baseUrl: 'https://example.test/api/rpc2', timeout: 5 })

    const promise = client.call('public:queryMetrics')

    await expect(promise).rejects.toMatchObject<RpcError>({ code: -32011 })
  })

  test('keeps the HTTP timeout active while reading the response body', async () => {
    globalThis.fetch = (async (_input, init) => ({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        }, { once: true })
      }),
    }) as Response) as typeof fetch
    const client = new RpcClient({ baseUrl: 'https://example.test/api/rpc2', timeout: 5 })

    const promise = client.call('public:queryMetrics')

    await expect(promise).rejects.toMatchObject<RpcError>({ code: -32011 })
  })

  test('cancels one concurrent WebSocket request without affecting the socket or its peer', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const client = new RpcClient({
      baseUrl: 'https://example.test/api/rpc2',
      timeout: 1000,
      useWebSocket: true,
    })
    const controller = new AbortController()

    const cancelledRequest = client.call<string>('test:cancelled', {}, { signal: controller.signal })
    const activeRequest = client.call<string>('test:active')
    const socket = FakeWebSocket.instances[0]
    expect(socket).toBeDefined()

    socket!.open()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(new Set(socket!.sent.map(request => request.method))).toEqual(new Set(['test:cancelled', 'test:active']))

    const cancelledId = socket!.sent.find(request => request.method === 'test:cancelled')!.id
    const activeId = socket!.sent.find(request => request.method === 'test:active')!.id
    controller.abort()

    await expect(cancelledRequest).rejects.toMatchObject<RpcError>({ code: -32010 })
    expect(socket!.readyState).toBe(FakeWebSocket.OPEN)
    expect(socket!.closeCalls).toBe(0)

    socket!.respond(cancelledId, 'late result')
    socket!.respond(activeId, 'active result')

    await expect(activeRequest).resolves.toBe('active result')
    expect(socket!.readyState).toBe(FakeWebSocket.OPEN)
    expect(socket!.closeCalls).toBe(0)
  })

  test('rejects promptly when cancelled while a shared WebSocket is connecting', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const client = new RpcClient({
      baseUrl: 'https://example.test/api/rpc2',
      timeout: 1000,
      useWebSocket: true,
    })
    const controller = new AbortController()

    const request = client.call('test:cancel-while-connecting', {}, { signal: controller.signal })
    controller.abort()

    await expect(request).rejects.toMatchObject<RpcError>({ code: -32010 })
    expect(FakeWebSocket.instances[0]?.readyState).toBe(FakeWebSocket.CONNECTING)
    FakeWebSocket.instances[0]?.open()
  })

  test('ignores a stale socket close after a replacement request starts', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const client = new RpcClient({ baseUrl: 'https://example.test/api/rpc2', timeout: 1000, useWebSocket: true })
    const firstRequest = client.call<string>('test:first')
    const oldSocket = FakeWebSocket.instances[0]!
    oldSocket.open()
    await new Promise(resolve => setTimeout(resolve, 0))
    oldSocket.respond(oldSocket.sent[0]!.id, 'first result')
    await expect(firstRequest).resolves.toBe('first result')

    client.setTransport(false)
    client.setTransport(true)
    const replacementRequest = client.call<string>('test:replacement')
    const replacementSocket = FakeWebSocket.instances[1]!
    replacementSocket.open()
    await new Promise(resolve => setTimeout(resolve, 0))

    oldSocket.emitClose()
    replacementSocket.respond(replacementSocket.sent[0]!.id, 'replacement result')

    await expect(replacementRequest).resolves.toBe('replacement result')
  })

  test('rejects pending requests immediately when switching away from WebSocket', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const client = new RpcClient({ baseUrl: 'https://example.test/api/rpc2', timeout: 1000, useWebSocket: true })
    const request = client.call('test:pending-switch')
    const socket = FakeWebSocket.instances[0]!
    socket.open()
    await new Promise(resolve => setTimeout(resolve, 0))

    client.setTransport(false)

    await expect(request).rejects.toMatchObject<RpcError>({ code: -32000 })
    expect(socket.closeCalls).toBe(1)
  })

  test('cleans up when WebSocket send throws synchronously', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const client = new RpcClient({ baseUrl: 'https://example.test/api/rpc2', timeout: 1000, useWebSocket: true })
    const request = client.call('test:send-failure')
    const socket = FakeWebSocket.instances[0]!
    socket.send = () => {
      throw new Error('socket closing')
    }
    socket.open()

    await expect(request).rejects.toMatchObject<RpcError>({ code: -32000 })
  })
})

describe('Komari RPC facade contract', () => {
  test('uses rpc.methods and the exact maxCount parameter', async () => {
    const requests: Array<{ method: string, params?: Record<string, unknown> }> = []
    globalThis.fetch = (async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { id: number, method: string, params?: Record<string, unknown> }
      requests.push({ method: request.method, params: request.params })
      const result = request.method === 'rpc.methods'
        ? ['common:getRecords']
        : { count: 0, records: {}, from: '2026-08-30T00:00:00Z', to: '2026-08-31T00:00:00Z' }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch
    const rpc = new KomariRpc({ baseUrl: 'https://example.test/api/rpc2' })

    await rpc.getMethods()
    await rpc.getLoadRecords(undefined, 24, 'all', -1)

    expect(requests).toEqual([
      { method: 'rpc.methods', params: undefined },
      {
        method: 'common:getRecords',
        params: { type: 'load', hours: 24, load_type: 'all', maxCount: -1 },
      },
    ])
  })
})
