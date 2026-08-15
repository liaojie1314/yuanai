import { describe, it, expect } from 'vitest'
import type { Message } from '@yuanai/types'
import { buildMessagePairs, clampVersionIdx } from '../messagePairs'

function msg(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  regeneratedFromMessageId?: string
): Message {
  return {
    id,
    role: role as Message['role'],
    content,
    ...(regeneratedFromMessageId ? { regeneratedFromMessageId } : {}),
    files: [],
    createdAt: '2026-01-01T00:00:00Z',
  }
}

describe('buildMessagePairs', () => {
  it('空列表返回空数组', () => {
    expect(buildMessagePairs([])).toEqual([])
  })

  it('一问一答折叠成一个 pair', () => {
    const pairs = buildMessagePairs([msg('u1', 'user', '你好'), msg('a1', 'assistant', '你好呀')])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.pairKey).toBe('u1')
    expect(pairs[0]?.userMsg?.id).toBe('u1')
    expect(pairs[0]?.assistants.map((m) => m.id)).toEqual(['a1'])
  })

  it('多轮不同问题各自成对', () => {
    const pairs = buildMessagePairs([
      msg('u1', 'user', '问题一'),
      msg('a1', 'assistant', '答一'),
      msg('u2', 'user', '问题二'),
      msg('a2', 'assistant', '答二'),
    ])
    expect(pairs.map((p) => p.pairKey)).toEqual(['u1', 'u2'])
    expect(pairs[1]?.assistants.map((m) => m.id)).toEqual(['a2'])
  })

  it('相邻的同内容普通提问不会被误判为重新生成', () => {
    const pairs = buildMessagePairs([
      msg('u1', 'user', '讲个笑话'),
      msg('a1', 'assistant', '版本一'),
      msg('u2', 'user', '讲个笑话'),
      msg('a2', 'assistant', '版本二'),
    ])
    expect(pairs).toHaveLength(2)
    expect(pairs.map((pair) => pair.pairKey)).toEqual(['u1', 'u2'])
  })

  it('仅显式标记来源的用户消息合并为多版本', () => {
    const pairs = buildMessagePairs([
      msg('u1', 'user', '讲个笑话'),
      msg('a1', 'assistant', '版本一'),
      msg('u2', 'user', '讲个笑话', 'u1'),
      msg('a2', 'assistant', '版本二'),
      msg('u3', 'user', '讲个笑话', 'u1'),
      msg('a3', 'assistant', '版本三'),
    ])

    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.pairKey).toBe('u1')
    expect(pairs[0]?.assistants.map((m) => m.id)).toEqual(['a1', 'a2', 'a3'])
  })

  it('内容相同但不相邻的用户消息不合并', () => {
    const pairs = buildMessagePairs([
      msg('u1', 'user', '重复问题'),
      msg('a1', 'assistant', '答一'),
      msg('u2', 'user', '插入的其他问题'),
      msg('a2', 'assistant', '答二'),
      msg('u3', 'user', '重复问题'),
      msg('a3', 'assistant', '答三'),
    ])
    expect(pairs.map((p) => p.pairKey)).toEqual(['u1', 'u2', 'u3'])
  })

  it('一条用户消息暂无回答时 assistants 为空', () => {
    const pairs = buildMessagePairs([msg('u1', 'user', '在吗')])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.assistants).toEqual([])
  })

  it('消息流以 assistant 开头时不丢内容，产出孤儿 pair', () => {
    const pairs = buildMessagePairs([
      msg('a0', 'assistant', '欢迎语'),
      msg('u1', 'user', '你好'),
      msg('a1', 'assistant', '你好呀'),
    ])
    expect(pairs).toHaveLength(2)
    expect(pairs[0]?.userMsg).toBeNull()
    expect(pairs[0]?.pairKey).toBe('a0')
    expect(pairs[0]?.assistants.map((m) => m.id)).toEqual(['a0'])
    expect(pairs[1]?.pairKey).toBe('u1')
  })
})

describe('clampVersionIdx', () => {
  it('未选择过时落到最新一版', () => {
    expect(clampVersionIdx(3, undefined)).toBe(2)
    expect(clampVersionIdx(1, undefined)).toBe(0)
  })

  it('合法下标原样返回', () => {
    expect(clampVersionIdx(3, 0)).toBe(0)
    expect(clampVersionIdx(3, 1)).toBe(1)
  })

  it('越界下标夹到区间内（版本被删/refetch 后变少）', () => {
    expect(clampVersionIdx(2, 5)).toBe(1)
    expect(clampVersionIdx(2, -1)).toBe(0)
  })

  it('无任何版本时返回 0', () => {
    expect(clampVersionIdx(0, undefined)).toBe(0)
    expect(clampVersionIdx(0, 3)).toBe(0)
  })
})
