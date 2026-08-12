import { Minus, Square, X } from 'lucide-react'
import { type ReactElement, type ReactNode } from 'react'

import './desktop-titlebar.css'

/** Linux 无边框窗口使用的最小桌面标题栏。 */
export function DesktopTitlebar({ children }: { children: ReactNode }): ReactElement {
  const usesCustomTitlebar = window.yuanai.platform === 'linux'
  const path = new URL(window.location.href).pathname
  const allowMaximize =
    !path.includes('/login/') && !path.includes('/about/') && !path.includes('/oauth/')

  return (
    <>
      {usesCustomTitlebar ? (
        <header className="desktop-titlebar" aria-label="窗口标题栏">
          <span className="desktop-titlebar__title">{document.title}</span>
          <div className="desktop-titlebar__controls" aria-label="窗口控制">
            <button
              type="button"
              aria-label="最小化"
              title="最小化"
              onClick={() => void window.yuanai.window.minimize()}
            >
              <Minus size={16} aria-hidden="true" />
            </button>
            {allowMaximize ? (
              <button
                type="button"
                aria-label="最大化或还原"
                title="最大化或还原"
                onClick={() => void window.yuanai.window.toggleMaximize()}
              >
                <Square size={13} aria-hidden="true" />
              </button>
            ) : null}
            <button
              className="desktop-titlebar__close"
              type="button"
              aria-label="关闭"
              title="关闭"
              onClick={() => void window.yuanai.window.close()}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>
      ) : null}
      {children}
    </>
  )
}
