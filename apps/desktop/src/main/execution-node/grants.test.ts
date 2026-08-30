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

import { ExecutionNodeGrantStore } from './grants'

describe('ExecutionNodeGrantStore', () => {
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

  function createStore(): ExecutionNodeGrantStore {
    return new ExecutionNodeGrantStore({
      app: { getPath: () => '/tmp/yuanai-test' },
      safeStorage: mockSafeStorage,
      platform: 'linux',
    })
  }

  it('creates grants with stable resource ids and never exposes paths in views', async () => {
    const store = createStore()

    const view = await store.createGrant({
      kind: 'file',
      path: '/home/user/secret/报告.pdf',
    })

    expect(view.resourceId).toMatch(/^[0-9a-f-]{36}$/)
    expect(view).toEqual({
      resourceId: view.resourceId,
      kind: 'file',
      displayName: '报告.pdf',
      createdAt: expect.any(String),
    })
    expect(store.list()).toEqual([view])
    expect(JSON.stringify(store.list())).not.toContain('/home/user')
  })

  it('resolves resource ids to real paths only inside the main process', async () => {
    const store = createStore()
    const view = await store.createGrant({ kind: 'directory', path: '/home/user/docs/' })

    expect(store.resolvePath(view.resourceId)).toBe('/home/user/docs')
  })

  it('throws when resolving or revoking an unknown resource id', async () => {
    const store = createStore()

    expect(() => store.resolvePath('missing')).toThrow('EXECUTION_NODE_GRANT_NOT_FOUND')
    await expect(store.revoke('missing')).rejects.toThrow('EXECUTION_NODE_GRANT_NOT_FOUND')
  })

  it('rejects invalid grant input before touching storage', async () => {
    const store = createStore()

    await expect(store.createGrant({ kind: 'browser' as never, path: '/tmp/x' })).rejects.toThrow(
      'GRANT_INPUT_INVALID'
    )
    await expect(store.createGrant({ kind: 'file', path: '   ' })).rejects.toThrow(
      'GRANT_INPUT_INVALID'
    )
    expect(mockFs.writeFile).not.toHaveBeenCalled()
  })

  it('persists grants as encrypted atomic writes with owner-only permissions', async () => {
    const store = createStore()
    await store.createGrant({ kind: 'file', path: '/tmp/a.txt' })

    expect(mockFs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('execution-node-grants.enc'),
      expect.any(Buffer),
      { mode: 0o600 }
    )
    expect(mockFs.rename).toHaveBeenCalledOnce()
  })

  it('rehydrates persisted grants and revokes them durably', async () => {
    const store = createStore()
    const view = await store.createGrant({ kind: 'file', path: '/tmp/a.txt' })
    const serialized = mockSafeStorage.encryptString.mock.calls.at(-1)?.[0] as string
    mockFs.readFile.mockResolvedValue(Buffer.from(serialized))

    const restored = createStore()
    await restored.hydrate()

    expect(restored.list()).toEqual([view])
    expect(restored.resolvePath(view.resourceId)).toBe('/tmp/a.txt')
    await restored.revoke(view.resourceId)
    expect(restored.list()).toEqual([])
  })

  it('treats corrupt persisted data as an empty table', async () => {
    mockFs.readFile.mockResolvedValue(Buffer.from('bad-ciphertext'))
    mockSafeStorage.decryptString.mockImplementation(() => {
      throw new Error('corrupt')
    })
    const store = createStore()

    await expect(store.hydrate()).resolves.toBeUndefined()
    expect(store.list()).toEqual([])
  })

  it('clear removes every grant and the persisted file', async () => {
    const store = createStore()
    await store.createGrant({ kind: 'file', path: '/tmp/a.txt' })

    await store.clear()

    expect(store.list()).toEqual([])
    expect(mockFs.unlink).toHaveBeenCalledWith(expect.stringContaining('execution-node-grants.enc'))
  })
})
