import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../Button'

describe('Button', () => {
  it('渲染按钮文案', () => {
    render(<Button>发送</Button>)
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument()
  })

  it('点击时触发 onClick', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>发送</Button>)
    await user.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('disabled 时既不可点击也不触发回调', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        发送
      </Button>
    )
    await user.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('loading 时置 aria-busy、禁用按钮并渲染 spinner', () => {
    const { container } = render(<Button loading>发送</Button>)
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()
    expect(container.querySelector('.animate-spin')).not.toBeNull()
  })

  it('非 loading 时不渲染 spinner', () => {
    const { container } = render(<Button>发送</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'false')
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('默认使用 primary 渐变变体与 md 尺寸', () => {
    render(<Button>发送</Button>)
    const button = screen.getByRole('button')
    expect(button).toHaveClass('bg-gradient-to-r')
    expect(button).toHaveClass('h-10')
  })

  it('variant 与 size 可覆盖默认值', () => {
    render(
      <Button variant="danger" size="lg">
        删除
      </Button>
    )
    const button = screen.getByRole('button')
    expect(button).toHaveClass('bg-[var(--color-error)]')
    expect(button).toHaveClass('h-12')
    expect(button).not.toHaveClass('bg-gradient-to-r')
  })

  it('className 通过 cn 覆盖同类工具类', () => {
    render(<Button className="h-20">发送</Button>)
    const button = screen.getByRole('button')
    expect(button).toHaveClass('h-20')
    expect(button).not.toHaveClass('h-10')
  })

  it('asChild 时把样式透传给子元素而不渲染 button', () => {
    render(
      <Button asChild>
        <a href="/chat">去聊天</a>
      </Button>
    )
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('link', { name: '去聊天' })).toHaveClass('bg-gradient-to-r')
  })

  it('asChild + loading 不注入 spinner（Slot 只接受单个子元素）', () => {
    const { container } = render(
      <Button asChild loading>
        <a href="/chat">去聊天</a>
      </Button>
    )
    expect(container.querySelector('.animate-spin')).toBeNull()
    expect(screen.getByRole('link')).toHaveAttribute('aria-busy', 'true')
  })
})
