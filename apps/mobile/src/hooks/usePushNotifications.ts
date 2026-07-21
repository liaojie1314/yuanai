import * as Notifications from 'expo-notifications'
import { useRouter } from 'expo-router'
import { useEffect } from 'react'

import { useAuthStore } from '@yuanai/core'

import { loadNotifPref, NOTIF_KEYS, registerForPushNotifications } from '@/lib/pushNotifications'

/**
 * 推送生命周期挂载（(main) 布局内使用，保证已登录）：
 * 1. 登录态下若「AI 回复通知」开关为开，静默补注册 token（权限已授予时才会成功）
 * 2. 监听通知点击：带 convId 的通知直接路由到对应会话
 */
export function usePushNotifications(): void {
  const router = useRouter()
  const accessToken = useAuthStore((s) => s.accessToken)

  useEffect(() => {
    if (!accessToken) return
    void (async () => {
      const enabled = await loadNotifPref(NOTIF_KEYS.aiReply, false)
      if (enabled) await registerForPushNotifications()
    })()
  }, [accessToken])

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const convId = response.notification.request.content.data['convId']
      if (typeof convId === 'string' && convId) {
        router.push(`/(main)/chat/${convId}`)
      }
    })
    return () => {
      sub.remove()
    }
  }, [router])
}
