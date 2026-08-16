import { createElement } from 'react'
import * as React from 'react'
import { create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

import type { ToolCall } from '@yuanai/types'

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}))
vi.mock('react-native-markdown-display', () => ({
  default: 'Markdown',
}))
vi.mock('@/theme/tokens', () => ({
  brand: { solid: '#2563eb' },
  radius: { sm: 6 },
  spacing: { sm: 8 },
}))
vi.mock('@/theme/useTheme', () => ({
  useTheme: () => ({
    density: { messagePy: 10 },
    text: { primary: '#111827', muted: '#6b7280' },
    typography: { body: 15, bodyLineHeight: 22, h1: 26, h2: 22, h3: 18, code: 14 },
  }),
}))
vi.mock('./CodeBlock', () => ({ CodeBlock: 'CodeBlock' }))
vi.mock('./ThinkBlock', () => ({
  StreamingThinkBlock: 'StreamingThinkBlock',
  ThinkBlock: 'ThinkBlock',
}))
vi.stubGlobal('React', React)

import { AIMessage } from './AIMessage'

describe('AIMessage', () => {
  it('将持久化的联网搜索条目放回已思考区域', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'search-1',
        name: 'search_web',
        arguments: '{"query":"元AI"}',
        status: 'done',
        sources: [
          {
            title: '元AI 官网',
            url: 'https://example.com/yuanai',
            snippet: '安全的来源摘要',
            provider: 'searxng',
          },
        ],
      },
    ]

    const renderer = create(
      createElement(AIMessage, {
        content: '这是带来源的回答',
        isFirst: true,
        streamingMsg: false,
        thinkContent: '',
        toolCalls,
      })
    )

    const thinkBlock = renderer.root.findByType('ThinkBlock' as never)
    expect(thinkBlock.props['toolCalls']).toEqual(toolCalls)
  })
})
