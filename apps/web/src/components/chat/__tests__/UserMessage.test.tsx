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

function renderMessage(msg: MockMessage, onPreviewFile = vi.fn()): void {
  render(
    <UserMessage
      msg={msg}
      editing={false}
      timeFmt="24h"
      dateFmt="ymd"
      onStartEdit={() => {}}
      onSubmitEdit={() => {}}
      onCancelEdit={() => {}}
      onPreviewFile={onPreviewFile}
    />
  )
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
        onPreviewFile={() => {}}
      />
    )
    expect(screen.getByText('Hello 元AI')).toBeInTheDocument()
  })

  it('点击复制直接写入原始文本，不弹出格式选择', async () => {
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
        onPreviewFile={() => {}}
      />
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '复制' }))
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(text)
    expect(await screen.findByText('已复制')).toBeInTheDocument()
    expect(screen.queryByText('复制 Markdown')).not.toBeInTheDocument()
    expect(screen.queryByText('复制纯文本')).not.toBeInTheDocument()
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
        onPreviewFile={() => {}}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '编辑消息' }))
    expect(onStart).toHaveBeenCalledOnce()
  })

  it('图片附件展示缩略图，点击卡片交给右侧 Artifact 面板', () => {
    const onPreviewFile = vi.fn()
    const file = {
      id: 'file-1',
      filename: 'design.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      url: 'https://cdn.example.com/files/design.png',
    }
    renderMessage(
      {
        ...makeMsg('请分析设计稿'),
        files: [file],
      },
      onPreviewFile
    )

    expect(screen.getByRole('img', { name: 'design.png' })).toHaveAttribute(
      'src',
      'https://cdn.example.com/files/design.png'
    )
    fireEvent.click(screen.getByRole('button', { name: '打开 design.png 的预览' }))

    expect(onPreviewFile).toHaveBeenCalledWith(file, [file])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
