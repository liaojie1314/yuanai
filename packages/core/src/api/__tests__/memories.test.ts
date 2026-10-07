import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { apiClient } from '../client.js'
import { exportMemories, listMemories, searchMemories } from '../memories.js'

const firstMemory = {
  id: 'memory-1',
  userId: 'user-1',
  assistantId: 'assistant-1',
  workspaceId: null,
  memoryType: 'preference' as const,
  content: '记忆内容A',
  structuredData: null,
  sourceType: 'user_input',
  sourceId: null,
  sourceExcerpt: null,
  confidence: 0.9,
  sensitivity: 'personal' as const,
  storageLocation: 'cloud' as const,
  nodeId: null,
  status: 'active' as const,
  validFrom: null,
  validUntil: null,
  lastUsedAt: null,
  createdAt: '2026-09-18T00:00:00Z',
  updatedAt: '2026-09-18T00:00:00Z',
}

const secondMemory = { ...firstMemory, id: 'memory-2', content: '记忆内容B' }

let requests: InternalAxiosRequestConfig[]
let originalAdapter: typeof apiClient.defaults.adapter

function respond(config: InternalAxiosRequestConfig, data: unknown, status = 200): AxiosResponse {
  return { config, data, headers: {}, status, statusText: 'OK' }
}

const adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
  requests.push(config)
  if (config.url === '/memories/export')
    return respond(config, { exportedAt: '2026-09-18T12:00:00Z', items: [firstMemory] })
  if (config.url === '/memories/search')
    return respond(config, { results: [], localUnavailable: true })
  if (config.url === '/memories') {
    const cursor = (config.params as { cursor?: string } | undefined)?.cursor
    return respond(
      config,
      cursor
        ? { items: [secondMemory], nextCursor: null }
        : { items: [firstMemory], nextCursor: 'cursor-2' }
    )
  }
  throw new Error(`Unexpected request ${config.method} ${config.url}`)
}

describe('记忆 API', () => {
  beforeEach(() => {
    requests = []
    originalAdapter = apiClient.defaults.adapter
    apiClient.defaults.adapter = adapter
  })

  afterEach(() => {
    if (originalAdapter === undefined) delete apiClient.defaults.adapter
    else apiClient.defaults.adapter = originalAdapter
  })

  it('把状态、游标和条数原样透传给列表接口', async () => {
    await expect(listMemories({ status: 'active', cursor: 'cursor-2', limit: 2 })).resolves.toEqual(
      {
        items: [secondMemory],
        nextCursor: null,
      }
    )

    expect(requests.map((request) => `${request.method}:${request.url}`)).toEqual(['get:/memories'])
    expect(requests[0]?.params).toEqual({ status: 'active', cursor: 'cursor-2', limit: 2 })
  })

  it('最后一页的 nextCursor 为 null', async () => {
    const firstPage = await listMemories()
    expect(firstPage.nextCursor).toBe('cursor-2')

    const lastPage = await listMemories({ cursor: firstPage.nextCursor ?? undefined })
    expect(lastPage.nextCursor).toBeNull()
    expect(lastPage.items).toEqual([secondMemory])
  })

  it('导出走独立的 /memories/export 路径', async () => {
    await expect(exportMemories()).resolves.toEqual({
      exportedAt: '2026-09-18T12:00:00Z',
      items: [firstMemory],
    })

    expect(requests.map((request) => `${request.method}:${request.url}`)).toEqual([
      'get:/memories/export',
    ])
  })

  it('检索结果带出本地节点不可用标记', async () => {
    await expect(searchMemories('assistant-1', '测试主体1')).resolves.toEqual({
      results: [],
      localUnavailable: true,
    })

    expect(requests[0]?.params).toEqual({
      assistantId: 'assistant-1',
      query: '测试主体1',
      limit: 8,
    })
  })
})
