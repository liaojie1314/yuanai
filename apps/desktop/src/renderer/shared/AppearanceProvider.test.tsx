import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = vi.hoisted(() => ({
  displayPreferences: undefined as
    | ((preferences: {
        theme: 'auto' | 'light' | 'dark'
        fontSize: 'small' | 'medium' | 'large'
        density: 'compact' | 'standard' | 'loose'
        timeFormat: '24h' | '12h'
        dateFormat: 'ymd' | 'mdy' | 'dmy'
        language: string
      }) => void)
    | undefined,
}))

const stores = vi.hoisted(() => ({
  auth: { accessToken: null as string | null },
  prefs: {
    replaceAll: vi.fn(),
    setTheme: vi.fn(),
    theme: 'auto' as const,
  },
}))

vi.mock('@yuanai/core/hooks', () => ({ useMyPreferences: () => ({ data: undefined }) }))
vi.mock('@yuanai/core/stores', () => ({
  useAuthStore: (selector: (state: typeof stores.auth) => unknown) => selector(stores.auth),
  usePrefsStore: (selector: (state: typeof stores.prefs) => unknown) => selector(stores.prefs),
}))

import { AppearanceProvider } from './AppearanceProvider'
import { desktopI18n } from './i18n'

beforeEach(() => {
  handlers.displayPreferences = undefined
  Object.defineProperty(window, 'yuanai', {
    configurable: true,
    value: {
      appearance: { get: vi.fn().mockResolvedValue({ choice: 'auto', resolved: 'light' }) },
      events: {
        onAppearanceChanged: vi.fn().mockReturnValue(() => undefined),
        onDisplayPreferencesChanged: vi.fn((listener) => {
          handlers.displayPreferences = listener as typeof handlers.displayPreferences
          return () => undefined
        }),
      },
    },
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  document.documentElement.removeAttribute('data-density')
  document.documentElement.style.removeProperty('--desktop-font-size')
  void desktopI18n.changeLanguage('zh-CN')
})

describe('AppearanceProvider', () => {
  it('applies a trusted cross-window display preference event to renderer state', async () => {
    render(
      <AppearanceProvider>
        <span>内容</span>
      </AppearanceProvider>
    )

    await waitFor(() => expect(handlers.displayPreferences).toBeDefined())
    handlers.displayPreferences?.({
      theme: 'dark',
      fontSize: 'large',
      density: 'loose',
      timeFormat: '12h',
      dateFormat: 'mdy',
      language: 'zh-CN',
    })

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.documentElement).toHaveAttribute('data-density', 'loose')
    expect(document.documentElement.style.getPropertyValue('--desktop-font-size')).toBe('16px')
    expect(stores.prefs.replaceAll).toHaveBeenCalledWith({
      theme: 'dark',
      fontSize: 'large',
      density: 'loose',
      timeFmt: '12h',
      dateFmt: 'mdy',
    })
  })

  it('changes the current renderer language when another window saves display preferences', async () => {
    render(
      <AppearanceProvider>
        <span>内容</span>
      </AppearanceProvider>
    )

    await waitFor(() => expect(handlers.displayPreferences).toBeDefined())
    handlers.displayPreferences?.({
      theme: 'light',
      fontSize: 'medium',
      density: 'standard',
      timeFormat: '24h',
      dateFormat: 'ymd',
      language: 'en',
    })

    await waitFor(() => expect(desktopI18n.language).toBe('en'))
    expect(desktopI18n.t('settings.title')).toBe('Settings')
  })
})
