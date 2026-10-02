import {
  GoogleSignin,
  isErrorWithCode,
  statusCodes,
} from '@react-native-google-signin/google-signin'

/**
 * 原生 Google Sign-In 的 client id。
 *
 * - `webClientId`：Google Cloud Console 里的 **Web** 应用 client id，
 *   在 Android 上同时作为 `serverClientId`，决定 id_token 的 `aud`；
 * - `iosClientId`：iOS 客户端 client id（未配置时交给原生侧的
 *   `GoogleService-Info.plist` 决定）。
 *
 * 两者都通过 `EXPO_PUBLIC_*` 注入，不入库。申请步骤见
 * `docs/guides/google-android-oauth.md`。
 */
const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() ?? ''
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() ?? ''

/**
 * 原生 Google 登录是否可用。
 *
 * 未配置 `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` 时返回 `false`，登录页据此回退到
 * 系统浏览器 OAuth（`GET /auth/google?mobile=1`），避免没配凭据就直接报错。
 */
export function isGoogleNativeAvailable(): boolean {
  return webClientId.length > 0
}

/** `GoogleSignin.configure` 只需调用一次，用模块级标记去重。 */
let configured = false

function ensureConfigured(): void {
  if (configured) return
  GoogleSignin.configure({
    webClientId,
    ...(iosClientId ? { iosClientId } : {}),
  })
  configured = true
}

/**
 * 拉起原生 Google 登录并取回 id_token。
 *
 * @returns id_token；用户主动取消登录时返回 `null`（调用方应静默返回，不弹错误）
 * @throws 原生模块不可用、Play Services 缺失、SDK 未返回 id_token 等异常
 */
export async function getGoogleIdToken(): Promise<string | null> {
  ensureConfigured()
  // Android 必须先确认 Play Services 可用；iOS 上该调用直接 resolve
  await GoogleSignin.hasPlayServices()
  try {
    const result = await GoogleSignin.signIn()
    if (result.type === 'cancelled') return null
    const idToken = result.data.idToken
    if (!idToken) throw new Error('Google 未返回 id_token')
    return idToken
  } catch (err) {
    // 部分平台取消登录是以抛错的形式返回的，同样当作静默取消
    if (isErrorWithCode(err) && err.code === statusCodes.SIGN_IN_CANCELLED) return null
    throw err
  }
}
