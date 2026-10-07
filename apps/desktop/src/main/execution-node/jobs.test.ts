import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const mockFs = vi.hoisted(() => ({
  mkdir: vi.fn<() => Promise<void>>(),
  open: vi.fn<() => Promise<unknown>>(),
  readdir: vi.fn<() => Promise<unknown[]>>(),
  stat: vi.fn<() => Promise<{ isFile(): boolean; isDirectory(): boolean; size: number }>>(),
  writeFile: vi.fn<() => Promise<void>>(),
}))

vi.mock('node:fs/promises', () => ({ ...mockFs, default: mockFs }))

import {
  DesktopJobsExecutor,
  JobCancelledError,
  MAX_CLIPBOARD_CHARS,
  MAX_MEMORY_SEARCH_QUERY_CHARS,
  ToolExecutionFailure,
  assertResultSize,
  assertSafeHttpsUrl,
  resolveWorkspacePath,
} from './jobs'
import type { DesktopJobsExecutorOptions, ExecuteJobInput } from './jobs'
import type { LocalMemoryRecord } from './memory-store'

const WORKSPACE_ROOT = '/tmp/yuanai-test/agent-workspace'

/** 最小本地记忆存储替身；检索退化为子串过滤，排序规则由 memory-store 自己的测试覆盖。 */
function createStubMemoryStore(
  initial: Array<{ id: string; content: string }> = []
): DesktopJobsExecutorOptions['memoryStore'] {
  const records: LocalMemoryRecord[] = initial.map((item) => ({
    id: item.id,
    content: item.content,
    memoryType: 'profile',
    updatedAt: '2026-09-18T00:00:00.000Z',
  }))
  return {
    search: (query: string, limit: number) =>
      records.filter((item) => item.content.includes(query)).slice(0, limit),
    put: async (record: LocalMemoryRecord) => {
      const index = records.findIndex((item) => item.id === record.id)
      if (index >= 0) records.splice(index, 1, record)
      else records.push(record)
      return Promise.resolve()
    },
    remove: async (id: string) => {
      const index = records.findIndex((item) => item.id === id)
      if (index < 0) return Promise.resolve(false)
      records.splice(index, 1)
      return Promise.resolve(true)
    },
  }
}

function createExecutor(
  overrides: {
    resolvePath?: (resourceId: string) => string
    memoryStore?: DesktopJobsExecutorOptions['memoryStore']
    clipboard?: DesktopJobsExecutorOptions['clipboard']
  } = {}
): DesktopJobsExecutor {
  return new DesktopJobsExecutor({
    grants: {
      resolvePath: overrides.resolvePath ?? ((resourceId: string) => `/granted/${resourceId}`),
    },
    shell: { openExternal: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) },
    memoryStore: overrides.memoryStore ?? createStubMemoryStore(),
    clipboard: overrides.clipboard ?? { readText: () => '测试剪贴板内容' },
    workspaceRoot: WORKSPACE_ROOT,
  })
}

function createInput(
  arguments_: Record<string, unknown>,
  overrides: Partial<ExecuteJobInput> = {}
): ExecuteJobInput {
  return {
    toolName: 'browser_open_url',
    arguments: arguments_,
    signal: new AbortController().signal,
    onProgress: vi.fn(),
    ...overrides,
  }
}

/** 断言 Promise 以指定错误码的 ToolExecutionFailure 失败。 */
async function expectToolFailure(
  run: () => Promise<unknown> | unknown,
  code: string
): Promise<void> {
  try {
    await run()
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ToolExecutionFailure)
    expect((error as ToolExecutionFailure).code).toBe(code)
    return
  }
  throw new Error(`Expected ToolExecutionFailure with code ${code}`)
}

