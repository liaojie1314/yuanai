import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { canonicalJson, generateEd25519KeyPair, verifyBytes } from './protocol'
import { ExecutionNodeClient, JobCancelledError } from './client'
import type {
  ExecutionNodeClientState,
  ExecutionNodeIdentityPersistence,
  NodeFetchLike,
  NodeWebSocketConstructor,
  PendingJob,
} from './client'
import type { ExecutionNodeIdentity } from './identity-store'

type Listener = (event?: unknown) => void

class FakeWebSocket {
  static instances: FakeWebSocket[] = []

  public readyState = 0
  public sent: string[] = []
  public closed = false
  private readonly listeners = new Map<string, Set<Listener>>()

  public constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  public addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(type, set)
  }

  public removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  public send(data: string): void {
    if (this.readyState !== 1) throw new Error('WebSocket is not open')
    this.sent.push(data)
  }

  public close(): void {
    if (this.closed) return
    this.closed = true
    this.readyState = 3
    this.emit('close')
  }

  public serverOpen(): void {
    this.readyState = 1
    this.emit('open')
  }

  public serverMessage(value: unknown): void {
    this.emit('message', { data: JSON.stringify(value) })
  }

  public serverClose(): void {
    this.close()
  }

  public sentMessages(): unknown[] {
    return this.sent.map((raw) => JSON.parse(raw) as unknown)
  }

  public lastSent(): unknown {
    const raw = this.sent.at(-1)
    return raw ? (JSON.parse(raw) as unknown) : undefined
  }

  private emit(type: string, event?: unknown): void {
    this.listeners.get(type)?.forEach((listener) => listener(event))
  }
}

const API_BASE = 'https://api.example.com/api/v1'

function createIdentity(overrides: Partial<ExecutionNodeIdentity> = {}): ExecutionNodeIdentity {
  const keyPair = generateEd25519KeyPair()
  return {
    nodeId: '0d9d1a2b-0000-4000-8000-000000000001',
    name: '办公桌电脑',
    platform: 'linux',
    appVersion: '0.1.0',
    capabilities: ['browser_open_url'],
    privateKeyJwk: keyPair.privateKeyJwk,
    publicKeyBase64Url: keyPair.publicKeyBase64Url,
    nodeToken: 'seed-token',
    tokenExpiresAt: new Date(CURRENT_TIME + 3_600_000).toISOString(),
    spool: [],
    ...overrides,
  }
}

function createIdentityStore(initial: ExecutionNodeIdentity | null = null): {
  store: ExecutionNodeIdentityPersistence
  saved: ExecutionNodeIdentity[]
  current: () => ExecutionNodeIdentity | null
} {
  let cached: ExecutionNodeIdentity | null = initial
  const saved: ExecutionNodeIdentity[] = []
  return {
    store: {
      load: vi.fn(async () => cached),
      save: vi.fn(async (identity: ExecutionNodeIdentity) => {
        cached = identity
        saved.push(identity)
      }),
      getCached: () => cached,
    },
    saved,
    current: () => cached,
  }
}

interface Harness {
  client: ExecutionNodeClient
  jobs: { executeJob: ReturnType<typeof vi.fn> }
  identityStore: ExecutionNodeIdentityPersistence
  savedIdentities: ExecutionNodeIdentity[]
  identity: () => ExecutionNodeIdentity
  states: ExecutionNodeClientState[]
  onJobOffer: ReturnType<typeof vi.fn>
  onJobStarted: ReturnType<typeof vi.fn>
  onJobSettled: ReturnType<typeof vi.fn>
  fetchFn: ReturnType<typeof vi.fn> | NodeFetchLike
  ws: () => FakeWebSocket
}

