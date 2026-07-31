import { describe, it, expect, afterEach } from 'vitest'
import {
  getPlatformAdapter,
  setPlatformAdapter,
  resetPlatformAdapter,
  webAdapter,
} from '../index.js'
import type { PlatformAdapter } from '../index.js'

afterEach(() => {
  resetPlatformAdapter()
})

describe('platform adapter — 注册/切换', () => {
  it('默认适配器为 webAdapter', () => {
    expect(getPlatformAdapter()).toBe(webAdapter)
  })

  it('setPlatformAdapter 后 getPlatformAdapter 返回新实例', () => {
    const stub = {
      stream: () => ({ close: () => undefined }),
      storage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
      secureStorage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
      authStorage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    } satisfies PlatformAdapter
    setPlatformAdapter(stub)
    expect(getPlatformAdapter()).toBe(stub)
  })

  it('resetPlatformAdapter 恢复到 webAdapter', () => {
    setPlatformAdapter({
      ...webAdapter,
      stream: () => ({ close: () => undefined }),
    })
    resetPlatformAdapter()
    expect(getPlatformAdapter()).toBe(webAdapter)
  })
})

describe('webAdapter — storage', () => {
  afterEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('storage.setItem / getItem / removeItem 走 localStorage', () => {
    webAdapter.storage.setItem('yuanai-test', 'v1')
    expect(localStorage.getItem('yuanai-test')).toBe('v1')
    expect(webAdapter.storage.getItem('yuanai-test')).toBe('v1')
    webAdapter.storage.removeItem('yuanai-test')
    expect(localStorage.getItem('yuanai-test')).toBeNull()
  })

  it('authStorage 依"记住我"选择 local/session', () => {
    // 未记住：写 sessionStorage，清 localStorage
    webAdapter.setAuthRemembered?.(false)
    webAdapter.authStorage.setItem('yuanai-auth', 'A')
    expect(sessionStorage.getItem('yuanai-auth')).toBe('A')
    expect(localStorage.getItem('yuanai-auth')).toBeNull()

    // 记住：写 localStorage，清 sessionStorage
    webAdapter.setAuthRemembered?.(true)
    webAdapter.authStorage.setItem('yuanai-auth', 'B')
    expect(localStorage.getItem('yuanai-auth')).toBe('B')
    expect(sessionStorage.getItem('yuanai-auth')).toBeNull()
  })

  it('authStorage.getItem 优先 sessionStorage，退回 localStorage', () => {
    localStorage.setItem('yuanai-auth', 'L')
    expect(webAdapter.authStorage.getItem('yuanai-auth')).toBe('L')
    sessionStorage.setItem('yuanai-auth', 'S')
    expect(webAdapter.authStorage.getItem('yuanai-auth')).toBe('S')
  })

  it('isAuthRemembered 反映 setAuthRemembered', () => {
    webAdapter.setAuthRemembered?.(true)
    expect(webAdapter.isAuthRemembered?.()).toBe(true)
    webAdapter.setAuthRemembered?.(false)
    expect(webAdapter.isAuthRemembered?.()).toBe(false)
  })

  it('writeAuthCookie 记住时写 max-age=604800，否则会话 cookie', () => {
    let last = ''
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      set: (v: string) => {
        last = v
      },
      get: () => last,
    })
    webAdapter.writeAuthCookie?.('T', true)
    expect(last).toContain('max-age=604800')
    expect(last).toContain(encodeURIComponent('T'))
    webAdapter.writeAuthCookie?.('T2', false)
    expect(last).not.toContain('max-age=')
  })
})
