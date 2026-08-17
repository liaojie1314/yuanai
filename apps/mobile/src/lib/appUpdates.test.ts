import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
  },
}))
vi.mock('expo-application', () => ({
  nativeApplicationVersion: '0.1.0',
}))
vi.mock('expo-constants', () => ({
  default: { expoConfig: { version: '0.1.0', extra: { eas: { projectId: 'test-project' } } } },
}))
vi.mock('expo-updates', () => ({
  isEnabled: true,
  checkForUpdateAsync: vi.fn(),
  fetchUpdateAsync: vi.fn(),
  reloadAsync: vi.fn(),
}))

import {
  getMobileUpdatePolicy,
  MobileUpdateService,
  parseMobileVersion,
  type MobileUpdatesApi,
} from './appUpdates'

const api = (): MobileUpdatesApi => ({
  isEnabled: true,
  checkForUpdateAsync: vi.fn(),
  fetchUpdateAsync: vi.fn(),
  reloadAsync: vi.fn(),
})

const skipStore = () => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('mobile update policy', () => {
  it('parses and compares semantic versions', () => {
    expect(parseMobileVersion('0.1.0')).toEqual([0, 1, 0])
    expect(parseMobileVersion('dev')).toBeNull()
    expect(getMobileUpdatePolicy('0.1.0', '1.0.0')).toEqual({ mandatory: true, canSkip: false })
    expect(getMobileUpdatePolicy('0.1.0', '0.2.0')).toEqual({ mandatory: false, canSkip: true })
  })

  it('checks, downloads, and installs an update', async () => {
    const updates = api()
    vi.mocked(updates.checkForUpdateAsync).mockResolvedValue({
      isAvailable: true,
      manifest: { version: '0.2.0' },
    })
    const store = skipStore()
    const service = new MobileUpdateService({
      api: updates,
      skipStore: store,
      currentVersion: '0.1.0',
      projectConfigured: true,
    })

    await expect(service.check()).resolves.toMatchObject({
      state: 'available',
      info: { version: '0.2.0' },
    })
    await expect(service.download()).resolves.toMatchObject({ state: 'downloaded' })
    await service.install()
    expect(updates.fetchUpdateAsync).toHaveBeenCalledOnce()
    expect(updates.reloadAsync).toHaveBeenCalledOnce()
  })

  it('never skips a major update', async () => {
    const updates = api()
    vi.mocked(updates.checkForUpdateAsync).mockResolvedValue({
      isAvailable: true,
      manifest: { version: '1.0.0' },
    })
    const store = skipStore()
    const service = new MobileUpdateService({
      api: updates,
      skipStore: store,
      currentVersion: '0.1.0',
      projectConfigured: true,
    })
    await service.check()
    await service.skip()
    expect(store.set).not.toHaveBeenCalled()
  })
})
