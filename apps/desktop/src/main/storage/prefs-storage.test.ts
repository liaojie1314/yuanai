import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFs } = vi.hoisted(() => ({
  mockFs: {
    mkdir: vi.fn<() => Promise<void>>(),
    readFile: vi.fn<() => Promise<Buffer>>(),
    rename: vi.fn<() => Promise<void>>(),
    writeFile: vi.fn<() => Promise<void>>(),
  },
}))

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/yuanai-test' } }))
vi.mock('node:fs/promises', () => ({ ...mockFs, default: mockFs }))

import { preferencesStorage } from './prefs-storage'

beforeEach(() => {
  mockFs.readFile.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('preferencesStorage', () => {
  it('returns defaults when no preferences exist', async () => {
    await expect(preferencesStorage.get()).resolves.toMatchObject({
      closeToTray: true,
      updateChannel: 'stable',
    })
  })

  it('rejects unknown preference fields without writing', async () => {
    await expect(preferencesStorage.update({ unknown: true })).rejects.toThrow(
      'PREFERENCES_INVALID'
    )
    expect(mockFs.writeFile).not.toHaveBeenCalled()
  })

  it('writes validated updates atomically with owner-only mode', async () => {
    await preferencesStorage.update({ closeToTray: false })

    expect(mockFs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('.tmp'),
      expect.stringContaining('"closeToTray": false'),
      { encoding: 'utf8', mode: 0o600 }
    )
    expect(mockFs.rename).toHaveBeenCalledOnce()
  })
})
