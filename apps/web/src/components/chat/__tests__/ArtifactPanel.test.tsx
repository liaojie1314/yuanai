import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ArtifactPanel } from '../ArtifactPanel'
import { useArtifactStore } from '@yuanai/core/stores'

Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
  writable: true,
  configurable: true,
})

beforeEach(() => {
  useArtifactStore.getState().close()
})

describe('ArtifactPanel', () => {
  it('关闭状态下不渲染', () => {
    const { container } = render(<ArtifactPanel />)
    expect(container.querySelector('.ch-artifact-panel')).toBeNull()
  })

  it('view 模式渲染 <pre> 只读代码', () => {
    useArtifactStore.getState().openView({ title: 't', lang: 'javascript', code: 'let a=1' })
    render(<ArtifactPanel />)
    expect(screen.getByText('let a=1')).toBeInTheDocument()
    expect(screen.getByText('javascript')).toBeInTheDocument()
  })

  it('run 模式渲染 iframe 且 srcdoc 含代码', () => {
    useArtifactStore.getState().openRun({ title: 'html demo', lang: 'html', code: '<h1>demo</h1>' })
    const { container } = render(<ArtifactPanel />)
    const iframe = container.querySelector('iframe.ch-ap-iframe') as HTMLIFrameElement | null
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts allow-forms')
    expect(iframe?.getAttribute('srcdoc') ?? '').toContain('<h1>demo</h1>')
  })

  it('run 模式下的"查看源码"按钮切回 view 模式', () => {
    useArtifactStore.getState().openRun({ title: 't', lang: 'html', code: '<p>x</p>' })
    render(<ArtifactPanel />)
    fireEvent.click(screen.getByRole('button', { name: '查看源码' }))
    expect(useArtifactStore.getState().payload?.mode).toBe('view')
  })

  it('view 模式下的"运行代码"按钮切到 run 模式（仅可运行语言）', () => {
    useArtifactStore.getState().openView({ title: 't', lang: 'css', code: 'body{color:red}' })
    render(<ArtifactPanel />)
    fireEvent.click(screen.getByRole('button', { name: '运行代码' }))
    expect(useArtifactStore.getState().payload?.mode).toBe('run')
  })

  it('view 模式下不可运行语言隐藏运行按钮', () => {
    useArtifactStore.getState().openView({ title: 't', lang: 'python', code: "print('a')" })
    render(<ArtifactPanel />)
    expect(screen.queryByRole('button', { name: '运行代码' })).not.toBeInTheDocument()
  })

  it('关闭按钮清空 store', () => {
    useArtifactStore.getState().openView({ title: 't', lang: 'html', code: 'x' })
    render(<ArtifactPanel />)
    fireEvent.click(screen.getByRole('button', { name: '关闭面板' }))
    expect(useArtifactStore.getState().open).toBe(false)
  })
})
