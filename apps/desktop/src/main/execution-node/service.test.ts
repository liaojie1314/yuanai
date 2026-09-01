import { basename } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesktopExecutionNodeStatus } from '../../shared/ipc-contract'
import { ExecutionNodeService } from './service'
import { generateEd25519KeyPair } from './protocol'
import type { ExecutionNodeIdentity, ExecutionNodeIdentityStore } from './identity-store'
import type { ExecutionNodeGrantStore } from './grants'
import type { NodeFetchLike, NodeWebSocketConstructor } from './client'

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

  public removeEventListener(): void {
    // 测试实现无需移除。
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
let CURRENT_TIME = 1_000_000

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

function createFakeIdentityStore(initial: ExecutionNodeIdentity | null = null): {
  store: ExecutionNodeIdentityStore
  current: () => ExecutionNodeIdentity | null
} {
  let cached: ExecutionNodeIdentity | null = initial
  return {
    store: {
      load: vi.fn(async () => cached),
      save: vi.fn(async (identity: ExecutionNodeIdentity) => {
        cached = identity
      }),
      getCached: () => cached,
      clear: vi.fn(async () => {
        cached = null
      }),
    } as unknown as ExecutionNodeIdentityStore,
    current: () => cached,
  }
}

function createFakeGrants(): { store: ExecutionNodeGrantStore; items: Array<{ path: string }> } {
  const items: Array<{
    resourceId: string
    kind: 'file' | 'directory'
    path: string
    displayName: string
    createdAt: string
  }> = []
  let counter = 0
  const store = {
    hydrate: vi.fn(async () => {}),
    createGrant: vi.fn(async (input: { kind: 'file' | 'directory'; path: string }) => {
      counter += 1
      const record = {
        resourceId: `res-${counter}`,
        kind: input.kind,
        path: input.path,
        displayName: basename(input.path),
        createdAt: new Date(CURRENT_TIME).toISOString(),
      }
      items.push(record)
      return {
        resourceId: record.resourceId,
        kind: record.kind,
        displayName: record.displayName,
        createdAt: record.createdAt,
      }
    }),
    resolvePath: vi.fn((resourceId: string) => {
      const record = items.find((item) => item.resourceId === resourceId)
      if (!record) throw new Error('EXECUTION_NODE_GRANT_NOT_FOUND')
      return record.path
    }),
    list: vi.fn(() => items.map(({ path: _path, ...view }) => view)),
    revoke: vi.fn(async (resourceId: string) => {
      const index = items.findIndex((item) => item.resourceId === resourceId)
      if (index < 0) throw new Error('EXECUTION_NODE_GRANT_NOT_FOUND')
      items.splice(index, 1)
    }),
    clear: vi.fn(async () => {
      items.splice(0)
    }),
  }
  return { store: store as unknown as ExecutionNodeGrantStore, items }
}

interface Harness {
  service: ExecutionNodeService
  identityStore: ReturnType<typeof createFakeIdentityStore>
  grants: ReturnType<typeof createFakeGrants>
  statuses: DesktopExecutionNodeStatus[]
  ws: () => FakeWebSocket
  jobs: { executeJob: ReturnType<typeof vi.fn> }
  fetchFn: ReturnType<typeof vi.fn>
  dialog: { showOpenDialog: ReturnType<typeof vi.fn> }
}

function createHarness(
  identity: ExecutionNodeIdentity | null = null,
  overrides: { jobsExecute?: ReturnType<typeof vi.fn> } = {}
): Harness {
  FakeWebSocket.instances = []
  const identityStore = createFakeIdentityStore(identity)
  const grants = createFakeGrants()
  const statuses: DesktopExecutionNodeStatus[] = []
  const jobs = { executeJob: overrides.jobsExecute ?? vi.fn() }
  const fetchFn = vi.fn(async () => ({
    ok: true,
    status: 201,
    json: async () => ({}),
  }))
  const dialog = { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) }
  const service = new ExecutionNodeService({
    identityStore: identityStore.store,
    grants: grants.store,
    runtimeConfig: { apiBaseUrl: API_BASE },
    app: { getPath: () => '/tmp/yuanai-test', getVersion: () => '0.1.0' },
    dialog,
    shell: { openExternal: vi.fn(async () => {}) },
    onStatus: (status) => statuses.push(status),
    webSocketCtor: FakeWebSocket as unknown as NodeWebSocketConstructor,
    fetchFn: fetchFn as unknown as NodeFetchLike,
    jobsExecutor: jobs,
    now: () => CURRENT_TIME,
  })
  return {
    service,
    identityStore,
    grants,
    statuses,
    jobs,
    fetchFn,
    dialog,
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

beforeEach(() => {
  vi.useFakeTimers()
  CURRENT_TIME = 1_000_000
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ExecutionNodeService start', () => {
  it('hydrates grants and does not connect without an identity', async () => {
    const harness = createHarness(null)

    await harness.service.start()

    expect(harness.grants.store.hydrate).toHaveBeenCalledOnce()
    expect(FakeWebSocket.instances).toHaveLength(0)
    await expect(harness.service.getStatus()).resolves.toMatchObject({
      state: 'idle',
      capabilities: [],
      grants: [],
    })
  })

  it('auto reconnects when an identity exists and broadcasts online status', async () => {
    const harness = createHarness(createIdentity())

    await harness.service.start()
    await completeHandshake(harness)

    expect(FakeWebSocket.instances).toHaveLength(1)
    const latest = harness.statuses.at(-1)
    expect(latest).toMatchObject({
      state: 'online',
      nodeId: '0d9d1a2b-0000-4000-8000-000000000001',
      name: '办公桌电脑',
      capabilities: ['browser_open_url'],
    })
    expect(latest?.tokenExpiresAt).toBeTruthy()
  })

  it('keeps startup alive when auto reconnect fails', async () => {
    const harness = createHarness(
      createIdentity({ tokenExpiresAt: new Date(CURRENT_TIME + 1_000).toISOString() })
    )
    harness.fetchFn.mockRejectedValue(new Error('network down'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(harness.service.start()).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalled()
    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(harness.statuses).toHaveLength(0)
  })
})

describe('ExecutionNodeService.register', () => {
  it('registers with platform, app version, and the full capability whitelist by default', async () => {
    const harness = createHarness(null)
    harness.fetchFn.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        nodeId: 'node-1',
        nodeToken: 'fresh-token',
        expiresAt: new Date(CURRENT_TIME + 3_600_000).toISOString(),
        protocolVersion: '1',
      }),
    })

    const status = await harness.service.register({
      pairingCode: 'pairing-code-value',
      name: '新节点',
    })

    const body = JSON.parse(
      (harness.fetchFn.mock.calls[0]?.[1] as { body: string }).body
    ) as Record<string, unknown>
    expect(body['platform']).toBe(process.platform)
    expect(body['app_version']).toBe('0.1.0')
    expect(body['capabilities']).toEqual([
      'browser_open_url',
      'read_granted_file',
      'list_granted_directory',
      'write_workspace_file',
    ])
    expect(status.nodeId).toBe('node-1')
    expect(status.name).toBe('新节点')
  })

  it('rejects capabilities outside the fixed whitelist', async () => {
    const harness = createHarness(null)

    await expect(
      harness.service.register({
        pairingCode: 'pairing-code-value',
        name: '新节点',
        capabilities: ['browser_open_url', 'rm_rf'],
      })
    ).rejects.toThrow('EXECUTION_NODE_CAPABILITY_INVALID')

    expect(harness.fetchFn).not.toHaveBeenCalled()
    expect(FakeWebSocket.instances).toHaveLength(0)
  })

  it('never exposes tokens or private keys in the status snapshot', async () => {
    const harness = createHarness(null)
    harness.fetchFn.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        nodeId: 'node-1',
        nodeToken: 'fresh-token-value',
        expiresAt: new Date(CURRENT_TIME + 3_600_000).toISOString(),
        protocolVersion: '1',
      }),
    })

    const status = await harness.service.register({
      pairingCode: 'pairing-code-value',
      name: '新节点',
    })
    const serialized = JSON.stringify(status)

    expect(serialized).not.toContain('fresh-token-value')
    expect(serialized).not.toContain('privateKeyJwk')
    expect(serialized).not.toContain('"d"')
  })
})