beforeEach(() => {
  mockFs.mkdir.mockResolvedValue()
  mockFs.writeFile.mockResolvedValue()
  mockFs.open.mockRejectedValue(new Error('open not configured'))
  mockFs.readdir.mockRejectedValue(new Error('readdir not configured'))
  mockFs.stat.mockRejectedValue(new Error('stat not configured'))
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('assertSafeHttpsUrl', () => {
  it('accepts clean https urls and normalizes them', () => {
    expect(assertSafeHttpsUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
  })

  it('rejects non-https, credentialed, and malformed urls', () => {
    expect(() => assertSafeHttpsUrl('http://example.com')).toThrow(ToolExecutionFailure)
    expect(() => assertSafeHttpsUrl('file:///etc/passwd')).toThrow(ToolExecutionFailure)
    expect(() => assertSafeHttpsUrl('https://user:pw@example.com')).toThrow(ToolExecutionFailure)
    expect(() => assertSafeHttpsUrl('not-a-url')).toThrow(ToolExecutionFailure)
    expect(() => assertSafeHttpsUrl('https://')).toThrow(ToolExecutionFailure)
  })
})

describe('resolveWorkspacePath', () => {
  it('accepts safe relative paths and keeps them inside the workspace', () => {
    expect(resolveWorkspacePath('notes/todo.txt', WORKSPACE_ROOT)).toBe(
      `${WORKSPACE_ROOT}/notes/todo.txt`
    )
  })

  it('rejects absolute paths, drive letters, backslashes, and traversal segments', () => {
    expect(() => resolveWorkspacePath('/etc/passwd', WORKSPACE_ROOT)).toThrow(ToolExecutionFailure)
    expect(() => resolveWorkspacePath('C:/temp/x.txt', WORKSPACE_ROOT)).toThrow(
      ToolExecutionFailure
    )
    expect(() => resolveWorkspacePath('a\\b.txt', WORKSPACE_ROOT)).toThrow(ToolExecutionFailure)
    expect(() => resolveWorkspacePath('../secret.txt', WORKSPACE_ROOT)).toThrow(
      ToolExecutionFailure
    )
    expect(() => resolveWorkspacePath('docs/../../secret.txt', WORKSPACE_ROOT)).toThrow(
      ToolExecutionFailure
    )
    expect(() => resolveWorkspacePath('docs/../..\\secret', WORKSPACE_ROOT)).toThrow(
      ToolExecutionFailure
    )
    expect(() => resolveWorkspacePath('bad\0name.txt', WORKSPACE_ROOT)).toThrow(
      ToolExecutionFailure
    )
    expect(() => resolveWorkspacePath('docs/', WORKSPACE_ROOT)).toThrow(ToolExecutionFailure)
  })
})

describe('DesktopJobsExecutor.executeJob', () => {
  it('opens only validated https urls through the injected shell', async () => {
    const executor = createExecutor()
    const shell = (
      executor as unknown as { shell: { openExternal: (url: string) => Promise<void> } }
    ).shell
    const openExternalSpy = shell.openExternal as ReturnType<typeof vi.fn>
    const onProgress = vi.fn()

    const outcome = await executor.executeJob(
      createInput({ url: 'https://example.com/docs' }, { onProgress })
    )

    expect(openExternalSpy).toHaveBeenCalledWith('https://example.com/docs')
    expect(outcome.result).toEqual({ url: 'https://example.com/docs', opened: true })
    expect(onProgress).toHaveBeenLastCalledWith(100)
  })

  it('rejects unknown tools instead of guessing', async () => {
    const executor = createExecutor()

    await expectToolFailure(
      () => executor.executeJob(createInput({}, { toolName: 'rm_rf' })),
      'TOOL_NOT_SUPPORTED'
    )
  })

  it('rejects job inputs before execution when already aborted', async () => {
    const executor = createExecutor()
    const controller = new AbortController()
    controller.abort()

    await expect(
      executor.executeJob(
        createInput({ url: 'https://example.com' }, { signal: controller.signal })
      )
    ).rejects.toBeInstanceOf(JobCancelledError)
  })

  describe('read_granted_file', () => {
    function mockFileRead(size: number, contentBytes: Buffer): void {
      mockFs.stat.mockResolvedValue({ isFile: () => true, isDirectory: () => false, size })
      const handle = {
        read: vi
          .fn<
            (
              buffer: Buffer,
              offset: number,
              length: number,
              position: number
            ) => Promise<{ bytesRead: number }>
          >()
          .mockImplementation(async (buffer: Buffer, _o, length: number) => {
            contentBytes.copy(buffer, 0, 0, Math.min(length, contentBytes.length))
            return { bytesRead: Math.min(length, contentBytes.length) }
          }),
        close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      }
      mockFs.open.mockResolvedValue(handle)
    }

    it('reads granted files as utf8 within the byte limit', async () => {
      const executor = createExecutor()
      const content = Buffer.from('报告内容', 'utf8')
      mockFileRead(content.length, content)

      const outcome = await executor.executeJob(
        createInput({ resource_id: 'res-1' }, { toolName: 'read_granted_file' })
      )

      expect(outcome.result).toEqual({
        resource_id: 'res-1',
        size_bytes: content.length,
        encoding: 'utf8',
        content: '报告内容',
        truncated: false,
      })
    })

    it('truncates oversized files and reports the original size', async () => {
      const executor = createExecutor()
      const content = Buffer.alloc(64, 'a')
      mockFileRead(content.length, content)

      const outcome = await executor.executeJob(
        createInput({ resource_id: 'res-1', max_bytes: 10 }, { toolName: 'read_granted_file' })
      )

      expect(outcome.result['truncated']).toBe(true)
      expect(outcome.result['size_bytes']).toBe(64)
      expect(outcome.result['content']).toBe('a'.repeat(10))
    })

    it('supports base64 encoding', async () => {
      const executor = createExecutor()
      const content = Buffer.from('binary-data', 'utf8')
      mockFileRead(content.length, content)

      const outcome = await executor.executeJob(
        createInput({ resource_id: 'res-1', encoding: 'base64' }, { toolName: 'read_granted_file' })
      )

      expect(outcome.result['content']).toBe(content.toString('base64'))
    })

    it('maps missing grants and files to TOOL_GRANT_NOT_FOUND', async () => {
      const executor = createExecutor({ resolvePath: () => '/granted/missing.txt' })
      mockFs.stat.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))

      await expectToolFailure(
        () =>
          executor.executeJob(
            createInput({ resource_id: 'gone' }, { toolName: 'read_granted_file' })
          ),
        'TOOL_GRANT_NOT_FOUND'
      )

      const unknownGrant = createExecutor({
        resolvePath: () => {
          throw new Error('EXECUTION_NODE_GRANT_NOT_FOUND')
        },
      })
      await expectToolFailure(
        () =>
          unknownGrant.executeJob(
            createInput({ resource_id: 'unknown' }, { toolName: 'read_granted_file' })
          ),
        'TOOL_GRANT_NOT_FOUND'
      )
    })

    it('validates max_bytes and encoding arguments', async () => {
      const executor = createExecutor()

      await expectToolFailure(
        () =>
          executor.executeJob(
            createInput(
              { resource_id: 'res-1', max_bytes: 999_999 },
              { toolName: 'read_granted_file' }
            )
          ),
        'TOOL_INVALID_INPUT'
      )
      await expectToolFailure(
        () =>
          executor.executeJob(
            createInput(
              { resource_id: 'res-1', encoding: 'hex' },
              { toolName: 'read_granted_file' }
            )
          ),
        'TOOL_INVALID_INPUT'
      )
    })
  })

  describe('list_granted_directory', () => {
    it('lists file and directory names without absolute paths and skips symlinks', async () => {
      const executor = createExecutor()
      mockFs.readdir.mockResolvedValue([
        { name: 'z.txt', isFile: () => true, isDirectory: () => false },
        { name: 'sub', isFile: () => false, isDirectory: () => true },
        { name: 'link', isFile: () => false, isDirectory: () => false },
      ])
      mockFs.stat.mockResolvedValue({ isFile: () => true, isDirectory: () => false, size: 12 })

      const outcome = await executor.executeJob(
        createInput({ resource_id: 'dir-1' }, { toolName: 'list_granted_directory' })
      )

      expect(outcome.result).toEqual({
        resource_id: 'dir-1',
        entries: [
          { name: 'sub', kind: 'directory' },
          { name: 'z.txt', kind: 'file', size_bytes: 12 },
        ],
        truncated: false,
      })
      expect(JSON.stringify(outcome.result)).not.toContain('/granted')
    })

    it('truncates entry lists beyond max_entries', async () => {
      const executor = createExecutor()
      mockFs.readdir.mockResolvedValue(
        Array.from({ length: 5 }, (_value, index) => ({
          name: `file-${index}.txt`,
          isFile: () => true,
          isDirectory: () => false,
        }))
      )
      mockFs.stat.mockResolvedValue({ isFile: () => true, isDirectory: () => false, size: 1 })

      const outcome = await executor.executeJob(
        createInput(
          { resource_id: 'dir-1', max_entries: 2 },
          { toolName: 'list_granted_directory' }
        )
      )

      expect(outcome.result['truncated']).toBe(true)
      expect((outcome.result['entries'] as unknown[]).length).toBe(2)
    })
  })

  describe('write_workspace_file', () => {
    it('creates parent directories and writes utf8 content inside the workspace', async () => {
      const executor = createExecutor()
      const onProgress = vi.fn()

      const outcome = await executor.executeJob(
        createInput(
          { relative_path: 'notes/todo.txt', content: '写作业' },
          { toolName: 'write_workspace_file', onProgress }
        )
      )

      expect(mockFs.mkdir).toHaveBeenCalledWith(`${WORKSPACE_ROOT}/notes`, {
        recursive: true,
        mode: 0o700,
      })
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        `${WORKSPACE_ROOT}/notes/todo.txt`,
        Buffer.from('写作业', 'utf8'),
        { mode: 0o600 }
      )
      expect(outcome.result).toEqual({
        relative_path: 'notes/todo.txt',
        size_bytes: Buffer.from('写作业', 'utf8').byteLength,
      })
      expect(onProgress).toHaveBeenLastCalledWith(100)
    })

    it('supports base64 encoded payloads', async () => {
      const executor = createExecutor()
      const payload = Buffer.from('payload', 'utf8')

      await executor.executeJob(
        createInput(
          { relative_path: 'data.bin', content: payload.toString('base64'), encoding: 'base64' },
          { toolName: 'write_workspace_file' }
        )
      )

      expect(mockFs.writeFile).toHaveBeenCalledWith(`${WORKSPACE_ROOT}/data.bin`, payload, {
        mode: 0o600,
      })
    })

    it('rejects traversal attempts even when they pass coarse validation', async () => {
      const executor = createExecutor()

      await expectToolFailure(
        () =>
          executor.executeJob(
            createInput(
              { relative_path: '../evil.txt', content: 'x' },
              { toolName: 'write_workspace_file' }
            )
          ),
        'TOOL_INVALID_INPUT'
      )
    })
  })

  describe('memory jobs', () => {
    it('memory.search 返回本地命中的记忆', async () => {
      const executor = createExecutor({
        memoryStore: createStubMemoryStore([{ id: 'm1', content: '杭州' }]),
      })

      const outcome = await executor.executeJob(
        createInput({ query: '杭州', limit: 8 }, { toolName: 'memory.search' })
      )

      expect(outcome.result['memories']).toEqual([
        expect.objectContaining({ id: 'm1', content: '杭州' }),
      ])
    })

    it('memory.search 的查询长度边界与后端契约一致', async () => {
      // 这个数字同时写在后端 MEMORY_SEARCH_MAX_QUERY_CHARS；改一边不改另一边，
      // 超限查询就会被云端放行、在这里失败，对用户显示成「本地记忆不可用」。
      expect(MAX_MEMORY_SEARCH_QUERY_CHARS).toBe(500)
      const executor = createExecutor({ memoryStore: createStubMemoryStore([]) })

      const atLimit = await executor.executeJob(
        createInput(
          { query: '\u67e5'.repeat(MAX_MEMORY_SEARCH_QUERY_CHARS), limit: 8 },
          { toolName: 'memory.search' }
        )
      )
      expect(atLimit.result['memories']).toEqual([])

      await expectToolFailure(
        () =>
          executor.executeJob(
            createInput(
              { query: '\u67e5'.repeat(MAX_MEMORY_SEARCH_QUERY_CHARS + 1), limit: 8 },
              { toolName: 'memory.search' }
            )
          ),
        'TOOL_INVALID_INPUT'
      )
    })

    it('memory.search 没有命中时返回空列表而不是失败', async () => {
      const executor = createExecutor({ memoryStore: createStubMemoryStore([]) })

      const outcome = await executor.executeJob(
        createInput({ query: '杭州', limit: 8 }, { toolName: 'memory.search' })
      )

      expect(outcome.result['memories']).toEqual([])
    })

    it('memory.write 写入后可被 memory.search 找到', async () => {
      const store = createStubMemoryStore([])
      const executor = createExecutor({ memoryStore: store })

      const outcome = await executor.executeJob(
        createInput(
          { memoryId: 'm1', content: '杭州', memoryType: 'profile' },
          { toolName: 'memory.write' }
        )
      )

      expect(outcome.result).toEqual({ stored: true })
      expect(store.search('杭州', 8)).toHaveLength(1)
    })

    it('memory.delete 删除不存在的记忆是幂等成功', async () => {
      const executor = createExecutor({ memoryStore: createStubMemoryStore([]) })

      const outcome = await executor.executeJob(
        createInput({ memoryId: 'missing' }, { toolName: 'memory.delete' })
      )

      expect(outcome.result).toEqual({ deleted: true })
    })

    it('memory.delete 删除已有记忆后检索不到', async () => {
      const store = createStubMemoryStore([{ id: 'm1', content: '杭州' }])
      const executor = createExecutor({ memoryStore: store })

      await executor.executeJob(createInput({ memoryId: 'm1' }, { toolName: 'memory.delete' }))

      expect(store.search('杭州', 8)).toEqual([])
    })

    it('memory.search 结果超过大小上限时失败而不是截断', async () => {
      const huge = 'x'.repeat(70_000)
      const executor = createExecutor({
        memoryStore: createStubMemoryStore([{ id: 'm1', content: huge }]),
      })

      await expectToolFailure(
        () =>
          executor.executeJob(createInput({ query: 'x', limit: 8 }, { toolName: 'memory.search' })),
        'TOOL_OUTPUT_TOO_LARGE'
      )
    })

    it('拒绝缺失或超长的记忆参数', async () => {
      const executor = createExecutor()

      await expectToolFailure(
        () => executor.executeJob(createInput({ limit: 8 }, { toolName: 'memory.search' })),
        'TOOL_INVALID_INPUT'
      )
      await expectToolFailure(
        () =>
          executor.executeJob(
            createInput({ query: '杭州', limit: 0 }, { toolName: 'memory.search' })
          ),
        'TOOL_INVALID_INPUT'
      )
      await expectToolFailure(
        () =>
          executor.executeJob(
            createInput({ memoryId: 'm1', content: '' }, { toolName: 'memory.write' })
          ),
        'TOOL_INVALID_INPUT'
      )
      await expectToolFailure(
        () => executor.executeJob(createInput({}, { toolName: 'memory.delete' })),
        'TOOL_INVALID_INPUT'
      )
    })
  })

  describe('read_clipboard', () => {
    it('returns the clipboard text with its character count', async () => {
      const executor = createExecutor({ clipboard: { readText: () => '测试剪贴板内容' } })
      const onProgress = vi.fn()

      const outcome = await executor.executeJob(
        createInput({}, { toolName: 'read_clipboard', onProgress })
      )

      expect(outcome.result).toEqual({
        text: '测试剪贴板内容',
        char_count: 7,
        truncated: false,
      })
      expect(onProgress).toHaveBeenLastCalledWith(100)
    })

    it('truncates at the requested bound instead of failing', async () => {
      const executor = createExecutor({ clipboard: { readText: () => 'abcdefghij' } })

      const outcome = await executor.executeJob(
        createInput({ max_chars: 4 }, { toolName: 'read_clipboard' })
      )

      expect(outcome.result).toEqual({ text: 'abcd', char_count: 4, truncated: true })
    })

    it('reports an empty clipboard as empty text rather than as a failure', async () => {
      const executor = createExecutor({ clipboard: { readText: () => '' } })

      const outcome = await executor.executeJob(createInput({}, { toolName: 'read_clipboard' }))

      expect(outcome.result).toEqual({ text: '', char_count: 0, truncated: false })
    })

    it('fails loudly when the native clipboard cannot be read', async () => {
      const executor = createExecutor({
        clipboard: {
          readText: () => {
            throw new Error('clipboard unavailable')
          },
        },
      })

      await expectToolFailure(
        () => executor.executeJob(createInput({}, { toolName: 'read_clipboard' })),
        'TOOL_EXECUTION_FAILED'
      )
    })

    it('rejects a max_chars outside the declared bound', async () => {
      const executor = createExecutor()

      await expectToolFailure(
        () =>
          executor.executeJob(
            createInput({ max_chars: MAX_CLIPBOARD_CHARS + 1 }, { toolName: 'read_clipboard' })
          ),
        'TOOL_INVALID_INPUT'
      )
    })
  })

  it('refuses results whose canonical form exceeds the send limit', async () => {
    try {
      assertResultSize({ blob: 'x'.repeat(70_000) })
      throw new Error('expected TOOL_OUTPUT_TOO_LARGE')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ToolExecutionFailure)
      expect((error as ToolExecutionFailure).code).toBe('TOOL_OUTPUT_TOO_LARGE')
    }
    expect(() => assertResultSize({ ok: true })).not.toThrow()
  })
})
