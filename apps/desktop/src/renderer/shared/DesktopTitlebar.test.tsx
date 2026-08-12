import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { changeDesktopLanguage, DesktopI18nProvider } from './i18n'
import { DesktopTitlebar } from './DesktopTitlebar'

function installDesktopApi(platform: NodeJS.Platform): void {
  Object.defineProperty(window, 'yuanai', {
    configurable: true,
    value: {
      platform,
      window: {
        close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        minimize: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        toggleMaximize: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      },
    },
  })
}

beforeEach(() => {
  window.history.replaceState({}, '', '/settings/index.html')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  void changeDesktopLanguage('zh-CN')
})

describe('DesktopTitlebar', () => {
  it('provides Linux title-bar controls through fixed desktop APIs', () => {
    installDesktopApi('linux')
    render(
      <DesktopI18nProvider>
        <DesktopTitlebar>
          <main>设置内容</main>
        </DesktopTitlebar>
      </DesktopI18nProvider>
    )

    const minimize = screen.getByRole('button', { name: '最小化' })
    const maximize = screen.getByRole('button', { name: '最大化或还原' })
    const close = screen.getByRole('button', { name: '关闭' })
    fireEvent.click(minimize)
    fireEvent.click(maximize)
    fireEvent.click(close)

    expect(window.yuanai.window.minimize).toHaveBeenCalledOnce()
    expect(window.yuanai.window.toggleMaximize).toHaveBeenCalledOnce()
    expect(window.yuanai.window.close).toHaveBeenCalledOnce()
  })

  it('keeps fixed-size login windows free of a maximize control', () => {
    installDesktopApi('linux')
    window.history.replaceState({}, '', '/login/index.html')
    render(
      <DesktopI18nProvider>
        <DesktopTitlebar>
          <main>登录内容</main>
        </DesktopTitlebar>
      </DesktopI18nProvider>
    )

    expect(screen.getByRole('button', { name: '最小化' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '最大化或还原' })).not.toBeInTheDocument()
  })

  it('leaves macOS native title bars in control', () => {
    installDesktopApi('darwin')
    render(
      <DesktopI18nProvider>
        <DesktopTitlebar>
          <main>关于内容</main>
        </DesktopTitlebar>
      </DesktopI18nProvider>
    )

    expect(screen.queryByRole('banner', { name: '窗口标题栏' })).not.toBeInTheDocument()
  })

  it('keeps 元AI in the custom title bar after switching the interface language', async () => {
    installDesktopApi('linux')
    render(
      <DesktopI18nProvider>
        <DesktopTitlebar>
          <main>Settings content</main>
        </DesktopTitlebar>
      </DesktopI18nProvider>
    )

    await changeDesktopLanguage('en')

    expect(await screen.findByText('Settings - 元AI')).toBeInTheDocument()
    expect(document.title).toBe('Settings - 元AI')
  })
})
