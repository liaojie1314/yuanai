import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { MockMessage } from '@yuanai/core/stores'
import { AIMessage } from '../AIMessage'

Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
  writable: true,
  configurable: true,
})

function makeMsg(text = 'Answer **bold**'): MockMessage {
  return {
    id: 'a1',
    role: 'assistant',
    parts: [{ type: 'text', content: text }],
    createdAt: Date.now(),
  }
}

function renderMsg(text?: string): void {
  render(
    <AIMessage
      msg={makeMsg(text)}
      isStreaming={false}
      streamingContent=""
      onFill={() => {}}
      timeFmt="24h"
      dateFmt="ymd"
    />
  )
}

describe('AIMessage 复制交互（hover 触发）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('默认不展示复制格式下拉', () => {
    renderMsg()
    expect(screen.queryByText('复制 Markdown')).not.toBeInTheDocument()
    expect(screen.queryByText('复制纯文本')).not.toBeInTheDocument()
  })

  it('hover 复制区域展开下拉，移出后延迟 200ms 收起', () => {
    renderMsg()
    const wrap = screen.getByTitle('复制内容').parentElement as HTMLElement
    fireEvent.mouseEnter(wrap)
    expect(screen.getByText('复制 Markdown')).toBeInTheDocument()
    expect(screen.getByText('复制纯文本')).toBeInTheDocument()
    // 移出后下拉延迟 200ms 收起，计时器未触发前仍可见
    fireEvent.mouseLeave(wrap)
    expect(screen.getByText('复制 Markdown')).toBeInTheDocument()
    // 快进 200ms 后收起
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.queryByText('复制 Markdown')).not.toBeInTheDocument()
  })

  it('无需展开下拉，直接点击即可复制 Markdown 全文', async () => {
    const text = 'Answer **bold**'
    renderMsg(text)
    await act(async () => {
      fireEvent.click(screen.getByTitle('复制内容'))
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(text)
    // copyMd 同步调用 setCopyState('md')，无需等待计时器
    expect(screen.getByText('已复制 MD')).toBeInTheDocument()
  })

  it('hover 展开后选择"复制纯文本"会剥离 Markdown 语法', async () => {
    renderMsg('A **bold** _italic_')
    const wrap = screen.getByTitle('复制内容').parentElement as HTMLElement
    fireEvent.mouseEnter(wrap)
    await act(async () => {
      fireEvent.click(screen.getByText('复制纯文本'))
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('A bold _italic_')
  })
})
