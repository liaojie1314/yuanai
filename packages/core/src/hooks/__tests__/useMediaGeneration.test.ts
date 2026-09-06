import type { MediaGenerationTask } from '@yuanai/types'
import { describe, expect, it } from 'vitest'

import { mediaTaskContent } from '../useMediaGeneration.js'

const task = (status: MediaGenerationTask['status']): MediaGenerationTask => ({
  id: 'task-1',
  conversationId: 'conv-1',
  messageId: 'msg-1',
  sourceMessageId: null,
  type: 'music',
  model: 'musicgen-small-local',
  prompt: '舒缓钢琴',
  options: { durationSeconds: 30 },
  sourceFileIds: [],
  status,
  progress: status === 'succeeded' ? 100 : 0,
  resultUrl: null,
  resultPosterUrl: null,
  resultMimeType: null,
  resultWidth: null,
  resultHeight: null,
  resultDurationSeconds: null,
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-08-25T00:00:00Z',
  updatedAt: '2026-08-25T00:00:00Z',
})

describe('mediaTaskContent', () => {
  it.each([
    ['queued', '正在生成音乐'],
    ['running', '正在生成音乐'],
    ['succeeded', '音乐生成完成'],
    ['failed', '音乐生成失败'],
    ['canceled', '已取消音乐生成'],
  ] as const)('translates music %s status', (status, content) => {
    expect(mediaTaskContent(task(status))).toBe(content)
  })
})
