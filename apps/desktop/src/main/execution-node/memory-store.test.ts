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

import { LocalMemoryStore } from './memory-store'
import type { LocalMemoryRecord } from './memory-store'

function record(id: string, content: string): LocalMemoryRecord {
  return { id, content, memoryType: 'profile', updatedAt: '2026-09-18T00:00:00.000Z' }
}

describe('LocalMemoryStore', () => {
  beforeEach(() => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true)
    mockSafeStorage.getSelectedStorageBackend.mockReturnValue('kwallet')
    mockSafeStorage.encryptString.mockImplementation((value: string) => Buffer.from(value))
    mockSafeStorage.decryptString.mockImplementation((value: Buffer) => value.toString('utf8'))
    mockFs.mkdir.mockResolvedValue()
    mockFs.rename.mockResolvedValue()
    mockFs.unlink.mockResolvedValue()
    mockFs.writeFile.mockResolvedValue()
    mockFs.readFile.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  function createStore(): LocalMemoryStore {
    return new LocalMemoryStore({
      app: { getPath: () => '/tmp/yuanai-test' },
      safeStorage: mockSafeStorage,
      platform: 'linux',
    })
  }

  it('本地没有存储文件时以空集合启动', async () => {
    const store = createStore()

    await store.hydrate()

    expect(store.search('任何内容', 8)).toEqual([])
  })

  it('写入后能按关键词检索回来', async () => {
    const store = createStore()
    await store.hydrate()

    await store.put(record('m1', '我的家庭住址在杭州西湖区'))

    expect(store.search('杭州', 8).map((item) => item.id)).toEqual(['m1'])
  })

  it('同一 id 重复写入是更新而非追加', async () => {
    const store = createStore()
    await store.hydrate()

    await store.put(record('m1', '旧内容杭州'))
    await store.put(record('m1', '新内容杭州'))

    const found = store.search('杭州', 8)
    expect(found).toHaveLength(1)
    expect(found[0]?.content).toBe('新内容杭州')
  })

  it('删除不存在的记忆返回 false 而不抛错', async () => {
    const store = createStore()
    await store.hydrate()

    await expect(store.remove('missing')).resolves.toBe(false)
  })

  it('删除已有记忆后检索不到', async () => {
    const store = createStore()
    await store.hydrate()
    await store.put(record('m1', '杭州'))

    await expect(store.remove('m1')).resolves.toBe(true)
    expect(store.search('杭州', 8)).toEqual([])
  })

  it('检索结果按关键词命中数排序并受 limit 截断', async () => {
    const store = createStore()
    await store.hydrate()
    await store.put(record('m1', '杭州 西湖'))
    await store.put(record('m2', '杭州'))

    expect(store.search('杭州 西湖', 1).map((item) => item.id)).toEqual(['m1'])
  })

  it('检索忽略大小写与标点差异', async () => {
    const store = createStore()
    await store.hydrate()
    await store.put(record('m1', '我在 Hangzhou，很喜欢这里。'))

    expect(store.search('hangzhou', 8).map((item) => item.id)).toEqual(['m1'])
  })

  it('空查询与无命中查询都返回空列表', async () => {
    const store = createStore()
    await store.hydrate()
    await store.put(record('m1', '杭州'))

    expect(store.search('   ', 8)).toEqual([])
    expect(store.search('上海', 8)).toEqual([])
  })

  it('以加密原子写入持久化并能重新恢复', async () => {
    const store = createStore()
    await store.put(record('m1', '杭州西湖'))

    expect(mockFs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('execution-node-memory.enc'),
      expect.any(Buffer),
      { mode: 0o600 }
    )
    const serialized = mockSafeStorage.encryptString.mock.calls.at(-1)?.[0] as string
    mockFs.readFile.mockResolvedValue(Buffer.from(serialized))

    const restored = createStore()
    await restored.hydrate()

    expect(restored.search('西湖', 8)).toEqual([record('m1', '杭州西湖')])
  })

  it('持久化数据损坏时按空集合处理', async () => {
    mockFs.readFile.mockResolvedValue(Buffer.from('bad-ciphertext'))
    mockSafeStorage.decryptString.mockImplementation(() => {
      throw new Error('corrupt')
    })
    const store = createStore()

    await expect(store.hydrate()).resolves.toBeUndefined()
    expect(store.search('杭州', 8)).toEqual([])
  })

  it('clear 清空全部记忆并删除持久化文件', async () => {
    const store = createStore()
    await store.put(record('m1', '杭州'))

    await store.clear()

    expect(store.search('杭州', 8)).toEqual([])
    expect(mockFs.unlink).toHaveBeenCalledWith(expect.stringContaining('execution-node-memory.enc'))
  })
})
