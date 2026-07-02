import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAuthStore } from '../auth.store'
import type { User } from '@yuanai/types'

const user: User = {
  id: 'u1',
  email: 'a@b.com',
  username: 'tester',
  avatarUrl: null,
  createdAt: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  useAuthStore.getState().clearAuth()
  localStorage.clear()
  sessionStorage.clear()
})

describe('auth.store — 初始状态', () => {
  it('user/accessToken/refreshToken 均为 null', () => {
    const s = useAuthStore.getState()
    expect(s.user).toBeNull()
    expect(s.accessToken).toBeNull()
    expect(s.refreshToken).toBeNull()
  })
})

describe('auth.store — 记住我持久化', () => {
  it('setAuth 默认记住我：state 落地 localStorage，不写 sessionStorage', () => {
    useAuthStore.getState().setAuth(user, 'at1', 'rt1')
    expect(localStorage.getItem('yuanai-remember')).toBe('1')
    expect(localStorage.getItem('yuanai-auth')).toContain('at1')
    expect(sessionStorage.getItem('yuanai-auth')).toBeNull()
  })

  it('setAuth 显式记住我(true)：cookie 有效期 7 天（max-age=604800）', () => {
    const cookieSetter = vi.spyOn(document, 'cookie', 'set')
    useAuthStore.getState().setAuth(user, 'at1', 'rt1', true)
    expect(cookieSetter).toHaveBeenCalledWith(expect.stringContaining('max-age=604800'))
    expect(cookieSetter).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent('at1')))
  })

  it('setAuth(remember=false)：state 落地 sessionStorage，不写 localStorage', () => {
    useAuthStore.getState().setAuth(user, 'at1', 'rt1', false)
    expect(localStorage.getItem('yuanai-remember')).toBeNull()
    expect(localStorage.getItem('yuanai-auth')).toBeNull()
    expect(sessionStorage.getItem('yuanai-auth')).toContain('at1')
  })

  it('setAuth(remember=false)：cookie 为会话 cookie（无 max-age）', () => {
    const cookieSetter = vi.spyOn(document, 'cookie', 'set')
    useAuthStore.getState().setAuth(user, 'at1', 'rt1', false)
    expect(cookieSetter).toHaveBeenCalledWith(expect.not.stringContaining('max-age'))
  })

  it('先记住我登录、再不记住我登录：旧 localStorage 副本被清除', () => {
    useAuthStore.getState().setAuth(user, 'at1', 'rt1', true)
    useAuthStore.getState().setAuth(user, 'at2', 'rt2', false)
    expect(localStorage.getItem('yuanai-auth')).toBeNull()
    expect(sessionStorage.getItem('yuanai-auth')).toContain('at2')
  })
})

describe('auth.store — setAccessToken（token 刷新场景）', () => {
  it('沿用已记住状态：更新 accessToken 且 cookie 仍是 7 天', () => {
    useAuthStore.getState().setAuth(user, 'at1', 'rt1', true)
    const cookieSetter = vi.spyOn(document, 'cookie', 'set')
    useAuthStore.getState().setAccessToken('at2')
    expect(useAuthStore.getState().accessToken).toBe('at2')
    expect(useAuthStore.getState().refreshToken).toBe('rt1')
    expect(cookieSetter).toHaveBeenCalledWith(expect.stringContaining('max-age=604800'))
  })

  it('沿用未记住状态：更新 accessToken 且 cookie 为会话 cookie', () => {
    useAuthStore.getState().setAuth(user, 'at1', 'rt1', false)
    const cookieSetter = vi.spyOn(document, 'cookie', 'set')
    useAuthStore.getState().setAccessToken('at2')
    expect(useAuthStore.getState().accessToken).toBe('at2')
    expect(cookieSetter).toHaveBeenCalledWith(expect.not.stringContaining('max-age'))
  })
})

describe('auth.store — clearAuth', () => {
  it('重置 state 为 null 并清除记住我标记', () => {
    useAuthStore.getState().setAuth(user, 'at1', 'rt1', true)
    useAuthStore.getState().clearAuth()
    const s = useAuthStore.getState()
    expect(s.user).toBeNull()
    expect(s.accessToken).toBeNull()
    expect(s.refreshToken).toBeNull()
    expect(localStorage.getItem('yuanai-remember')).toBeNull()
  })

  it('cookie 立即失效（max-age=0）', () => {
    useAuthStore.getState().setAuth(user, 'at1', 'rt1', true)
    const cookieSetter = vi.spyOn(document, 'cookie', 'set')
    useAuthStore.getState().clearAuth()
    expect(cookieSetter).toHaveBeenCalledWith(expect.stringContaining('max-age=0'))
  })
})
