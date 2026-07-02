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
  it('从未打开过时面板已挂载但内容为空，且 aria-hidden 为 true', () => {
    const { container } = render(<ArtifactPanel />)
    const panel = container.querySelector('.ch-artifact-panel')
    expect(panel).not.toBeNull()
    expect(panel?.getAttribute('aria-hidden')).toBe('true')
    expect(panel?.querySelector('.ch-ap-lang')?.textContent).toBe('')
  })

  it('view 模式渲染语法高亮的只读代码', () => {
    useArtifactStore.getState().openView({ title: 't', lang: 'javascript', code: 'let a=1' })
    const { container } = render(<ArtifactPanel />)
    expect(container.querySelector('.ch-ap-body pre')?.textContent).toBe('let a=1')
    expect(screen.getByText('javascript')).toBeInTheDocument()
  })

  it('只有一个复制按钮（头部重复的复制按钮已移除）', () => {
    useArtifactStore.getState().openView({ title: 't', lang: 'html', code: 'x' })
    render(<ArtifactPanel />)
    expect(screen.getAllByRole('button', { name: /复制代码/ })).toHaveLength(1)
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

  it('关闭后面板仍挂载并保留最后一次内容，供滑出动画过渡', () => {
    useArtifactStore.getState().openView({ title: 't', lang: 'html', code: 'x' })
    const { container } = render(<ArtifactPanel />)
    fireEvent.click(screen.getByRole('button', { name: '关闭面板' }))
    const panel = container.querySelector('.ch-artifact-panel')
    expect(panel).not.toBeNull()
    expect(panel?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText('html')).toBeInTheDocument()
  })
})
