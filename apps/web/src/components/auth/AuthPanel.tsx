'use client'

import { useState, useRef, useCallback, useEffect, type JSX } from 'react'

function isDark(): boolean {
  const t = document.documentElement.getAttribute('data-theme')
  return t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme:dark)').matches)
}

const SUN = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
)
const MOON = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
)

export default function AuthPanel({
  bubbles,
}: {
  bubbles: [string, string?, string?, string?, string?]
}): JSX.Element {
  const [dark, setDark] = useState(false)
  const asideRef = useRef<HTMLElement>(null)

  useEffect(() => {
    setDark(isDark())
  }, [])

  const toggle = (): void => {
    const next = dark ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('theme', next)
    setDark(!dark)
  }

  const onDragStart = useCallback((e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = asideRef.current?.offsetWidth ?? 0

    document.documentElement.style.cursor = 'col-resize'
    document.documentElement.style.userSelect = 'none'

    const onMove = (ev: MouseEvent): void => {
      const w = Math.max(360, Math.min(window.innerWidth - 560, startW + ev.clientX - startX))
      document.documentElement.style.setProperty('--auth-left-w', `${w}px`)
    }
    const onUp = (): void => {
      document.documentElement.style.cursor = ''
      document.documentElement.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  return (
    <aside className="auth-left" ref={asideRef}>
      <div>
        <div className="brand-row">
          <div className="brand-logo">元</div>
          <span className="brand-name">yuanai</span>
        </div>
        <p className="brand-tag">你的智能对话伙伴</p>
      </div>
      <button
        className="theme-toggle"
        aria-label={dark ? '切换浅色模式' : '切换深色模式'}
        onClick={toggle}
      >
        {dark ? SUN : MOON}
      </button>
      {bubbles[0] && <div className="bubble b1">{bubbles[0]}</div>}
      {bubbles[1] && <div className="bubble b2">{bubbles[1]}</div>}
      {bubbles[2] && <div className="bubble b3">{bubbles[2]}</div>}
      {bubbles[3] && <div className="bubble b4">{bubbles[3]}</div>}
      {bubbles[4] && <div className="bubble b5">{bubbles[4]}</div>}
      <div className="auth-resizer" onMouseDown={onDragStart} />
    </aside>
  )
}
