import { cleanup, render, screen } from '@testing-library/react'
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

  it('runs previewable code only in a script-only iframe sandbox', () => {
    artifact.payload = {
      title: 'HTML 预览',
      lang: 'html',
      code: '<h1>元AI</h1>',
      mode: 'run',
    }

    render(<App />)

    const preview = screen.getByTitle('HTML 预览 预览')
    expect(preview).toHaveAttribute('sandbox', 'allow-scripts')
    expect(preview).toHaveAttribute('srcdoc', expect.stringContaining('<h1>元AI</h1>'))
  })
})
