/**
 * 原生 Google Sign-In 取 token helper 的单元测试。
 *
 * 原生模块整体用 `vi.mock` 替身，只验分支逻辑：
 * 成功返回 id_token、取消返回 null（两种取消形态）、缺 id_token 抛错、
 * 未配置 client id 时 `isGoogleNativeAvailable()` 为 false。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const signIn = vi.fn()
const hasPlayServices = vi.fn()
const configure = vi.fn()

vi.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: (...args: unknown[]) => configure(...args),
    signIn: () => signIn(),
    hasPlayServices: () => hasPlayServices(),
  },
  statusCodes: { SIGN_IN_CANCELLED: '12501' },
  isErrorWithCode: (err: unknown): boolean =>
    typeof err === 'object' && err !== null && 'code' in err,
}))

const WEB_CLIENT_ID = 'test-web-client-id.apps.googleusercontent.com'

/** 每个用例重新 import，让模块级的 client id 与 configure 去重标记都重置。 */
async function loadModule(webClientId = WEB_CLIENT_ID) {
  vi.resetModules()
  if (webClientId) {
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = webClientId
  } else {
    delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
  }
  return import('./googleSignIn')
}

describe('googleSignIn', () => {
  beforeEach(() => {
    signIn.mockReset()
    hasPlayServices.mockReset().mockResolvedValue(true)
    configure.mockReset()
  })

  it('未配置 webClientId 时判定原生登录不可用', async () => {
    const mod = await loadModule('')
    expect(mod.isGoogleNativeAvailable()).toBe(false)
  })

  it('配置了 webClientId 时判定原生登录可用', async () => {
    const mod = await loadModule()
    expect(mod.isGoogleNativeAvailable()).toBe(true)
  })

  it('登录成功返回 id_token，且 configure 只调一次', async () => {
    const mod = await loadModule()
    signIn.mockResolvedValue({ type: 'success', data: { idToken: 'fake.id.token' } })

    expect(await mod.getGoogleIdToken()).toBe('fake.id.token')
    expect(await mod.getGoogleIdToken()).toBe('fake.id.token')
    expect(configure).toHaveBeenCalledTimes(1)
    expect(configure).toHaveBeenCalledWith(expect.objectContaining({ webClientId: WEB_CLIENT_ID }))
  })

  it('用户取消（cancelled 响应）返回 null', async () => {
    const mod = await loadModule()
    signIn.mockResolvedValue({ type: 'cancelled', data: null })
    expect(await mod.getGoogleIdToken()).toBeNull()
  })

  it('用户取消（抛 SIGN_IN_CANCELLED）返回 null', async () => {
    const mod = await loadModule()
    signIn.mockRejectedValue(Object.assign(new Error('cancelled'), { code: '12501' }))
    expect(await mod.getGoogleIdToken()).toBeNull()
  })

  it('SDK 未返回 id_token 时抛错', async () => {
    const mod = await loadModule()
    signIn.mockResolvedValue({ type: 'success', data: { idToken: null } })
    await expect(mod.getGoogleIdToken()).rejects.toThrow('id_token')
  })

  it('Play Services 缺失的异常向上抛出', async () => {
    const mod = await loadModule()
    hasPlayServices.mockRejectedValue(new Error('play services unavailable'))
    await expect(mod.getGoogleIdToken()).rejects.toThrow('play services unavailable')
  })
})
