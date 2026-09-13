import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { apiClient } from '../client.js'
import {
  createKnowledgeBase,
  createKnowledgeTextSource,
  listKnowledgeBases,
  listKnowledgeSources,
  publishKnowledgeDocument,
  searchKnowledgeBase,
} from '../knowledge.js'

const base = {
  id: 'base-1',
  ownerId: 'user-1',
  name: 'Research',
  spaceId: null,
  createdAt: '2026-09-13T00:00:00Z',
  updatedAt: '2026-09-13T00:00:00Z',
}

const document = {
  id: 'document-1',
  sourceId: 'source-1',
  version: 1,
  contentHash: 'hash',
  status: 'staged' as const,
  createdAt: '2026-09-13T00:00:00Z',
  publishedAt: null,
}

const source = {
  id: 'source-1',
  knowledgeBaseId: 'base-1',
  name: 'Notes',
  sourceType: 'text',
  sourceUri: null,
  createdAt: '2026-09-13T00:00:00Z',
  documents: [document],
}

let requests: InternalAxiosRequestConfig[]
let originalAdapter: typeof apiClient.defaults.adapter

function respond(config: InternalAxiosRequestConfig, data: unknown, status = 200): AxiosResponse {
  return { config, data, headers: {}, status, statusText: 'OK' }
}

const adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
  requests.push(config)
  if (config.url === '/knowledge-bases')
    return respond(config, config.method === 'post' ? base : [base], 201)
  if (config.url === '/knowledge-bases/base-1/sources/text') return respond(config, document, 201)
  if (config.url === '/knowledge-bases/base-1/sources') return respond(config, [source])
  if (config.url?.endsWith('/publish')) return respond(config, { ...document, status: 'published' })
  if (config.url === '/knowledge-bases/base-1/search') return respond(config, [])
  throw new Error(`Unexpected request ${config.method} ${config.url}`)
}

describe('knowledge API', () => {
  beforeEach(() => {
    requests = []
    originalAdapter = apiClient.defaults.adapter
    apiClient.defaults.adapter = adapter
  })

  afterEach(() => {
    if (originalAdapter === undefined) delete apiClient.defaults.adapter
    else apiClient.defaults.adapter = originalAdapter
  })

  it('uses the knowledge base lifecycle paths and payloads', async () => {
    await expect(listKnowledgeBases()).resolves.toEqual([base])
    await expect(createKnowledgeBase({ name: 'Research' })).resolves.toEqual(base)
    await expect(
      createKnowledgeTextSource('base-1', { name: 'Notes', content: 'Published material' })
    ).resolves.toEqual(document)
    await expect(listKnowledgeSources('base-1')).resolves.toEqual([source])
    await expect(
      publishKnowledgeDocument('base-1', 'source-1', 'document-1')
    ).resolves.toMatchObject({
      status: 'published',
    })
    await expect(searchKnowledgeBase('base-1', { query: 'material' })).resolves.toEqual([])

    expect(requests.map((request) => `${request.method}:${request.url}`)).toEqual([
      'get:/knowledge-bases',
      'post:/knowledge-bases',
      'post:/knowledge-bases/base-1/sources/text',
      'get:/knowledge-bases/base-1/sources',
      'post:/knowledge-bases/base-1/sources/source-1/documents/document-1/publish',
      'post:/knowledge-bases/base-1/search',
    ])
    expect(JSON.parse(String(requests[5]?.data))).toEqual({ query: 'material' })
  })
})
