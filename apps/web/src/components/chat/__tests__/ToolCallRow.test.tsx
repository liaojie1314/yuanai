import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ToolCall } from '@yuanai/types'
import { ToolCallRow } from '../ToolCallRow'
import zhCN from '@/i18n/locales/zh-CN.json'

function renderToolCallRow(node: React.ReactNode): ReturnType<typeof render> {
  return render(
    <NextIntlClientProvider locale="zh-CN" messages={zhCN}>
      {node}
    </NextIntlClientProvider>
  )
}

function makeCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'tc-1',
    name: 'search_web',
    arguments: '{"query":"元AI"}',
    status: 'done',
    result: '共 3 条结果',
    durationMs: 500,
    ...overrides,
  }
}

describe('ToolCallRow', () => {
  it('渲染工具名与参数预览', () => {
    renderToolCallRow(<ToolCallRow toolCall={makeCall()} />)
    expect(screen.getByText('search_web')).toBeInTheDocument()
    expect(screen.getByText(/元AI/)).toBeInTheDocument()
  })

  it('已完成状态显示 "已完成"', () => {
    renderToolCallRow(<ToolCallRow toolCall={makeCall({ status: 'done' })} />)
    expect(screen.getByText('已完成')).toBeInTheDocument()
  })

  it('进行中状态显示 "进行中…"', () => {
    renderToolCallRow(<ToolCallRow toolCall={makeCall({ status: 'running' })} />)
    expect(screen.getByText('进行中…')).toBeInTheDocument()
  })

  it('错误状态显示 "失败" 与错误详情', () => {
    const errorCall: ToolCall = {
      id: 'tc-err',
      name: 'search_web',
      arguments: '{"query":"元AI"}',
      status: 'error',
      error: '网络错误',
      durationMs: 500,
    }
    renderToolCallRow(<ToolCallRow toolCall={errorCall} />)
    expect(screen.getByText('失败')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('网络错误')).toBeInTheDocument()
  })

  it('点击展开显示完整参数与结果', () => {
    renderToolCallRow(<ToolCallRow toolCall={makeCall()} />)
    // 初始收起，结果不可见
    expect(screen.queryByText('共 3 条结果')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('共 3 条结果')).toBeInTheDocument()
  })

  it('展开后以安全新窗口链接显示搜索来源', () => {
    renderToolCallRow(
      <ToolCallRow
        toolCall={makeCall({
          sources: [
            {
              title: '元AI 搜索来源',
              url: 'https://example.com/research',
              snippet: '安全的来源摘要',
              provider: 'searxng',
            },
          ],
        })}
      />
    )

    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('link', { name: '元AI 搜索来源' })).toHaveAttribute(
      'rel',
      'noopener noreferrer'
    )
  })
})
