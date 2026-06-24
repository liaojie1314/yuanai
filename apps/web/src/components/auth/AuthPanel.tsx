'use client'

import { useEffect, useCallback, type JSX } from 'react'
import { cn } from '@/lib/utils'

interface AuthPanelProps {
  /** 左侧浮动气泡文案，最多 3 条 */
  bubbles?: [string, string?, string?]
}

const SUN_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
const MOON_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`

/** 左侧渐变装饰面板（品牌 + 浮动气泡 + 主题切换） */
export default function AuthPanel({ bubbles }: AuthPanelProps): JSX.Element {
  const isDark = useCallback((): boolean => {
    if (typeof document === 'undefined') return false
    const t = document.documentElement.getAttribute('data-theme')
    return (
      t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme:dark)').matches)
    )
  }, [])

  const updateThemeBtn = useCallback((): void => {
    const btn = document.getElementById('authThemeBtn')
    if (!btn) return
    const dark = isDark()
    btn.innerHTML = dark ? SUN_SVG : MOON_SVG
    btn.setAttribute('aria-label', dark ? '切换浅色模式' : '切换深色模式')
  }, [isDark])

  useEffect(() => {
    updateThemeBtn()
  }, [updateThemeBtn])

  const handleTheme = useCallback((): void => {
    const dark = isDark()
    const next = dark ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('theme', next)
    updateThemeBtn()
  }, [isDark, updateThemeBtn])

  const [b1, b2, b3] = bubbles ?? []

  return (
    <aside
      className={cn(
        // mobile: 固定高度横幅
        'relative flex flex-col justify-between overflow-hidden',
        'h-40 flex-shrink-0 px-6 py-5',
        // desktop: 左侧占 45%，全高
        'lg:h-auto lg:min-h-screen lg:flex-[0_0_45%] lg:px-12 lg:py-12'
      )}
      style={{ background: 'var(--auth-grad)' }}
    >
      {/* 品牌区 */}
      <div>
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px] text-xl font-bold text-white"
            style={{
              background: 'rgba(255,255,255,.18)',
              border: '1px solid rgba(255,255,255,.28)',
            }}
          >
            元
          </div>
          <span className="text-xl font-semibold tracking-wide text-white">yuanai</span>
        </div>
        <p className="mt-1 text-[13px]" style={{ color: 'rgba(255,255,255,.7)' }}>
          你的智能对话伙伴
        </p>
      </div>

      {/* 主题切换 */}
      <button
        id="authThemeBtn"
        aria-label="切换主题"
        onClick={handleTheme}
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full transition-colors"
        style={{
          border: '1px solid rgba(255,255,255,.25)',
          background: 'rgba(255,255,255,.12)',
          color: 'rgba(255,255,255,.9)',
          backdropFilter: 'blur(4px)',
        }}
      />

      {/* 浮动气泡（仅桌面可见） */}
      {b1 && (
        <div
          className="absolute hidden lg:block"
          style={{
            bottom: '42%',
            left: '8%',
            background: 'rgba(255,255,255,.1)',
            border: '1px solid rgba(255,255,255,.18)',
            borderRadius: '12px 12px 12px 3px',
            padding: '10px 16px',
            color: 'rgba(255,255,255,.88)',
            fontSize: 13,
            whiteSpace: 'nowrap',
            animation: 'float 5s ease-in-out infinite',
            backdropFilter: 'blur(4px)',
          }}
        >
          {b1}
        </div>
      )}
      {b2 && (
        <div
          className="absolute hidden lg:block"
          style={{
            bottom: '52%',
            left: '22%',
            background: 'rgba(255,255,255,.1)',
            border: '1px solid rgba(255,255,255,.18)',
            borderRadius: '12px 12px 12px 3px',
            padding: '10px 16px',
            color: 'rgba(255,255,255,.88)',
            fontSize: 13,
            whiteSpace: 'nowrap',
            animation: 'float 5.5s ease-in-out .7s infinite',
            backdropFilter: 'blur(4px)',
          }}
        >
          {b2}
        </div>
      )}
      {b3 && (
        <div
          className="absolute hidden lg:block"
          style={{
            bottom: '36%',
            left: '16%',
            background: 'rgba(255,255,255,.1)',
            border: '1px solid rgba(255,255,255,.18)',
            borderRadius: '12px 12px 12px 3px',
            padding: '10px 16px',
            color: 'rgba(255,255,255,.88)',
            fontSize: 13,
            whiteSpace: 'nowrap',
            animation: 'float 4.8s ease-in-out 1.4s infinite',
            backdropFilter: 'blur(4px)',
          }}
        >
          {b3}
        </div>
      )}
    </aside>
  )
}
