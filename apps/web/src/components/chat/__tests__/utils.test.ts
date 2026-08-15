import { describe, expect, it } from 'vitest'
import type { MockMessage } from '@yuanai/core/stores'

import { buildPairs } from '../utils'

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
})
