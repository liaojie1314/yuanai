import { NextIntlClientProvider } from 'next-intl'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ToolCall } from '@yuanai/types'
import { ThinkBlock } from '../ThinkBlock'
import zhCN from '@/i18n/locales/zh-CN.json'

function renderThinkBlock(node: React.ReactNode): ReturnType<typeof render> {
  return render(
    <NextIntlClientProvider locale="zh-CN" messages={zhCN}>
      {node}
    </NextIntlClientProvider>
  )
}

describe('ThinkBlock', () => {
  it('activeState 下头部显示"正在思考…"', () => {
    renderThinkBlock(<ThinkBlock content="思考中" active />)
    expect(screen.getByText('正在思考…')).toBeInTheDocument()
  })

  it('非 active 状态显示"已完成思考"与耗时', () => {
    renderThinkBlock(<ThinkBlock content="思考完毕" durationMs={3200} defaultOpen />)
    expect(screen.getByText('已完成思考')).toBeInTheDocument()
    expect(screen.getByText('3.2 秒')).toBeInTheDocument()
  })

  it('点击头部切换 open class', () => {
    const { container } = renderThinkBlock(<ThinkBlock content="内容" defaultOpen={false} />)
    const block = container.querySelector('.ch-think-block')
    expect(block?.classList.contains('open')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /已完成思考/i }))
    expect(block?.classList.contains('open')).toBe(true)
  })

  it('渲染 toolCalls 列表', () => {
    const toolCalls: ToolCall[] = [
      { id: 't1', name: 'search_web', arguments: '{"q":"a"}', status: 'done' },
      { id: 't2', name: 'read_docs', arguments: '{"url":"x"}', status: 'running' },
    ]
    renderThinkBlock(<ThinkBlock content="" toolCalls={toolCalls} defaultOpen />)
    expect(screen.getByText('search_web')).toBeInTheDocument()
    expect(screen.getByText('read_docs')).toBeInTheDocument()
    expect(screen.getByText('进行中…')).toBeInTheDocument()
  })

  it('data-state 属性反映当前状态', () => {
    const { container, rerender } = renderThinkBlock(<ThinkBlock content="x" active />)
    expect(container.querySelector('.ch-think-block')?.getAttribute('data-state')).toBe('active')
    rerender(
      <NextIntlClientProvider locale="zh-CN" messages={zhCN}>
        <ThinkBlock content="x" />
      </NextIntlClientProvider>
    )
    expect(container.querySelector('.ch-think-block')?.getAttribute('data-state')).toBe('done')
  })
})
