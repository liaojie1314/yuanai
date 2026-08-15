import { beforeEach, describe, expect, it } from 'vitest'

import { selectConversationStream, useChatStore } from '../chat.store'

beforeEach(() => {
  useChatStore.getState().finalizeStream()
})

describe('chat.store — 按会话隔离流式状态', () => {
  it('startStreaming 将乐观消息和附件保存在对应会话', () => {
    const files = [
      {
        id: 'file-1',
        filename: 'design.png',
        mimeType: 'image/png',
        sizeBytes: 12,
        url: 'blob:design',
      },
    ]

    useChatStore.getState().startStreaming('conversation-a', 'hi', files)
    const stream = selectConversationStream(useChatStore.getState(), 'conversation-a')

    expect(stream.conversationId).toBe('conversation-a')
    expect(stream.optimisticUserMessage).toBe('hi')
    expect(stream.optimisticFiles).toEqual(files)
    expect(stream.content).toBe('')
  })

  it('并发会话的正文、思考和工具调用不会互相混入', () => {
    const store = useChatStore.getState()
    store.startStreaming('conversation-a', 'A')
    store.startStreaming('conversation-b', 'B')
    store.appendToken('conversation-a', '甲')
    store.appendToken('conversation-b', '乙')
    store.appendThink('conversation-a', '先分析')
    store.startToolCall('conversation-b', {
      id: 'tool-b',
      name: 'search_web',
      arguments: '',
      status: 'running',
    })
    store.appendToolCallArgs('conversation-b', 'tool-b', '{"q":"元AI"}')

    const first = selectConversationStream(useChatStore.getState(), 'conversation-a')
    const second = selectConversationStream(useChatStore.getState(), 'conversation-b')
    expect(first.content).toBe('甲')
    expect(first.thinking).toBe('先分析')
    expect(first.toolCalls).toEqual([])
    expect(second.content).toBe('乙')
    expect(second.thinking).toBe('')
    expect(second.toolCalls[0]?.arguments).toBe('{"q":"元AI"}')
  })

  it('不存在流时返回稳定空快照，不因其它会话更新而变化', () => {
    const before = selectConversationStream(useChatStore.getState(), 'conversation-missing')
    useChatStore.getState().startStreaming('conversation-a', 'A')
    useChatStore.getState().appendToken('conversation-a', 'token')
    const after = selectConversationStream(useChatStore.getState(), 'conversation-missing')

    expect(after).toBe(before)
    expect(after.content).toBe('')
  })

  it('finalizeStream 只移除指定会话', () => {
    const store = useChatStore.getState()
    store.startStreaming('conversation-a', 'A')
    store.startStreaming('conversation-b', 'B')
    store.finalizeStream('conversation-a')

    expect(useChatStore.getState().streams['conversation-a']).toBeUndefined()
    expect(
      selectConversationStream(useChatStore.getState(), 'conversation-b').optimisticUserMessage
    ).toBe('B')
  })
})