describe('ExecutionNodeService job decisions', () => {
  it('forwards accept and runs the job through the sanitized status views', async () => {
    const harness = createHarness(createIdentity(), {
      jobsExecute: vi.fn(async ({ onProgress }: { onProgress: (value: number) => void }) => {
        onProgress(40)
        return { result: { opened: true } }
      }),
    })
    await harness.service.start()
    const socket = await completeHandshake(harness)
    socket.serverMessage({
      type: 'job_offer',
      protocol_version: '1',
      execution_id: 'exec-1',
      tool_name: 'browser_open_url',
      tool_version: '1.0.0',
      arguments: { url: 'https://example.com' },
      arguments_preview: '{}',
      policy: {},
      expires_at: new Date(CURRENT_TIME + 60_000).toISOString(),
      signature: 'server-signature',
    })
    await flush()

    expect(harness.statuses.at(-1)).toMatchObject({
      pendingJob: { executionId: 'exec-1', toolName: 'browser_open_url' },
      currentJob: null,
    })

    await harness.service.respondJob({ executionId: 'exec-1', decision: 'accept' })
    await flush()

    expect(socket.sentMessages()).toContainEqual({ type: 'accepted', execution_id: 'exec-1' })
    expect(harness.statuses.at(-1)).toMatchObject({
      currentJob: null,
      pendingJob: null,
    })

    socket.serverMessage({ type: 'ack', execution_id: 'exec-1' })
    socket.serverMessage({ type: 'acknowledged', execution_id: 'exec-1' })
    await flush()

    expect(socket.sentMessages().at(-1)).toEqual({ type: 'ack', execution_id: 'exec-1' })
    expect(harness.identityStore.current()?.spool).toHaveLength(0)
  })

  it('forwards reject decisions', async () => {
    const harness = createHarness(createIdentity())
    await harness.service.start()
    const socket = await completeHandshake(harness)
    socket.serverMessage({
      type: 'job_offer',
      protocol_version: '1',
      execution_id: 'exec-2',
      tool_name: 'browser_open_url',
      tool_version: '1.0.0',
      arguments: {},
      arguments_preview: '{}',
      policy: {},
      expires_at: new Date(CURRENT_TIME + 60_000).toISOString(),
      signature: 'server-signature',
    })
    await flush()

    await harness.service.respondJob({ executionId: 'exec-2', decision: 'reject' })

    expect(socket.lastSent()).toEqual({ type: 'rejected', execution_id: 'exec-2' })
    expect(harness.statuses.at(-1)?.pendingJob).toBeNull()
  })

  it('removes a pending approval when the server cancels the offer', async () => {
    const harness = createHarness(createIdentity())
    await harness.service.start()
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
    expect(harness.statuses.at(-1)?.pendingJob?.executionId).toBe('exec-cancelled-pending')

    socket.serverMessage({ type: 'cancel_request', execution_id: 'exec-cancelled-pending' })
    await flush()

    expect(harness.statuses.at(-1)?.pendingJob).toBeNull()
    await expect(
      harness.service.respondJob({ executionId: 'exec-cancelled-pending', decision: 'accept' })
    ).rejects.toThrow('EXECUTION_NODE_JOB_UNKNOWN')
  })
})