function createHarness(
  identity: ExecutionNodeIdentity | null = createIdentity(),
  overrides: {
    executeJob?: ReturnType<typeof vi.fn>
    fetchOk?: NodeFetchLike
  } = {}
): Harness {
  FakeWebSocket.instances = []
  const { store, saved } = createIdentityStore(identity)
  const states: ExecutionNodeClientState[] = []
  const jobs = { executeJob: overrides.executeJob ?? vi.fn() }
  const fetchFn =
    overrides.fetchOk ??
    vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({}),
    }))
  const onJobOffer = vi.fn()
  const onJobStarted = vi.fn()
  const onJobSettled = vi.fn()
  const client = new ExecutionNodeClient({
    identityStore: store,
    jobs,
    runtimeConfig: { apiBaseUrl: API_BASE },
    onStateChange: (state) => states.push(state),
    onJobOffer,
    onJobStarted,
    onJobSettled,
    now: () => CURRENT_TIME,
    webSocketCtor: FakeWebSocket as unknown as NodeWebSocketConstructor,
    fetchFn: fetchFn as unknown as NodeFetchLike,
  })
  return {
    client,
    jobs,
    identityStore: store,
    savedIdentities: saved,
    identity: () => {
      const stored = store.getCached()
      if (!stored) throw new Error('identity missing')
      return stored
    },
    states,
    onJobOffer,
    onJobStarted,
    onJobSettled,
    fetchFn,
    ws: () => {
      const socket = FakeWebSocket.instances.at(-1)
      if (!socket) throw new Error('no websocket created')
      return socket
    },
  }
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

async function completeHandshake(harness: Harness): Promise<FakeWebSocket> {
  const socket = harness.ws()
  socket.serverOpen()
  socket.serverMessage({ type: 'challenge', challenge: 'nonce-1', protocol_version: '1' })
  await flush()
  return socket
}

let CURRENT_TIME = 1_000_000

beforeEach(() => {
  vi.useFakeTimers()
  CURRENT_TIME = 1_000_000
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ExecutionNodeClient.register', () => {
  it('posts the snake_case register body, saves identity, and completes the challenge', async () => {
    const expiresAt = new Date(CURRENT_TIME + 3_600_000).toISOString()
    const fetchOk = vi.fn(
      async (
        _url: string,
        _init: {
          method: string
          headers: Record<string, string>
          body: string
          signal: AbortSignal
        }
      ) => ({
        ok: true,
        status: 201,
        json: async () => ({ nodeId: 'node-1', nodeToken: 'fresh-token', expiresAt }),
      })
    )
    const harness = createHarness(null, { fetchOk: fetchOk as unknown as NodeFetchLike })

    await harness.client.register({
      pairingCode: 'pairing-code-value',
      name: '办公桌电脑',
      platform: 'linux',
      appVersion: '0.1.0',
      capabilities: ['browser_open_url'],
    })

    expect(fetchOk).toHaveBeenCalledWith(
      `${API_BASE}/execution-nodes/register`,
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"pairing_code":"pairing-code-value"'),
      })
    )
    const init = fetchOk.mock.calls[0]?.[1]
    if (!init) throw new Error('register request not captured')
    const body = JSON.parse(init.body) as Record<string, unknown>
    expect(body['protocol_version']).toBe('1')
    expect(body['public_key']).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(harness.identity()).toMatchObject({ nodeId: 'node-1', nodeToken: 'fresh-token' })
    expect(harness.ws().url).toBe(
      `${API_BASE.replace('https://', 'wss://')}/execution-nodes/ws?token=fresh-token`
    )
    expect(harness.states).toEqual(['registering', 'connecting'])

    await completeHandshake(harness)

    expect(harness.client.getState()).toBe('online')
    const challengeResponse = harness
      .ws()
      .sentMessages()
      .find((message) => (message as { type?: string }).type === 'challenge_response') as {
      signature: string
    }
    const verified = verifyBytes(
      { kty: 'OKP', crv: 'Ed25519', x: harness.identity().publicKeyBase64Url },
      new TextEncoder().encode('nonce-1'),
      Buffer.from(challengeResponse.signature, 'base64url')
    )
    expect(verified).toBe(true)
  })

  it('surfaces backend detail as the error prefix and enters error state', async () => {
    const fetchFail = vi.fn(
      async (
        _url: string,
        _init: {
          method: string
          headers: Record<string, string>
          body: string
          signal: AbortSignal
        }
      ) => ({
        ok: false,
        status: 422,
        json: async () => ({ detail: 'EXECUTION_NODE_PAIRING_INVALID' }),
      })
    )
    const harness = createHarness(null, { fetchOk: fetchFail as unknown as NodeFetchLike })

    await expect(
      harness.client.register({
        pairingCode: 'bad-code',
        name: 'x',
        platform: 'linux',
        appVersion: '0.1.0',
        capabilities: [],
      })
    ).rejects.toThrow('EXECUTION_NODE_PAIRING_INVALID (HTTP 422)')

    expect(harness.client.getState()).toBe('error')
    expect(harness.client.getLastError()).toBe('EXECUTION_NODE_PAIRING_INVALID (HTTP 422)')
  })
})

