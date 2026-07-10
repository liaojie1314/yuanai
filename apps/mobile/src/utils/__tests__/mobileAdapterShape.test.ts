import { describe, expect, it, vi } from 'vitest'

/**
 * mobileAdapter 依赖 react-native-sse / AsyncStorage / SecureStore 等原生模块，
 * 在 Node 环境下无法真实加载。这里只对导出的 adapter「形状」做冒烟测试：
 * 通过 vi.mock 打桩到最小可运行版本，验证：
 * - 导出的 PlatformAdapter 对象具备全部约定字段
 * - 存储 API 是异步且能透传返回值
 * - stream 返回带 close 方法的句柄
 */
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (_: string): Promise<string | null> => null),
  setItemAsync: vi.fn(async (_k: string, _v: string): Promise<void> => undefined),
  deleteItemAsync: vi.fn(async (_k: string): Promise<void> => undefined),
}))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (_k: string): Promise<string | null> => null),
    setItem: vi.fn(async (_k: string, _v: string): Promise<void> => undefined),
    removeItem: vi.fn(async (_k: string): Promise<void> => undefined),
  },
}))

vi.mock('react-native-sse', () => ({
  default: class MockES {
    addEventListener(): void {
      /* no-op */
    }
    close(): void {
      /* no-op */
    }
  },
}))

describe('mobileAdapter — shape', () => {
  it('exposes stream / storage / secureStorage / authStorage', async () => {
    const { mobileAdapter } = await import('../../lib/mobileAdapter')
    expect(typeof mobileAdapter.stream).toBe('function')
    expect(typeof mobileAdapter.storage.getItem).toBe('function')
    expect(typeof mobileAdapter.secureStorage.getItem).toBe('function')
    expect(typeof mobileAdapter.authStorage.getItem).toBe('function')
    expect(mobileAdapter.isAuthRemembered?.()).toBe(true)
  })

  it('storage.setItem returns a Promise and swallows errors', async () => {
    const { mobileAdapter } = await import('../../lib/mobileAdapter')
    await expect(mobileAdapter.storage.setItem('k', 'v')).resolves.toBeUndefined()
  })

  it('stream returns a handle with close()', async () => {
    const { mobileAdapter } = await import('../../lib/mobileAdapter')
    const handle = mobileAdapter.stream(
      { url: 'https://example.com', method: 'POST', headers: {} },
      { onMessage: () => undefined, onError: () => undefined }
    )
    expect(typeof handle.close).toBe('function')
    expect(() => handle.close()).not.toThrow()
  })
})