describe('ExecutionNodeService grants', () => {
  it('creates grants through the native dialog and returns path-free views', async () => {
    const harness = createHarness(createIdentity())
    const dialog = harness.dialog
    dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/home/user/机密/报告.pdf'],
    })

    const view = await harness.service.createGrant({ kind: 'file' })

    expect(view).toEqual({
      resourceId: 'res-1',
      kind: 'file',
      displayName: '报告.pdf',
      createdAt: expect.any(String),
    })
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ properties: ['openFile'] })
    )
    expect(JSON.stringify(harness.statuses.at(-1)?.grants)).not.toContain('/home/user')
  })

  it('returns null when the user cancels the dialog', async () => {
    const harness = createHarness(createIdentity())

    await expect(harness.service.createGrant({ kind: 'directory' })).resolves.toBeNull()
    expect(harness.grants.store.createGrant).not.toHaveBeenCalled()
  })

  it('revokes grants and broadcasts the update', async () => {
    const harness = createHarness(createIdentity())
    const dialog = harness.dialog
    dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/a.txt'] })
    const view = await harness.service.createGrant({ kind: 'file' })

    await harness.service.revokeGrant({ resourceId: view?.resourceId ?? '' })

    expect(harness.statuses.at(-1)?.grants).toEqual([])
    await expect(harness.service.revokeGrant({ resourceId: 'missing' })).rejects.toThrow(
      'EXECUTION_NODE_GRANT_NOT_FOUND'
    )
  })
})

describe('ExecutionNodeService teardown', () => {
  it('disconnect keeps the identity but closes the socket', async () => {
    const harness = createHarness(createIdentity())
    await harness.service.start()
    const socket = await completeHandshake(harness)

    await harness.service.disconnect()

    expect(socket.closed).toBe(true)
    expect(harness.identityStore.current()).not.toBeNull()
    expect(harness.statuses.at(-1)).toMatchObject({ state: 'idle', nodeId: expect.any(String) })
  })

  it('removeNode clears identity, grants, and spool', async () => {
    const harness = createHarness(createIdentity())
    await harness.service.start()

    await harness.service.removeNode()

    expect(harness.identityStore.current()).toBeNull()
    expect(harness.grants.store.clear).toHaveBeenCalledOnce()
    expect(harness.statuses.at(-1)).toMatchObject({
      state: 'idle',
      capabilities: [],
      grants: [],
      tokenExpiresAt: null,
    })
  })

  it('stop fully stops the underlying client', async () => {
    const harness = createHarness(createIdentity())
    await harness.service.start()
    const socket = await completeHandshake(harness)

    harness.service.stop()

    expect(harness.statuses.at(-1)?.state).toBe('stopped')
    expect(socket.closed).toBe(true)
  })
})
