import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesktopArtifactPayload } from '../../shared/ipc-contract'
import { ARTIFACT_MSG_SOURCE } from '@yuanai/core/utils'

import { App } from './App'

const artifact = vi.hoisted(() => ({
  payload: null as DesktopArtifactPayload | null,
  unsubscribe: vi.fn(),
}))

beforeEach(() => {
  Object.defineProperty(window, 'yuanai', {
    configurable: true,
    value: {
      events: {
        onArtifactInit: (listener: (payload: DesktopArtifactPayload) => void) => {
          if (artifact.payload) listener(artifact.payload)
          return artifact.unsubscribe
        },
      },
    },
  })
  artifact.payload = null
})

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-theme')
  vi.clearAllMocks()
})

describe('Artifact window', () => {
  it('renders the incoming code payload after the window is ready', () => {
    artifact.payload = {
      title: '示例代码',
      lang: 'typescript',
      code: 'const answer = 42',
      mode: 'view',
    }

    render(<App />)

    expect(screen.getByRole('heading', { name: '示例代码' })).toBeInTheDocument()
    expect(screen.getByText('const answer = 42')).toBeInTheDocument()
    expect(document.querySelector('.artifact__code')).toHaveTextContent('const answer = 42')
    expect(screen.getByText('代码查看')).toBeInTheDocument()
  })

  it('switches previewable code between source and sandboxed preview in the same window', async () => {
    const user = userEvent.setup()
    artifact.payload = {
      title: 'HTML 预览',
      lang: 'html',
      code: '<h1>元AI</h1>',
      mode: 'view',
    }

    render(<App />)

    await user.click(screen.getByRole('button', { name: '运行预览' }))

    const preview = screen.getByTitle('HTML 预览 预览')
    expect(preview).toHaveAttribute('sandbox', 'allow-scripts allow-forms')
    expect(preview).toHaveAttribute('srcdoc', expect.stringContaining('<h1>元AI</h1>'))
    expect(screen.getByRole('button', { name: '查看源码' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '查看源码' }))

    expect(screen.getByText('<h1>元AI</h1>')).toBeInTheDocument()
  })

  it('renders JSON and CSV payloads as data previews', async () => {
    const user = userEvent.setup()
    artifact.payload = {
      title: '用户数据',
      lang: 'json',
      code: '{"name":"元AI","enabled":true}',
      mode: 'view',
    }

    const { unmount } = render(<App />)
    await user.click(screen.getByRole('button', { name: '数据预览' }))
    expect(screen.getByText('name:')).toBeInTheDocument()
    expect(screen.getByText('"元AI"')).toBeInTheDocument()

    unmount()
    artifact.payload = {
      title: '水果清单',
      lang: 'csv',
      code: '名称,价格\n苹果,5\n香蕉,3',
      mode: 'run',
    }
    render(<App />)
    expect(screen.getByRole('columnheader', { name: '名称' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '苹果' })).toBeInTheDocument()
  })

  it('renders images and PDFs in the dedicated preview window', () => {
    artifact.payload = {
      kind: 'file-preview',
      title: '设计稿.png',
      sourceUrl: 'https://cdn.example.com/files/design.png',
      mimeType: 'image/png',
    }

    const { unmount } = render(<App />)
    expect(screen.getByRole('main', { name: '文件预览 设计稿.png' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '设计稿.png' })).toHaveAttribute(
      'src',
      'https://cdn.example.com/files/design.png'
    )

    unmount()
    artifact.payload = {
      kind: 'file-preview',
      title: '需求.pdf',
      sourceUrl: 'https://cdn.example.com/files/spec.pdf',
      mimeType: 'application/pdf',
    }
    render(<App />)
    expect(screen.getByTitle('预览 需求.pdf')).toHaveAttribute('sandbox', 'allow-downloads')
  })

  it('shows JavaScript console output inside the preview window', async () => {
    const user = userEvent.setup()
    artifact.payload = {
      title: 'JS 输出',
      lang: 'javascript',
      code: 'console.log("完成")',
      mode: 'view',
    }

    render(<App />)
    await user.click(screen.getByRole('button', { name: '运行预览' }))
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: ARTIFACT_MSG_SOURCE, level: 'log', text: '完成' },
      })
    )

    await waitFor(() => {
      expect(screen.getByRole('complementary', { name: '运行输出' })).toHaveTextContent('完成')
    })
  })
})
