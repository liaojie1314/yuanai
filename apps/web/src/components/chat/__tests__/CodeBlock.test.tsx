import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { CodeBlock } from '../CodeBlock'
import { useArtifactStore } from '@yuanai/core/stores'

// jsdom 缺失 clipboard API：单测里桩掉
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
  writable: true,
  configurable: true,
})

beforeEach(() => {
  useArtifactStore.getState().close()
  vi.clearAllMocks()
})

describe('CodeBlock', () => {
  it('渲染语言标签与代码正文（语法高亮后按容器 textContent 校验）', () => {
    const { container } = render(<CodeBlock lang="typescript" code="const x = 1" />)
    expect(screen.getByText('typescript')).toBeInTheDocument()
    expect(container.querySelector('.ch-code-body')?.textContent).toBe('const x = 1')
  })

  it('无语言时回退到 "Code" 标签', () => {
    render(<CodeBlock lang="" code="hello" />)
    expect(screen.getByText('Code')).toBeInTheDocument()
  })

  it('点击复制调用剪贴板 API 并展示"已复制"', async () => {
    render(<CodeBlock lang="html" code="<p>ok</p>" />)
    const btn = screen.getByRole('button', { name: '复制代码' })
    await act(async () => {
      fireEvent.click(btn)
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('<p>ok</p>')
    expect(await screen.findByText('已复制')).toBeInTheDocument()
  })

  it('点击"面板查看"打开 artifact store 的 view 模式', () => {
    render(<CodeBlock lang="css" code=".c{color:red}" title="示例样式" />)
    fireEvent.click(screen.getByRole('button', { name: '面板查看' }))
    const state = useArtifactStore.getState()
    expect(state.open).toBe(true)
    expect(state.payload?.kind).toBe('code')
    expect(state.payload?.kind === 'code' ? state.payload.mode : undefined).toBe('view')
    expect(state.payload?.kind === 'code' ? state.payload.code : undefined).toBe('.c{color:red}')
    expect(state.payload?.title).toBe('示例样式')
  })

  it('HTML/CSS/JS 显示运行按钮，其他语言隐藏', () => {
    const { rerender } = render(<CodeBlock lang="html" code="<h1>x</h1>" />)
    expect(screen.getByRole('button', { name: '运行代码' })).toBeInTheDocument()

    rerender(<CodeBlock lang="python" code="print('x')" />)
    expect(screen.queryByRole('button', { name: '运行代码' })).not.toBeInTheDocument()
  })

  it('点击"运行"打开 artifact store 的 run 模式', () => {
    render(<CodeBlock lang="javascript" code="console.log(1)" />)
    fireEvent.click(screen.getByRole('button', { name: '运行代码' }))
    const state = useArtifactStore.getState()
    expect(state.open).toBe(true)
    expect(state.payload?.kind === 'code' ? state.payload.mode : undefined).toBe('run')
    expect(state.payload?.kind === 'code' ? state.payload.lang : undefined).toBe('javascript')
  })

  it('点击"下载"生成 Blob 并以标题+对应扩展名命名后触发下载', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-url')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURL,
      writable: true,
      configurable: true,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURL,
      writable: true,
      configurable: true,
    })
    let clickedFilename = ''
    const clickSpy = vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clickedFilename = this.download
    })

    render(<CodeBlock lang="python" code="print(1)" title="demo" />)
    fireEvent.click(screen.getByRole('button', { name: '下载代码' }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(createObjectURL.mock.calls[0]?.[0]).toBeInstanceOf(Blob)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(clickedFilename).toBe('demo.py')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')

    clickSpy.mockRestore()
  })
})