describe('ExecutionNodeClient token renewal', () => {
  it('renews an expiring token with a signed payload before connecting', async () => {
    const expiring = createIdentity({
      tokenExpiresAt: new Date(CURRENT_TIME + 60_000).toISOString(),
    })
    const newExpiresAt = new Date(CURRENT_TIME + 3_600_000).toISOString()
    const fetchOk = vi.fn(
      async (
        _url: string,
        _init: {
          method: string
          headers: Record<string, string>
          body: string
          signal: AbortSignal
        }
      ) => ({
        ok: true,
        status: 200,
        json: async () => ({
          nodeId: expiring.nodeId,
          nodeToken: 'renewed-token',
          expiresAt: newExpiresAt,
        }),
      })
    )
    const harness = createHarness(expiring, { fetchOk: fetchOk as unknown as NodeFetchLike })

    await harness.client.connect()

    expect(fetchOk).toHaveBeenCalledOnce()
    const renewalCall = fetchOk.mock.calls[0]
    expect(renewalCall?.[0]).toBe(`${API_BASE}/execution-nodes/token`)
    const renewalBody = JSON.parse(renewalCall?.[1]?.body ?? '{}') as {
      node_id: string
      token: string
      signature: string
    }
    expect(renewalBody.node_id).toBe(expiring.nodeId)
    expect(renewalBody.token).toBe('seed-token')
    const signedPayload = canonicalJson({
      type: 'token_renewal',
      node_id: renewalBody.node_id,
      token: renewalBody.token,
    })
    expect(
      verifyBytes(
        { kty: 'OKP', crv: 'Ed25519', x: expiring.publicKeyBase64Url },
        new TextEncoder().encode(signedPayload),
        Buffer.from(renewalBody.signature, 'base64url')
      )
    ).toBe(true)
    expect(harness.identity().nodeToken).toBe('renewed-token')
    expect(harness.ws().url).toContain('token=renewed-token')
  })

  it('skips renewal when the token still has lead time', async () => {
    const harness = createHarness()

    await harness.client.connect()

    expect(harness.fetchFn).not.toHaveBeenCalled()
  })
})

