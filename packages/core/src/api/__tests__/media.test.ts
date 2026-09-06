import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { apiClient } from '../client.js'
import { cancelMediaTask, createMediaTask, listMediaTasks } from '../media.js'

const mediaTask = {
  id: 'task-1',
  conversationId: 'conv-1',
  messageId: 'msg-1',
  sourceMessageId: 'user-msg-1',
  type: 'image' as const,
  model: 'agnes-image-2.1-flash' as const,
  prompt: '复古海报',
  options: { size: '2K' as const, ratio: '16:9' as const },
  sourceFileIds: ['file-1'],
  status: 'queued' as const,
  progress: 0,
  resultUrl: null,
  resultPosterUrl: null,
  resultMimeType: null,
  resultWidth: null,
  resultHeight: null,
  resultDurationSeconds: null,
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-08-16T00:00:00Z',
  updatedAt: '2026-08-16T00:00:00Z',
}

let originalAdapter: typeof apiClient.defaults.adapter
let requests: InternalAxiosRequestConfig[]

function response(config: InternalAxiosRequestConfig, data: unknown): AxiosResponse<unknown> {
  return {
    config,
    data,
    headers: {},
    status: 200,
    statusText: 'OK',
  }
}

describe('media task API', () => {
  beforeEach(() => {
    requests = []
    originalAdapter = apiClient.defaults.adapter
    apiClient.defaults.adapter = async (config) => {
      requests.push(config)
      if (config.method === 'get') return response(config, { tasks: [mediaTask] })
      if (config.url?.endsWith('/cancel'))
        return response(config, { ...mediaTask, status: 'canceled' })
      return response(config, mediaTask)
    }
  })

  afterEach(() => {
    if (originalAdapter === undefined) delete apiClient.defaults.adapter
    else apiClient.defaults.adapter = originalAdapter
  })

  it('sends bounded task specs and source IDs through the dedicated endpoint', async () => {
    await expect(
      createMediaTask({
        conversationId: 'conv-1',
        type: 'image',
        prompt: '复古海报',
        options: { size: '2K', ratio: '16:9' },
        sourceFileIds: ['file-1'],
      })
    ).resolves.toEqual(mediaTask)

    expect(requests[0]?.url).toBe('/media/tasks')
    expect(JSON.parse(String(requests[0]?.data))).toEqual({
      conversationId: 'conv-1',
      type: 'image',
      prompt: '复古海报',
      options: { size: '2K', ratio: '16:9' },
      sourceFileIds: ['file-1'],
    })
  })

  it('lists and cancels durable tasks without using a chat stream endpoint', async () => {
    await expect(listMediaTasks('conv-1')).resolves.toEqual([mediaTask])
    await expect(cancelMediaTask('task-1')).resolves.toMatchObject({ status: 'canceled' })

    expect(requests.map((request) => request.url)).toEqual([
      '/chat/conversations/conv-1/media-tasks',
      '/media/tasks/task-1/cancel',
    ])
  })

  it('accepts the fixed music task contract on the existing media endpoint', async () => {
    await expect(
      createMediaTask({
        conversationId: 'conv-1',
        type: 'music',
        prompt: '舒缓钢琴',
        options: { durationSeconds: 30 },
      })
    ).resolves.toEqual(mediaTask)

    expect(JSON.parse(String(requests[0]?.data))).toEqual({
      conversationId: 'conv-1',
      type: 'music',
      prompt: '舒缓钢琴',
      options: { durationSeconds: 30 },
    })
  })
})
