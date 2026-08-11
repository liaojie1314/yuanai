import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesktopArtifactPayload } from '../../shared/ipc-contract'

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
})
