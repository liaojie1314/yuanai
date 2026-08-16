import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesktopArtifactPayload } from '../../shared/ipc-contract'
import { ARTIFACT_MSG_SOURCE } from '@yuanai/core/utils'

import { App } from './App'

const artifact = vi.hoisted(() => ({
  payload: null as DesktopArtifactPayload | null,
  unsubscribe: vi.fn(),
}))

/** JSDOM 未实现 PointerEvent，显式补齐平移测试所需的坐标和指针 ID。 */
function createPointerEvent(
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  { clientX, clientY, pointerId }: { clientX: number; clientY: number; pointerId: number }
): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, clientX, clientY })
  Object.defineProperty(event, 'pointerId', { value: pointerId })
  return event
}

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

  it('renders images, videos and PDFs in the dedicated preview window', () => {
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
      title: '演示.mp4',
      sourceUrl: 'https://cdn.example.com/files/demo.mp4',
      mimeType: 'video/mp4',
    }
    const { unmount: unmountVideo } = render(<App />)
    const video = document.querySelector('video')
    expect(video).not.toHaveAttribute('controls')
    expect(video).not.toHaveAttribute('autoplay')
    expect(video).toHaveAttribute('preload', 'metadata')
    expect(screen.getByRole('button', { name: '播放视频' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: '视频进度' })).toBeDisabled()
    expect(video).toHaveAttribute('role', 'button')
    expect(video).toHaveAttribute('aria-label', '点击播放视频')

    unmountVideo()
    artifact.payload = {
      kind: 'file-preview',
      title: '需求.pdf',
      sourceUrl: 'https://cdn.example.com/files/spec.pdf',
      mimeType: 'application/pdf',
    }
    render(<App />)
    expect(screen.getByTitle('预览 需求.pdf')).toHaveAttribute('sandbox', 'allow-downloads')
  })

  it('toggles video playback when the video surface is clicked or activated by keyboard', () => {
    artifact.payload = {
      kind: 'file-preview',
      title: '讲解.mp4',
      sourceUrl: 'https://cdn.example.com/files/lesson.mp4',
      mimeType: 'video/mp4',
    }

    render(<App />)

    const video = document.querySelector('video')
    if (!(video instanceof HTMLVideoElement)) throw new Error('视频预览未渲染')
    const play = vi.fn().mockResolvedValue(undefined)
    const pause = vi.fn()
    Object.defineProperty(video, 'play', { configurable: true, value: play })
    Object.defineProperty(video, 'pause', { configurable: true, value: pause })
    Object.defineProperty(video, 'paused', { configurable: true, value: true })

    fireEvent.click(video)
    expect(play).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(video, { key: ' ' })
    expect(play).toHaveBeenCalledTimes(2)
  })

  it('fits an image without upscaling and supports wheel zoom below 100%', () => {
    artifact.payload = {
      kind: 'file-preview',
      title: '原图.png',
      sourceUrl: 'https://cdn.example.com/files/original.png',
      mimeType: 'image/png',
    }

    render(<App />)

    const image = screen.getByRole('img', { name: '原图.png' })
    const viewport = image.parentElement?.parentElement
    if (!(viewport instanceof HTMLDivElement)) throw new Error('图片预览视口未渲染')
    Object.defineProperties(image, {
      naturalHeight: { configurable: true, value: 400 },
      naturalWidth: { configurable: true, value: 400 },
    })
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 800 },
      clientWidth: { configurable: true, value: 1200 },
    })

    fireEvent.load(image)
    expect(image).toHaveStyle({ width: '400px' })
    expect(screen.getByText('100%')).toBeInTheDocument()

    fireEvent.wheel(viewport, { deltaY: 120 })
    expect(screen.getByText('89%')).toBeInTheDocument()
    expect(Number.parseFloat(image.style.width)).toBeCloseTo(400 / 1.12)
  })

  it('pans a zoomed image by dragging inside the preview viewport', () => {
    artifact.payload = {
      kind: 'file-preview',
      title: '超宽图片.png',
      sourceUrl: 'https://cdn.example.com/files/wide.png',
      mimeType: 'image/png',
    }

    render(<App />)

    const image = screen.getByRole('img', { name: '超宽图片.png' })
    const viewport = image.parentElement?.parentElement
    if (!(viewport instanceof HTMLDivElement)) throw new Error('图片预览视口未渲染')
    Object.defineProperties(image, {
      naturalHeight: { configurable: true, value: 800 },
      naturalWidth: { configurable: true, value: 1200 },
    })
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 400 },
      clientWidth: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 960 },
      scrollWidth: { configurable: true, value: 1440 },
    })
    viewport.scrollLeft = 320
    viewport.scrollTop = 240

    fireEvent.load(image)
    fireEvent.wheel(viewport, { deltaY: -120 })
    fireEvent(
      viewport,
      createPointerEvent('pointerdown', { clientX: 300, clientY: 220, pointerId: 1 })
    )
    fireEvent(
      viewport,
      createPointerEvent('pointermove', { clientX: 240, clientY: 170, pointerId: 1 })
    )
    fireEvent(
      viewport,
      createPointerEvent('pointerup', { clientX: 240, clientY: 170, pointerId: 1 })
    )

    expect(viewport.scrollLeft).toBe(380)
    expect(viewport.scrollTop).toBe(290)
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