describe('ExecutionNodeClient job lifecycle', () => {
  it('runs the full accept, progress, completed, ack, acknowledged chain', async () => {
    const harness = createHarness()
    harness.jobs.executeJob.mockImplementation(async ({ onProgress }) => {
      onProgress(10)
      onProgress(50)
      return { result: { opened: true } }
    })

    await harness.client.connect()
    const socket = await completeHandshake(harness)
    socket.serverMessage({
      type: 'job_offer',
      protocol_version: '1',
      execution_id: 'exec-1',
      tool_name: 'browser_open_url',
      tool_version: '1.0.0',
      arguments: { url: 'https://example.com' },
      arguments_preview: '{}',
      policy: { allowed_tools: ['browser_open_url'] },
      expires_at: new Date(CURRENT_TIME + 60_000).toISOString(),
      signature: 'server-signature',
    })
    await flush()

    const offer = (harness.onJobOffer.mock.calls[0]?.[0] ?? null) as PendingJob | null
    expect(offer).not.toBeNull()
    expect(offer?.executionId).toBe('exec-1')

    harness.client.acceptJob('exec-1')
    await flush()

    const messages = socket.sentMessages()
    expect(messages).toContainEqual({ type: 'accepted', execution_id: 'exec-1' })
    expect(messages).toContainEqual({ type: 'progress', execution_id: 'exec-1', progress: 10 })
    // 第二个 progress 因 500ms 节流被合并。
    expect(messages).not.toContainEqual({ type: 'progress', execution_id: 'exec-1', progress: 50 })
    const terminal = messages.find(
      (message) => (message as { type?: string }).type === 'completed'
    ) as {
      type: string
      execution_id: string
      result: Record<string, unknown>
      error_code: null
      error_message: null
      progress: number
      signature: string
    }
    expect(terminal.result).toEqual({ opened: true })
    expect(terminal.error_code).toBeNull()
    expect(terminal.error_message).toBeNull()
    expect(terminal.progress).toBe(100)
    expect(
      verifyBytes(
        { kty: 'OKP', crv: 'Ed25519', x: harness.identity().publicKeyBase64Url },
        new TextEncoder().encode(
          canonicalJson({
            type: terminal.type,
            execution_id: terminal.execution_id,
            result: terminal.result,
            error_code: terminal.error_code,
            error_message: terminal.error_message,
            progress: terminal.progress,
          })
        ),
        Buffer.from(terminal.signature, 'base64url')
      )
    ).toBe(true)
    expect(harness.identity().spool).toHaveLength(1)
    expect(harness.onJobSettled).toHaveBeenCalledWith('exec-1')

    socket.serverMessage({ type: 'ack', execution_id: 'exec-1' })
    await flush()
    expect(socket.sentMessages().at(-1)).toEqual({ type: 'ack', execution_id: 'exec-1' })

    socket.serverMessage({ type: 'acknowledged', execution_id: 'exec-1' })
    await flush()
    expect(harness.identity().spool).toHaveLength(0)
  })

  it('rejects expired job offers', async () => {
    const harness = createHarness()
    await harness.client.connect()
    const socket = await completeHandshake(harness)

    socket.serverMessage({
      type: 'job_offer',
      protocol_version: '1',
      execution_id: 'exec-old',
      tool_name: 'browser_open_url',
      tool_version: '1.0.0',
      arguments: {},
      arguments_preview: '{}',
      policy: {},
      expires_at: new Date(CURRENT_TIME - 1_000).toISOString(),
      signature: 'server-signature',
    })
    await flush()

    expect(harness.onJobOffer).not.toHaveBeenCalled()
    expect(socket.sentMessages().at(-1)).toEqual({ type: 'rejected', execution_id: 'exec-old' })
  })

  it('ignores duplicate offers and resends accepted for an active job', async () => {
    const harness = createHarness()
    harness.jobs.executeJob.mockImplementation(
      () =>
        new Promise(() => {
          // 一直挂起，保持任务处于激活状态。
        })
    )
    await harness.client.connect()
    const socket = await completeHandshake(harness)
    const offer = {
      type: 'job_offer',
      protocol_version: '1',
      execution_id: 'exec-2',
      tool_name: 'browser_open_url',
      tool_version: '1.0.0',
      arguments: { url: 'https://example.com' },
      arguments_preview: '{}',
      policy: {},
      expires_at: new Date(CURRENT_TIME + 60_000).toISOString(),
      signature: 'server-signature',
    }
    socket.serverMessage(offer)
    await flush()
    socket.serverMessage(offer)
    await flush()
    expect(harness.onJobOffer).toHaveBeenCalledOnce()

    harness.client.acceptJob('exec-2')
    await flush()
    socket.serverMessage(offer)
    await flush()

    const accepted = socket
      .sentMessages()
      .filter((message) => (message as { type?: string }).type === 'accepted')
    expect(accepted.length).toBeGreaterThanOrEqual(2)
  })

  it('resends a spooled terminal when the same offer returns', async () => {
    const spooled = {
      type: 'completed' as const,
      execution_id: 'exec-3',
      result: { opened: true },
      error_code: null,
      error_message: null,
      progress: null,
      signature: 'node-signature',
    }
    const harness = createHarness(
      createIdentity({ spool: [{ executionId: 'exec-3', message: spooled }] })
    )
    await harness.client.connect()
    const socket = await completeHandshake(harness)

    socket.serverMessage({
      type: 'job_offer',
      protocol_version: '1',
      execution_id: 'exec-3',
      tool_name: 'browser_open_url',
      tool_version: '1.0.0',
      arguments: {},
      arguments_preview: '{}',
      policy: {},
      expires_at: new Date(CURRENT_TIME + 60_000).toISOString(),
      signature: 'server-signature',
    })
    await flush()

    expect(harness.onJobOffer).not.toHaveBeenCalled()
    expect(socket.sentMessages().at(-1)).toEqual(spooled)
  })

  it('cancels an active job on cancel_request and reports a signed cancelled terminal', async () => {
    const harness = createHarness()
    harness.jobs.executeJob.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new JobCancelledError()))
        })
    )
    await harness.client.connect()
    const socket = await completeHandshake(harness)
    socket.serverMessage({
      type: 'job_offer',
      protocol_version: '1',
      execution_id: 'exec-4',
      tool_name: 'browser_open_url',
      tool_version: '1.0.0',
      arguments: {},
      arguments_preview: '{}',
      policy: {},
      expires_at: new Date(CURRENT_TIME + 60_000).toISOString(),
      signature: 'server-signature',
    })
    await flush()
    harness.client.acceptJob('exec-4')
    await flush()

    socket.serverMessage({ type: 'cancel_request', execution_id: 'exec-4' })
    await flush()

    const terminal = socket
      .sentMessages()
      .find((message) => (message as { type?: string }).type === 'cancelled') as {
      error_code: string
      execution_id: string
      result: null
    }
    expect(terminal.execution_id).toBe('exec-4')
    expect(terminal.error_code).toBe('TOOL_CANCELLED')
    expect(harness.onJobSettled).toHaveBeenCalledWith('exec-4')
  })

  it('removes a pending approval when the server cancels before local acceptance', async () => {
    const harness = createHarness()
    await harness.client.connect()
    const socket = await completeHandshake(harness)
    socket.serverMessage({
      type: 'job_offer',
      protocol_version: '1',
      execution_id: 'exec-cancelled-pending',
      tool_name: 'browser_open_url',
      tool_version: '1.0.0',
      arguments: { url: 'https://example.com' },
      arguments_preview: '{}',
      policy: {},
      expires_at: new Date(CURRENT_TIME + 60_000).toISOString(),
      signature: 'server-signature',
    })
    await flush()

    socket.serverMessage({ type: 'cancel_request', execution_id: 'exec-cancelled-pending' })
    await flush()

    expect(() => harness.client.acceptJob('exec-cancelled-pending')).toThrow(
      'EXECUTION_NODE_JOB_UNKNOWN'
    )
    expect(harness.jobs.executeJob).not.toHaveBeenCalled()
  })

  it('answers job_status for unknown executions with a signed failed terminal', async () => {
    const harness = createHarness()
    await harness.client.connect()
    const socket = await completeHandshake(harness)

    socket.serverMessage({ type: 'job_status', execution_id: 'exec-lost', status: 'running' })
    await flush()

    const terminal = socket.lastSent() as { type: string; error_code: string }
    expect(terminal.type).toBe('failed')
    expect(terminal.error_code).toBe('TOOL_NODE_STATE_LOST')
    expect(harness.identity().spool).toHaveLength(1)
  })

  it('replays spooled terminals on result_replay_request', async () => {
    const spooled = {
      type: 'failed' as const,
      execution_id: 'exec-5',
      result: null,
      error_code: 'TOOL_EXECUTION_FAILED',
      error_message: '失败',
      progress: 10,
      signature: 'node-signature',
    }
    const harness = createHarness(
      createIdentity({ spool: [{ executionId: 'exec-5', message: spooled }] })
    )
    await harness.client.connect()
    const socket = await completeHandshake(harness)

    socket.serverMessage({
      type: 'result_replay_request',
      execution_id: 'exec-5',
      status: 'failed',
    })
    await flush()

    expect(socket.sentMessages().at(-1)).toEqual(spooled)
  })

  it('ignores unknown message shapes with a warning', async () => {
    const harness = createHarness()
    await harness.client.connect()
    const socket = await completeHandshake(harness)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sentCount = socket.sent.length

    socket.serverMessage({ type: 'mystery', data: 1 })
    socket.serverMessage('not-an-object')
    await flush()

    expect(warn).toHaveBeenCalled()
    expect(socket.sent.length).toBe(sentCount)
  })

  it('sends heartbeats while online and refreshes the activity timestamp', async () => {
    const harness = createHarness()
    await harness.client.connect()
    const socket = await completeHandshake(harness)
    const activeBefore = harness.client.getLastActiveAt()

    await vi.advanceTimersByTimeAsync(25_000)

    expect(socket.sentMessages()).toContainEqual({ type: 'heartbeat' })
    expect(harness.client.getLastActiveAt()).toBeGreaterThanOrEqual(activeBefore)
  })
})

