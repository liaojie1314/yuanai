import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore } from '../chat.store'

beforeEach(() => {
  useChatStore.getState().finalizeStream()
})

describe('chat.store — 流式状态 reducer', () => {
  it('startStreaming 记录会话 ID 与乐观用户消息', () => {
    useChatStore.getState().startStreaming('c1', 'hi')
    const s = useChatStore.getState()
    expect(s.streamingConvId).toBe('c1')
    expect(s.optimisticUserMsg).toBe('hi')
    expect(s.streamingContent).toBe('')
  })

  it('appendToken 累积正文', () => {
    useChatStore.getState().startStreaming('c1', 'hi')
    useChatStore.getState().appendToken('你好')
    useChatStore.getState().appendToken('，元AI')
    expect(useChatStore.getState().streamingContent).toBe('你好，元AI')
  })

  it('appendThink 累积推理文本并记录起始时间', () => {
    useChatStore.getState().appendThink('思考1')
    useChatStore.getState().appendThink('思考2')
    const s = useChatStore.getState()
    expect(s.streamingThink).toBe('思考1思考2')
    expect(s.streamingThinkStartAt).not.toBeNull()
  })

  it('startToolCall 追加到列表', () => {
    useChatStore.getState().startToolCall({
      id: 't1',
      name: 'search_web',
      arguments: '',
      status: 'running',
    })
    useChatStore.getState().startToolCall({
      id: 't2',
      name: 'read_docs',
      arguments: '',
      status: 'running',
    })
    const list = useChatStore.getState().streamingToolCalls
    expect(list).toHaveLength(2)
    expect(list[0]?.name).toBe('search_web')
    expect(list[1]?.name).toBe('read_docs')
  })

  it('appendToolCallArgs 追加指定 ID 的参数', () => {
    useChatStore.getState().startToolCall({
      id: 't1',
      name: 'search_web',
      arguments: '',
      status: 'running',
    })
    useChatStore.getState().appendToolCallArgs('t1', '{"q":')
    useChatStore.getState().appendToolCallArgs('t1', '"元"}')
    const list = useChatStore.getState().streamingToolCalls
    expect(list[0]?.arguments).toBe('{"q":"元"}')
  })

  it('updateToolCall 合并任意字段', () => {
    useChatStore.getState().startToolCall({
      id: 't1',
      name: 'search_web',
      arguments: '{}',
      status: 'running',
    })
    useChatStore.getState().updateToolCall('t1', {
      status: 'done',
      result: 'ok',
      durationMs: 120,
    })
    const list = useChatStore.getState().streamingToolCalls
    expect(list[0]?.status).toBe('done')
    expect(list[0]?.result).toBe('ok')
    expect(list[0]?.durationMs).toBe(120)
  })

  it('setToolCallStatus 仅切换 status', () => {
    useChatStore.getState().startToolCall({
      id: 't1',
      name: 'x',
      arguments: '',
      status: 'running',
    })
    useChatStore.getState().setToolCallStatus('t1', 'error')
    expect(useChatStore.getState().streamingToolCalls[0]?.status).toBe('error')
  })

  it('finalizeStream 清空所有流式状态', () => {
    useChatStore.getState().startStreaming('c1', 'hi')
    useChatStore.getState().appendToken('x')
    useChatStore.getState().appendThink('y')
    useChatStore.getState().startToolCall({
      id: 't1',
      name: 'n',
      arguments: '',
      status: 'running',
    })
    useChatStore.getState().finalizeStream()
    const s = useChatStore.getState()
    expect(s.streamingConvId).toBeNull()
    expect(s.streamingContent).toBe('')
    expect(s.streamingThink).toBe('')
    expect(s.streamingToolCalls).toEqual([])
    expect(s.optimisticUserMsg).toBeNull()
  })
})
