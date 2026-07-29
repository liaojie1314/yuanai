import { useLocalSearchParams, useRouter } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import { useEffect, useRef } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'

import { getMeWithToken, useAuthStore } from '@yuanai/core'

import { brand, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'

/**
 * 三方登录回调屏。
 *
 * 触发路径：
 * 1. 用户在登录页点 GitHub/Google → openAuthSessionAsync 打开系统浏览器
 * 2. 后端 OAuth callback 302 到 yuanai://oauth/callback?access_token=...&refresh_token=...
 * 3. `useLinkingHandler` 拦截并 router.replace 到本屏（把 query 原样带过来）
 * 4. 本屏读 token → getMeWithToken 拉当前用户 → 写 SecureStore + auth store → 跳主界面
 *
 * 若后端在 query 里带 error / error_description，直接弹 Alert 并回登录页，
 * 避免 token 缺失时长时间卡在 loading。
 */
export default function OAuthCallbackScreen(): React.JSX.Element {
  const t = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{
    access_token?: string
    refresh_token?: string
    error?: string
    error_description?: string
  }>()
  const setAuth = useAuthStore((s) => s.setAuth)
  const consumed = useRef(false)

  useEffect(() => {
    if (consumed.current) return
    consumed.current = true

    const accessToken = params.access_token
    const refreshToken = params.refresh_token
    const error = params.error

    if (error) {
      const desc = params.error_description ?? '三方登录失败'
      // 用 setTimeout 让页面先挂载，避免直接同步 replace 引发 warning
      setTimeout(() => {
        console.warn('OAuth error:', desc)
        router.replace('/(auth)/login')
      }, 0)
      return
    }

    if (!accessToken || !refreshToken) {
      setTimeout(() => {
        console.warn('OAuth callback 缺少 token')
        router.replace('/(auth)/login')
      }, 0)
      return
    }

    void (async () => {
      try {
        const user = await getMeWithToken(accessToken)
        await Promise.all([
          SecureStore.setItemAsync('access_token', accessToken),
          SecureStore.setItemAsync('refresh_token', refreshToken),
        ])
        setAuth(user, accessToken, refreshToken, true)
        router.replace('/(main)/chat')
      } catch (err) {
        console.warn('OAuth token 换取用户失败:', err)
        router.replace('/(auth)/login')
      }
    })()
  }, [params, router, setAuth])

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: t.bg.base,
      }}
    >
      <ActivityIndicator size="large" color={brand.solid} />
      <Text style={{ marginTop: spacing.md, fontSize: 14, color: t.text.secondary }}>
        正在完成登录…
      </Text>
    </View>
  )
}
