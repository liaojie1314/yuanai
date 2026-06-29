'use client'

import { useState, useRef, useCallback, useEffect, type JSX } from 'react'
import { Sun, Moon } from 'lucide-react'
import { useTranslations } from '@/i18n/client'

function isDark(): boolean {
  const t = document.documentElement.getAttribute('data-theme')
  return t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme:dark)').matches)
}

export default function AuthPanel({
  bubbles,
}: {
  bubbles: [string, string?, string?, string?, string?]
}): JSX.Element {
  const t = useTranslations('common')
  const tTheme = useTranslations('theme')
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
      const w = Math.max(360, Math.min(560, window.innerWidth - 560, startW + ev.clientX - startX))
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
          <span className="brand-name">{t('appName')}</span>
        </div>
        <p className="brand-tag">{t('tagline')}</p>
      </div>
      <button
        className="theme-toggle"
        aria-label={dark ? tTheme('toggleLight') : tTheme('toggleDark')}
        onClick={toggle}
      >
        {dark ? <Sun size={18} /> : <Moon size={18} />}
      </button>
      <div className="auth-left-deco" aria-hidden="true">
        元
      </div>
      {bubbles[0] && <div className="bubble b1">{bubbles[0]}</div>}
      {bubbles[1] && <div className="bubble b2">{bubbles[1]}</div>}
      {bubbles[2] && <div className="bubble b3">{bubbles[2]}</div>}
      {bubbles[3] && <div className="bubble b4">{bubbles[3]}</div>}
      {bubbles[4] && <div className="bubble b5">{bubbles[4]}</div>}
      <div className="auth-resizer" onMouseDown={onDragStart} />
    </aside>
  )
}
