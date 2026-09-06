import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFs, mockSafeStorage, mockUserDataPath } = vi.hoisted(() => ({
  mockSafeStorage: {
    decryptString: vi.fn<(value: Buffer) => string>(),
    encryptString: vi.fn<(value: string) => Buffer>(),
    getSelectedStorageBackend: vi.fn<() => string>(),
    isEncryptionAvailable: vi.fn<() => boolean>(),
  },
  mockFs: {
    mkdir: vi.fn<() => Promise<void>>(),
    readFile: vi.fn<() => Promise<Buffer>>(),
    rename: vi.fn<() => Promise<void>>(),
    unlink: vi.fn<() => Promise<void>>(),
    writeFile: vi.fn<() => Promise<void>>(),
  },
  mockUserDataPath: { value: '/tmp/yuanai-test' },
}))

vi.mock('electron', () => ({
  app: { getPath: () => mockUserDataPath.value },
  safeStorage: mockSafeStorage,
}))
vi.mock('node:fs/promises', () => ({ ...mockFs, default: mockFs }))

import { authStorage } from './auth-storage'

beforeEach(() => {
  mockUserDataPath.value = '/tmp/yuanai-test'
  mockSafeStorage.isEncryptionAvailable.mockReturnValue(true)
  mockSafeStorage.getSelectedStorageBackend.mockReturnValue('kwallet')
  mockSafeStorage.encryptString.mockReturnValue(Buffer.from('ciphertext'))
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('authStorage', () => {
  it('refuses persistence when Linux safeStorage falls back to basic_text', async () => {
    mockSafeStorage.getSelectedStorageBackend.mockReturnValue('basic_text')

    await expect(authStorage.setItem('yuanai-auth', 'plain-token')).rejects.toThrow(
      'SAFE_STORAGE_UNAVAILABLE'
    )
    expect(mockFs.writeFile).not.toHaveBeenCalled()
  })

  it('writes encrypted data atomically with owner-only mode', async () => {
    await authStorage.setItem('yuanai-auth', 'plain-token')

    expect(mockSafeStorage.encryptString).toHaveBeenCalledWith('plain-token')
    expect(mockFs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('.tmp'),
      Buffer.from('ciphertext'),
      { mode: 0o600 }
    )
    expect(mockFs.rename).toHaveBeenCalledOnce()
  })

  it('resolves the user data path after Electron changes it', async () => {
    await authStorage.setItem('yuanai-auth', 'first-token')
    mockUserDataPath.value = '/tmp/yuanai-test-isolated'

    await authStorage.setItem('yuanai-auth', 'second-token')

    expect(mockFs.writeFile).toHaveBeenLastCalledWith(
      expect.stringContaining('/tmp/yuanai-test-isolated/session.enc.'),
      Buffer.from('ciphertext'),
      { mode: 0o600 }
    )
  })

  it('moves unreadable encrypted data aside and returns null', async () => {
    mockFs.readFile.mockResolvedValue(Buffer.from('bad-ciphertext'))
    mockSafeStorage.decryptString.mockImplementation(() => {
      throw new Error('corrupt')
    })

    await expect(authStorage.getItem('yuanai-auth')).resolves.toBeNull()
    expect(mockFs.rename).toHaveBeenCalledWith(
      expect.stringContaining('session.enc'),
      expect.stringContaining('.corrupt-')
    )
  })

  it('rejects payloads over one MiB before encryption', async () => {
    await expect(authStorage.setItem('yuanai-auth', 'x'.repeat(1024 * 1024 + 1))).rejects.toThrow(
      'AUTH_STORAGE_VALUE_TOO_LARGE'
    )
    expect(mockSafeStorage.encryptString).not.toHaveBeenCalled()
  })
})
