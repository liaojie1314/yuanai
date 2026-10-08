import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { apiClient } from '../client.js'
import { updateMemoryScope } from '../memories.js'
import {
  acceptPersonaCandidate,
  getPersona,
  getPersonaPreview,
  listPersonaCandidates,
  listPersonaVersions,
  rejectPersonaCandidate,
  rollbackPersona,
  updatePersona,
} from '../personas.js'

const persona = {
  assistantId: 'a1',
  addressUser: '老板',
  selfName: '小元',
  tone: 'concise' as const,
  verbosity: 'balanced' as const,
  greeting: '早上好',
  refusalStyle: '直接说明原因',
  forbiddenTopics: ['赌博'],
  language: 'zh-CN',
  version: 2,
  updatedAt: '2026-10-07T00:00:00Z',
}

const version = {
  version: 1,
  changeReason: 'manual',
  payload: { tone: 'patient' },
  createdAt: '2026-10-07T00:00:00Z',
}

const preview = { fragment: '语气：简洁直接', truncated: false, characterBudget: 1200 }

const candidate = {
  id: 'c1',
  assistantId: 'a1',
  field: 'tone',
  suggestedValue: 'concise',
  evidence: '别太啰嗦',
  sourceType: 'chat' as const,
  status: 'pending' as const,
  createdAt: '2026-10-07T00:00:00Z',
}

let requests: InternalAxiosRequestConfig[]
let originalAdapter: typeof apiClient.defaults.adapter

function respond(config: InternalAxiosRequestConfig, data: unknown, status = 200): AxiosResponse {
  return { config, data, headers: {}, status, statusText: 'OK' }
}

const adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
  requests.push(config)
  const url = config.url ?? ''
  if (url === '/agent/assistants/a1/persona') return respond(config, persona)
  if (url === '/agent/assistants/a1/persona/versions') return respond(config, [version])
  if (url.endsWith('/rollback')) return respond(config, persona)
  if (url === '/agent/assistants/a1/persona/preview') return respond(config, preview)
  if (url === '/agent/persona-candidates') return respond(config, [candidate])
  if (url.endsWith('/accept')) return respond(config, { ...candidate, status: 'accepted' })
  if (url.endsWith('/reject')) return respond(config, { ...candidate, status: 'rejected' })
  if (url === '/memories/m1/scope') return respond(config, { id: 'm1', assistantId: null })
  throw new Error(`Unexpected request ${config.method} ${url}`)
}

describe('人格 API', () => {
  beforeEach(() => {
    requests = []
    originalAdapter = apiClient.defaults.adapter
    apiClient.defaults.adapter = adapter
  })

  afterEach(() => {
    if (originalAdapter === undefined) delete apiClient.defaults.adapter
    else apiClient.defaults.adapter = originalAdapter
  })

  it('读写、版本、回滚与预览都挂在助理人格路径下', async () => {
    await expect(getPersona('a1')).resolves.toEqual(persona)
    await expect(updatePersona('a1', { tone: 'lively' })).resolves.toEqual(persona)
    await expect(listPersonaVersions('a1')).resolves.toEqual([version])
    await expect(rollbackPersona('a1', 2)).resolves.toEqual(persona)
    await expect(getPersonaPreview('a1')).resolves.toEqual(preview)

    expect(requests.map((request) => `${request.method}:${request.url}`)).toEqual([
      'get:/agent/assistants/a1/persona',
      'put:/agent/assistants/a1/persona',
      'get:/agent/assistants/a1/persona/versions',
      'post:/agent/assistants/a1/persona/versions/2/rollback',
      'get:/agent/assistants/a1/persona/preview',
    ])
    expect(JSON.parse(String(requests[1]?.data))).toEqual({ tone: 'lively' })
  })

  it('预览带上未保存的草稿，数组用重复键而不是带下标的键', async () => {
    await expect(
      getPersonaPreview('a1', { tone: 'lively', forbiddenTopics: ['赌博', '算命'] })
    ).resolves.toEqual(preview)

    // 预览不先保存就要能反映表单，草稿必须真的发出去；
    // 带下标的 forbiddenTopics[0] 后端的 list[str] 读不到，会静默退回已保存的人格
    expect(requests[0]?.params).toEqual({ tone: 'lively', forbiddenTopics: ['赌博', '算命'] })
    expect(requests[0]?.paramsSerializer).toEqual({ indexes: null })
  })

  it('候选收件箱按状态筛选，采用与忽略各走一条路径', async () => {
    await expect(listPersonaCandidates('pending')).resolves.toEqual([candidate])
    await expect(acceptPersonaCandidate('c1')).resolves.toEqual({
      ...candidate,
      status: 'accepted',
    })
    await expect(rejectPersonaCandidate('c1')).resolves.toEqual({
      ...candidate,
      status: 'rejected',
    })

    expect(requests.map((request) => `${request.method}:${request.url}`)).toEqual([
      'get:/agent/persona-candidates',
      'post:/agent/persona-candidates/c1/accept',
      'post:/agent/persona-candidates/c1/reject',
    ])
    expect(requests[0]?.params).toEqual({ status: 'pending' })
  })

  it('提升为用户级记忆时只发 scope，不带助理 ID', async () => {
    await updateMemoryScope('m1', 'user')

    expect(requests.map((request) => `${request.method}:${request.url}`)).toEqual([
      'patch:/memories/m1/scope',
    ])
    expect(JSON.parse(String(requests[0]?.data))).toEqual({ scope: 'user' })
  })

  it('降级为助理私有时必须带上助理 ID', async () => {
    await updateMemoryScope('m1', 'assistant', 'a1')

    expect(JSON.parse(String(requests[0]?.data))).toEqual({ scope: 'assistant', assistantId: 'a1' })
  })
})
