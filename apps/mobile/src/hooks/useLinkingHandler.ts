import * as Linking from 'expo-linking'
import { useRouter } from 'expo-router'
import { useEffect } from 'react'

/**
 * 处理 Deep Link / Universal Link 触发的路由跳转。
 *
 * 覆盖两条链路：
 * - `Linking.getInitialURL()`：App 是被 URL 冷启动的（App 未运行）
 * - `Linking.addEventListener('url', ...)`：App 已在前后台，被 URL 唤起（热链接）
 *
 * 目前只识别两条模式，未识别的 URL 交给 expo-router 默认处理器（尝试匹配路由文件）。
 * - `yuanai://oauth/callback?access_token=...&refresh_token=...`
 * - `yuanai://share/:token`
 *
 * OAuth 场景的 token 只按 query 传给 `(auth)/oauth-callback` 页面消费一次，
 * 由该页面负责写 SecureStore 并 replace 到主界面（避免 token 停留在 URL 里）。
 */
export function useLinkingHandler(): void {
  const router = useRouter()

  useEffect(() => {
    const routeFromUrl = (rawUrl: string | null): void => {
      if (!rawUrl) return
      const parsed = Linking.parse(rawUrl)
      const path = parsed.path ?? ''

      // yuanai://oauth/callback
      if (path === 'oauth/callback' || path.endsWith('/oauth/callback')) {
        const qp = parsed.queryParams ?? {}
        const params = new URLSearchParams()
        for (const [k, v] of Object.entries(qp)) {
          if (typeof v === 'string') params.set(k, v)
          else if (Array.isArray(v) && typeof v[0] === 'string') params.set(k, v[0])
        }
        router.replace(`/(auth)/oauth-callback?${params.toString()}`)
        return
      }

      // yuanai://share/<token>
      const shareMatch = /^share\/([^/]+)$/.exec(path)
      if (shareMatch?.[1]) {
        router.push(`/share/${shareMatch[1]}`)
      }
    }

    void Linking.getInitialURL().then(routeFromUrl)
    const sub = Linking.addEventListener('url', (event) => {
      routeFromUrl(event.url)
    })
    return () => {
      sub.remove()
    }
  }, [router])
}
