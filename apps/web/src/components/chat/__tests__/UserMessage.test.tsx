import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { MockMessage } from '@yuanai/core/stores'
import { UserMessage } from '../UserMessage'

Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
  writable: true,
  configurable: true,
})

function makeMsg(text = 'Hello **world**'): MockMessage {
  return {
    id: 'u1',
    role: 'user',
    parts: [{ type: 'text', content: text }],
    createdAt: Date.now(),
  }
}

describe('UserMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('渲染用户气泡内容', () => {
    render(
      <UserMessage
        msg={makeMsg('Hello 元AI')}
        editing={false}
        timeFmt="24h"
        dateFmt="ymd"
        onStartEdit={() => {}}
        onSubmitEdit={() => {}}
        onCancelEdit={() => {}}
      />
    )
    expect(screen.getByText('Hello 元AI')).toBeInTheDocument()
  })

  it('点击复制展开下拉，选"复制 Markdown"保留原始格式', async () => {
    const text = 'A **bold** line'
    render(
      <UserMessage
        msg={makeMsg(text)}
        editing={false}
        timeFmt="24h"
        dateFmt="ymd"
        onStartEdit={() => {}}
        onSubmitEdit={() => {}}
        onCancelEdit={() => {}}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '复制内容' }))
    await act(async () => {
      fireEvent.click(screen.getByText('复制 Markdown'))
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(text)
    expect(await screen.findByText('已复制 MD')).toBeInTheDocument()
  })

  it('选"复制纯文本"会剥离 Markdown 语法', async () => {
    render(
      <UserMessage
        msg={makeMsg('A **bold** _italic_')}
        editing={false}
        timeFmt="24h"
        dateFmt="ymd"
        onStartEdit={() => {}}
        onSubmitEdit={() => {}}
        onCancelEdit={() => {}}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '复制内容' }))
    await act(async () => {
      fireEvent.click(screen.getByText('复制纯文本'))
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('A bold _italic_')
  })

  it('点击"编辑"触发 onStartEdit 回调', () => {
    const onStart = vi.fn()
    render(
      <UserMessage
        msg={makeMsg('x')}
        editing={false}
        timeFmt="24h"
        dateFmt="ymd"
        onStartEdit={onStart}
        onSubmitEdit={() => {}}
        onCancelEdit={() => {}}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '编辑消息' }))
    expect(onStart).toHaveBeenCalledOnce()
  })
})
