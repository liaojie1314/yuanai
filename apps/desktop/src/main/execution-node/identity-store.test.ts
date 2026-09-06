import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFs, mockSafeStorage } = vi.hoisted(() => ({
  mockSafeStorage: {
    decryptString: vi.fn<(value: Buffer) => string>(),
    encryptString: vi.fn<(value: string) => Buffer>(),
    getSelectedStorageBackend: vi.fn<() => string | null>(),
    isEncryptionAvailable: vi.fn<() => boolean>(),
  },
  mockFs: {
    mkdir: vi.fn<() => Promise<void>>(),
    readFile: vi.fn<() => Promise<Buffer>>(),
    rename: vi.fn<() => Promise<void>>(),
    unlink: vi.fn<() => Promise<void>>(),
    writeFile: vi.fn<() => Promise<void>>(),
  },
}))

vi.mock('node:fs/promises', () => ({ ...mockFs, default: mockFs }))

import { ExecutionNodeIdentityStore, parseIdentity } from './identity-store'
import type { ExecutionNodeIdentity } from './identity-store'
import { generateEd25519KeyPair } from './protocol'

function buildIdentity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { privateKeyJwk, publicKeyBase64Url } = generateEd25519KeyPair()
  return {
    nodeId: '0d9d1a2b-0000-4000-8000-000000000001',
    name: '办公桌电脑',
    platform: 'linux',
    appVersion: '0.1.0',
    capabilities: ['browser_open_url'],
    privateKeyJwk,
    publicKeyBase64Url,
    nodeToken: 'node-token-value',
    tokenExpiresAt: '2026-08-30T10:00:00.000Z',
    spool: [],
    ...overrides,
  }
}

function asIdentity(record: Record<string, unknown>): ExecutionNodeIdentity {
  return record as unknown as ExecutionNodeIdentity
}

describe('parseIdentity', () => {
  it('accepts a well-formed identity payload', () => {
    const identity = buildIdentity()

    expect(parseIdentity(identity)).toMatchObject({
      nodeId: identity['nodeId'],
      name: '办公桌电脑',
    })
  })

  it('rejects payloads with a malformed key, token, or spool entry', () => {
    expect(parseIdentity({ ...buildIdentity(), privateKeyJwk: { kty: 'RSA' } })).toBeNull()
    expect(parseIdentity({ ...buildIdentity(), tokenExpiresAt: 'not-a-date' })).toBeNull()
    expect(
      parseIdentity({
        ...buildIdentity(),
        spool: [{ executionId: 'exec-1', message: { type: 'bogus' } }],
      })
    ).toBeNull()
    expect(parseIdentity(null)).toBeNull()
  })
})

describe('ExecutionNodeIdentityStore', () => {
  beforeEach(() => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true)
    mockSafeStorage.getSelectedStorageBackend.mockReturnValue('kwallet')
    mockSafeStorage.encryptString.mockImplementation((value: string) => Buffer.from(value))
    mockSafeStorage.decryptString.mockImplementation((value: Buffer) => value.toString('utf8'))
    mockFs.mkdir.mockResolvedValue()
    mockFs.rename.mockResolvedValue()
    mockFs.unlink.mockResolvedValue()
    mockFs.readFile.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  function createStore(): ExecutionNodeIdentityStore {
    return new ExecutionNodeIdentityStore({
      app: { getPath: () => '/tmp/yuanai-test' },
      safeStorage: mockSafeStorage,
      platform: 'linux',
    })
  }

  it('refuses persistence when Linux safeStorage falls back to basic_text', async () => {
    mockSafeStorage.getSelectedStorageBackend.mockReturnValue('basic_text')
    const store = createStore()

    await expect(store.save(asIdentity(buildIdentity()))).rejects.toThrow(
      'SAFE_STORAGE_UNAVAILABLE'
    )
    await expect(store.load()).rejects.toThrow('SAFE_STORAGE_UNAVAILABLE')
    expect(mockFs.writeFile).not.toHaveBeenCalled()
  })

  it('saves identities atomically with owner-only permissions and keeps them in memory', async () => {
    const store = createStore()
    const identity = buildIdentity()

    await store.save(asIdentity(identity))

    expect(mockFs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('execution-node.enc'),
      expect.any(Buffer),
      { mode: 0o600 }
    )
    expect(mockFs.rename).toHaveBeenCalledOnce()
    expect(store.getCached()).toMatchObject({ nodeId: identity['nodeId'] })
  })

  it('loads persisted identities and caches them for synchronous access', async () => {
    const identity = buildIdentity({
      spool: [
        {
          executionId: 'exec-1',
          message: {
            type: 'completed',
            execution_id: 'exec-1',
            result: { opened: true },
            error_code: null,
            error_message: null,
            progress: null,
            signature: 'sig',
          },
        },
      ],
    })
    mockFs.readFile.mockResolvedValue(Buffer.from(JSON.stringify(identity)))
    const store = createStore()

    await expect(store.load()).resolves.toMatchObject({ nodeId: identity['nodeId'] })
    expect(store.getCached()?.spool).toHaveLength(1)
  })

  it('returns null for a missing file and keeps the cache empty', async () => {
    const store = createStore()

    await expect(store.load()).resolves.toBeNull()
    expect(store.getCached()).toBeNull()
  })

  it('quarantines corrupt ciphertext instead of throwing', async () => {
    mockFs.readFile.mockResolvedValue(Buffer.from('bad-ciphertext'))
    mockSafeStorage.decryptString.mockImplementation(() => {
      throw new Error('corrupt')
    })
    const store = createStore()

    await expect(store.load()).resolves.toBeNull()
    expect(mockFs.rename).toHaveBeenCalledWith(
      expect.stringContaining('execution-node.enc'),
      expect.stringContaining('.corrupt-')
    )
  })

  it('quarantines structurally invalid plaintext identities', async () => {
    mockFs.readFile.mockResolvedValue(Buffer.from(JSON.stringify({ broken: true })))
    const store = createStore()

    await expect(store.load()).resolves.toBeNull()
    expect(mockFs.rename).toHaveBeenCalledOnce()
  })

  it('rejects oversized payloads before encryption', async () => {
    const store = createStore()
    const identity = buildIdentity({ name: 'x'.repeat(512 * 1024) })

    await expect(store.save(asIdentity(identity))).rejects.toThrow(
      'EXECUTION_NODE_STORE_VALUE_TOO_LARGE'
    )
    expect(mockFs.writeFile).not.toHaveBeenCalled()
  })

  it('clear removes the encrypted file and the memory cache', async () => {
    const store = createStore()
    await store.save(asIdentity(buildIdentity()))

    await store.clear()

    expect(mockFs.unlink).toHaveBeenCalledWith(expect.stringContaining('execution-node.enc'))
    expect(store.getCached()).toBeNull()
  })
})
