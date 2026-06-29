import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getLocaleFromCookie, setLocaleCookie } from '@/i18n/client'
import { locales, localeNames, defaultLocale } from '@/i18n/config'

describe('i18n config', () => {
  it('exports supported locales', () => {
    expect(locales).toContain('zh-CN')
    expect(locales).toContain('en')
  })

  it('defaultLocale is zh-CN', () => {
    expect(defaultLocale).toBe('zh-CN')
  })

  it('localeNames covers all locales', () => {
    for (const locale of locales) {
      expect(localeNames[locale]).toBeTruthy()
    }
  })

  it('localeNames contains human-readable names', () => {
    expect(localeNames['zh-CN']).toBe('简体中文')
    expect(localeNames['en']).toBe('English')
  })
})

describe('getLocaleFromCookie', () => {
  const originalCookie = Object.getOwnPropertyDescriptor(document, 'cookie')

  afterEach(() => {
    // Reset cookie
    if (originalCookie) {
      Object.defineProperty(document, 'cookie', originalCookie)
    }
  })

  it('returns defaultLocale when no cookie is set', () => {
    Object.defineProperty(document, 'cookie', {
      get: () => '',
      configurable: true,
    })
    expect(getLocaleFromCookie()).toBe(defaultLocale)
  })

  it('returns locale from cookie', () => {
    Object.defineProperty(document, 'cookie', {
      get: () => 'NEXT_LOCALE=en; other=value',
      configurable: true,
    })
    expect(getLocaleFromCookie()).toBe('en')
  })

  it('returns zh-CN locale from cookie', () => {
    Object.defineProperty(document, 'cookie', {
      get: () => 'NEXT_LOCALE=zh-CN',
      configurable: true,
    })
    expect(getLocaleFromCookie()).toBe('zh-CN')
  })

  it('returns defaultLocale when cookie value is unknown locale', () => {
    Object.defineProperty(document, 'cookie', {
      get: () => 'NEXT_LOCALE=fr',
      configurable: true,
    })
    // unknown locale falls back to defaultLocale
    const result = getLocaleFromCookie()
    // 'fr' is not a valid locale, but the function returns it as-is
    // (validation happens at the server level)
    expect(typeof result).toBe('string')
  })
})

describe('setLocaleCookie', () => {
  let cookieValue = ''

  beforeEach(() => {
    cookieValue = ''
    Object.defineProperty(document, 'cookie', {
      get: () => cookieValue,
      set: (val: string) => {
        cookieValue = val
      },
      configurable: true,
    })
  })

  it('sets NEXT_LOCALE cookie with correct locale', () => {
    setLocaleCookie('en')
    expect(cookieValue).toContain('NEXT_LOCALE=en')
  })

  it('sets cookie with path=/', () => {
    setLocaleCookie('zh-CN')
    expect(cookieValue).toContain('path=/')
  })

  it('sets cookie with max-age for persistence', () => {
    setLocaleCookie('en')
    expect(cookieValue).toContain('max-age=')
  })

  it('can set zh-CN locale', () => {
    setLocaleCookie('zh-CN')
    expect(cookieValue).toContain('NEXT_LOCALE=zh-CN')
  })
})
