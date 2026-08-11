import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useArtifactStore } from '@yuanai/core/stores'

import { ArtifactPanel } from './ArtifactPanel'

const HTML_ARTIFACT = {
  code: '<main><h1>元AI</h1></main>',
  lang: 'html',
  title: '欢迎页面',
}

describe('ArtifactPanel', () => {
  beforeEach(() => {
    act(() => useArtifactStore.getState().close())
  })

  afterEach(() => {
    act(() => useArtifactStore.getState().close())
  })

  it('switches between source and preview without opening a detached window', async () => {
    const user = userEvent.setup()
    render(<ArtifactPanel />)

    act(() => useArtifactStore.getState().openView(HTML_ARTIFACT))

    expect(screen.getByRole('complementary', { name: '代码面板' })).toHaveAttribute(
      'aria-hidden',
      'false'
    )
    expect(screen.getByText('欢迎页面')).toBeInTheDocument()
    expect(screen.getByText(/<h1>元AI<\/h1>/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '运行预览' }))

    expect(screen.getByTitle('欢迎页面 预览')).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-forms'
    )
    expect(screen.getByRole('button', { name: '查看源码' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '查看源码' }))

    expect(
      screen.getByRole('complementary', { name: '代码面板' }).querySelector('code')
    ).toHaveTextContent('<main><h1>元AI</h1></main>')
  })
})
