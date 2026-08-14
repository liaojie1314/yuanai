import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ArtifactPanel } from '../ArtifactPanel'
import { useArtifactStore } from '@yuanai/core/stores'

const filePreview = vi.hoisted(() => ({
  value: null as {
    kind: 'image' | 'pdf' | 'text' | 'table' | 'unsupported'
    url: string
    mimeType: string
    text?: string
    rows?: string[][]
  } | null,
}))

vi.mock('@yuanai/core/hooks', () => ({
  useFilePreview: () => ({ data: filePreview.value, isError: false, isLoading: false }),
}))

Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
  writable: true,
  configurable: true,
})

beforeEach(() => {
  useArtifactStore.getState().close()
  filePreview.value = null
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
    const payload = useArtifactStore.getState().payload
    expect(payload?.kind === 'code' ? payload.mode : undefined).toBe('view')
  })

  it('view 模式下的"运行代码"按钮切到 run 模式（仅可运行语言）', () => {
    useArtifactStore.getState().openView({ title: 't', lang: 'css', code: 'body{color:red}' })
    render(<ArtifactPanel />)
    fireEvent.click(screen.getByRole('button', { name: '运行代码' }))
    const payload = useArtifactStore.getState().payload
    expect(payload?.kind === 'code' ? payload.mode : undefined).toBe('run')
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

  it('在同一右侧 Artifact 面板中预览图片附件', () => {
    filePreview.value = {
      kind: 'image',
      url: 'https://cdn.example.com/files/design.png',
      mimeType: 'image/png',
    }
    useArtifactStore.getState().openFilePreview({
      fileId: 'file-1',
      title: 'design.png',
      mimeType: 'image/png',
      url: 'https://cdn.example.com/files/design.png',
    })
    render(<ArtifactPanel />)
    expect(screen.getByRole('complementary', { name: '文件预览面板' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'design.png' })).toHaveAttribute(
      'src',
      'https://cdn.example.com/files/design.png'
    )
  })

  it('图片可以放大，并能在同一条消息的附件之间切换', () => {
    filePreview.value = {
      kind: 'image',
      url: 'https://cdn.example.com/files/one.png',
      mimeType: 'image/png',
    }
    const files = [
      {
        id: 'file-1',
        filename: 'one.png',
        mimeType: 'image/png',
        sizeBytes: 1,
        url: 'https://cdn.example.com/files/one.png',
      },
      {
        id: 'file-2',
        filename: 'two.png',
        mimeType: 'image/png',
        sizeBytes: 1,
        url: 'https://cdn.example.com/files/two.png',
      },
    ]
    useArtifactStore.getState().openFilePreview({
      fileId: 'file-1',
      title: 'one.png',
      mimeType: 'image/png',
      url: files[0]?.url ?? '',
      files,
      index: 0,
    })
    render(<ArtifactPanel />)

    fireEvent.click(screen.getByRole('button', { name: '放大 one.png' }))
    const lightbox = screen.getByRole('dialog', { name: '放大预览 one.png' })
    expect(lightbox).toBeInTheDocument()
    const viewport = lightbox.querySelector('.ch-ap-lightbox-viewport')
    if (!viewport) throw new Error('expected lightbox viewport')
    expect(within(lightbox).getByRole('button', { name: '缩小图片' })).toBeEnabled()
    fireEvent.wheel(viewport, { deltaY: -100 })
    expect(within(lightbox).getByRole('img', { name: 'one.png' })).toHaveStyle({
      transform: 'scale(1.25)',
    })
    fireEvent.click(within(lightbox).getByRole('button', { name: '缩小图片' }))
    fireEvent.click(within(lightbox).getByRole('button', { name: '缩小图片' }))
    expect(within(lightbox).getByRole('img', { name: 'one.png' })).toHaveStyle({
      transform: 'scale(0.75)',
    })
    fireEvent.click(within(lightbox).getByRole('button', { name: '下一个图片' }))
    expect(useArtifactStore.getState().payload).toMatchObject({
      fileId: 'file-2',
      index: 1,
    })
  })

  it('使用受限 iframe 预览 PDF 附件', () => {
    filePreview.value = {
      kind: 'pdf',
      url: 'https://cdn.example.com/files/requirements.pdf',
      mimeType: 'application/pdf',
    }
    useArtifactStore.getState().openFilePreview({
      fileId: 'file-2',
      title: 'requirements.pdf',
      mimeType: 'application/pdf',
      url: 'https://cdn.example.com/files/requirements.pdf',
    })
    render(<ArtifactPanel />)
    expect(screen.getByTitle('预览 requirements.pdf')).toHaveAttribute('sandbox', 'allow-downloads')
  })
})
