import { describe, expect, it } from 'vitest'
import type { MockMessage } from '@yuanai/core/stores'
import { Role, type Message } from '@yuanai/types'

import { apiMsgToMock, buildPairs } from '../utils'

function message(
  id: string,
  role: MockMessage['role'],
  content: string,
  regeneratedFromMessageId?: string
): MockMessage {
  return {
    id,
    role,
    parts: [{ type: 'text', content }],
    ...(regeneratedFromMessageId ? { regeneratedFromMessageId } : {}),
    createdAt: 0,
  }
}

function mediaTaskMessage(id: string, sourceMessageId: string, prompt: string): MockMessage {
  return {
    ...message(id, 'assistant', '正在生成视频'),
    mediaTask: {
      id: `task-${id}`,
      conversationId: 'conversation-1',
      messageId: id,
      sourceMessageId,
      type: 'video',
      model: 'agnes-video-v2.0',
      prompt,
      options: { aspectRatio: '16:9', resolution: '720p', durationSeconds: 5 },
      sourceFileIds: [],
      status: 'queued',
      progress: 0,
      resultUrl: null,
      resultPosterUrl: null,
      resultMimeType: null,
      resultWidth: null,
      resultHeight: null,
      resultDurationSeconds: null,
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  }
}

describe('buildPairs', () => {
  it('相同提问只有显式重新生成来源时才显示为多版本', () => {
    const ordinaryPairs = buildPairs([
      message('u1', 'user', '同一个问题'),
      message('a1', 'assistant', '第一次回答'),
      message('u2', 'user', '同一个问题'),
      message('a2', 'assistant', '第二次独立回答'),
    ])
    const regeneratedPairs = buildPairs([
      message('u1', 'user', '同一个问题'),
      message('a1', 'assistant', '第一次回答'),
      message('u2', 'user', '同一个问题', 'u1'),
      message('a2', 'assistant', '重新生成回答'),
    ])

    expect(ordinaryPairs).toHaveLength(2)
    expect(regeneratedPairs).toHaveLength(1)
    expect(regeneratedPairs[0]?.assistants.map((item) => item.id)).toEqual(['a1', 'a2'])
  })

  it('每个媒体请求保留独立用户提问和任务卡，不参与回答版本', () => {
    const pairs = buildPairs([
      message('u1', 'user', '生成老师讲课的视频'),
      mediaTaskMessage('m1', 'u1', '生成老师讲课的视频'),
      message('u2', 'user', '生成打羽毛球的视频'),
      mediaTaskMessage('m2', 'u2', '生成打羽毛球的视频'),
    ])

    expect(pairs.map((pair) => pair.userMsg.parts[0]?.content)).toEqual([
      '生成老师讲课的视频',
      '生成打羽毛球的视频',
    ])
    expect(pairs.map((pair) => pair.assistants)).toEqual([[], []])
    expect(pairs.map((pair) => pair.mediaAssistants.map((message) => message.id))).toEqual([
      ['m1'],
      ['m2'],
    ])
  })
})

describe('apiMsgToMock', () => {
  it('保留历史消息中的联网搜索工具调用', () => {
    const message: Message = {
      id: 'assistant-search-1',
      role: Role.Assistant,
      content: '以下是今天的人工智能新闻。',
      thinkingContent: '我先检索可靠来源。',
      thinkingDurationMs: 1200,
      toolCalls: [
        {
          id: 'tool-search-1',
          name: 'search_web',
          arguments: '{"query":"今天的人工智能新闻"}',
          result: '找到 1 条可靠来源。',
          sources: [
            {
              provider: 'searxng',
              title: 'AI News',
              url: 'https://example.com/ai-news',
              snippet: 'A reliable source',
            },
          ],
          status: 'done',
        },
      ],
      files: [],
      createdAt: '2026-08-16T00:00:00Z',
    }

    const adapted = apiMsgToMock(message)

    expect(adapted.thinkContent).toBe('我先检索可靠来源。')
    expect(adapted.toolCalls).toEqual(message.toolCalls)
  })
})
