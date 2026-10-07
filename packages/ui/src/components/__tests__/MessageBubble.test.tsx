import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MessageBubble } from '../MessageBubble'

describe('MessageBubble', () => {
  it('用户消息渲染右对齐渐变气泡', () => {
    const { container } = render(<MessageBubble role="user">你好</MessageBubble>)
    expect(screen.getByText('你好')).toHaveClass('bg-gradient-to-br')
    expect(container.querySelector('.justify-end')).not.toBeNull()
  })

  it('助手消息不加气泡背景', () => {
    const { container } = render(<MessageBubble role="assistant">在的</MessageBubble>)
    const node = screen.getByText('在的')
    expect(node).not.toHaveClass('bg-gradient-to-br')
    expect(container.querySelector('.justify-end')).toBeNull()
  })

  it('两种角色都接受 className 追加', () => {
    render(
      <>
        <MessageBubble role="user" className="mt-4">
          问题
        </MessageBubble>
        <MessageBubble role="assistant" className="mt-8">
          回答
        </MessageBubble>
      </>
    )
    expect(screen.getByText('问题')).toHaveClass('mt-4')
    expect(screen.getByText('回答')).toHaveClass('mt-8')
  })

  it('渲染任意 ReactNode 子内容', () => {
    render(
      <MessageBubble role="assistant">
        <p>第一段</p>
        <p>第二段</p>
      </MessageBubble>
    )
    expect(screen.getByText('第一段')).toBeInTheDocument()
    expect(screen.getByText('第二段')).toBeInTheDocument()
  })
})