describe('ExecutionNodeClient reconnection', () => {
  it('schedules a backoff reconnect after the socket closes and recovers', async () => {
    const harness = createHarness()
    await harness.client.connect()
    const firstSocket = await completeHandshake(harness)
    expect(harness.client.getState()).toBe('online')

    firstSocket.serverClose()
    await flush()
    expect(harness.client.getState()).toBe('reconnecting')

    // 退避 1s + 最多 500ms 抖动。
    await vi.advanceTimersByTimeAsync(1_600)
    expect(FakeWebSocket.instances.length).toBe(2)
    const secondSocket = await completeHandshake(harness)
    expect(harness.client.getState()).toBe('online')
    expect(harness.client.getLastActiveAt()).toBeGreaterThan(0)
    expect(secondSocket.url).toContain('token=seed-token')
  })

  it('keeps retrying when reconnect attempts fail', async () => {
    const expiring = createIdentity({
      tokenExpiresAt: new Date(CURRENT_TIME + 60_000).toISOString(),
    })
    // 第一次续期成功建立首连，之后的续期请求全部失败。
    const fetchFailsLater = vi
      .fn()
      .mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          nodeToken: 'first-renewal',
          expiresAt: new Date(CURRENT_TIME + 60_000).toISOString(),
        }),
      }))
      .mockImplementation(async () => {
        throw new Error('network down')
      })
    const harness = createHarness(expiring, {
      fetchOk: fetchFailsLater as unknown as NodeFetchLike,
    })

    await harness.client.connect()
    const firstSocket = await completeHandshake(harness)
    firstSocket.serverClose()
    await flush()

    // 第一次重连因续期网络失败而不产生新 socket，但仍然继续退避。
    await vi.advanceTimersByTimeAsync(1_600)
    await flush()
    expect(FakeWebSocket.instances.length).toBe(1)
    expect(harness.client.getState()).toBe('reconnecting')

    await vi.advanceTimersByTimeAsync(3_000)
    expect(harness.client.getState()).toBe('reconnecting')
  })

  it('stops cleanly and aborts active jobs', async () => {
    const harness = createHarness()
    harness.jobs.executeJob.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new JobCancelledError()))
        })
    )
    await harness.client.connect()
    const socket = await completeHandshake(harness)
    socket.serverMessage({
      type: 'job_offer',
      protocol_version: '1',
      execution_id: 'exec-6',
      tool_name: 'browser_open_url',
      tool_version: '1.0.0',
      arguments: {},
      arguments_preview: '{}',
      policy: {},
      expires_at: new Date(CURRENT_TIME + 60_000).toISOString(),
      signature: 'server-signature',
    })
    await flush()
    harness.client.acceptJob('exec-6')
    await flush()

    harness.client.stop()

    expect(harness.client.getState()).toBe('stopped')
    expect(socket.closed).toBe(true)
    await flush()
    expect(harness.onJobSettled).toHaveBeenCalledWith('exec-6')
  })
})

describe('ExecutionNodeClient message safety', () => {
  it('never signs with an expired-identity-less store and refuses to connect without identity', async () => {
    const harness = createHarness(null)

    await expect(harness.client.connect()).rejects.toThrow('EXECUTION_NODE_NOT_REGISTERED')
    expect(FakeWebSocket.instances).toHaveLength(0)
  })

  it('drops sends while offline instead of throwing', async () => {
    const harness = createHarness()
    await harness.client.connect()
    const socket = await completeHandshake(harness)
    socket.serverMessage({
      type: 'job_offer',
      protocol_version: '1',
      execution_id: 'exec-offline',
      tool_name: 'browser_open_url',
      tool_version: '1.0.0',
      arguments: {},
      arguments_preview: '{}',
      policy: {},
      expires_at: new Date(CURRENT_TIME + 60_000).toISOString(),
      signature: 'server-signature',
    })
    await flush()
    socket.serverClose()
    await flush()
    const sentCount = socket.sent.length

    expect(() => harness.client.rejectJob('exec-offline')).not.toThrow()
    expect(harness.client.getState()).toBe('reconnecting')
    expect(socket.sent.length).toBe(sentCount)
  })
})
