import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

import { registerExpoPush, unregisterExpoPush } from '@yuanai/core'

/**
 * Expo Push 注册/退订（Step 9）。
 *
 * 上报策略跟随设置页「AI 回复通知」开关：开 → 上报 token；关/退出登录 → 退订。
 * 前台收到通知仅抑制系统横幅（handler 返回不展示）——前台用户本来就在看流式
 * 回复，无需重复提醒；后台通知由系统正常展示。
 */

export const NOTIF_KEYS = {
  aiReply: 'notif_ai_reply',
  sound: 'notif_sound',
} as const

// 上次成功上报的 token；退出登录时凭它退订（此时无需再向 Expo 取一次）
const LAST_TOKEN_KEY = 'expo_push_token'

Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowAlert: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
})

export async function loadNotifPref(key: string, def: boolean): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(key)
    return v === null ? def : v === 'true'
  } catch {
    return def
  }
}

async function getExpoPushToken(): Promise<string | null> {
  const projectId = Constants.expoConfig?.extra?.['eas']?.['projectId'] as string | undefined
  // app.json 使用占位 projectId 时，getExpoPushTokenAsync 会白耗一次网络再抛错，
  // 直接短路；EAS 关联真实 projectId 后自动生效。
  if (!projectId || projectId === 'PROJECT_ID_PLACEHOLDER') return null
  try {
    const res = await Notifications.getExpoPushTokenAsync({ projectId })
    return res.data
  } catch {
    // 模拟器 / 无 Google 服务设备取不到 push token，静默降级
    return null
  }
}

/**
 * 静默注册：权限已授予时取 token 并上报后端。
 * 返回是否真正完成上报（占位 projectId / 无权限 / 网络失败均返回 false，不抛错）。
 */
export async function registerForPushNotifications(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync()
  if (status !== 'granted') return false

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: '默认',
      importance: Notifications.AndroidImportance.DEFAULT,
    })
  }

  const token = await getExpoPushToken()
  if (!token) return false

  try {
    await registerExpoPush({ token, platform: Platform.OS })
    await AsyncStorage.setItem(LAST_TOKEN_KEY, token)
    return true
  } catch {
    return false
  }
}

/** 退订：删除后端 token 记录（关开关 / 退出登录时调；需在 auth 清除前发起）。 */
export async function unregisterPushNotifications(): Promise<void> {
  const stored = await AsyncStorage.getItem(LAST_TOKEN_KEY).catch(() => null)
  const token = stored ?? (await getExpoPushToken())
  if (!token) return
  try {
    await unregisterExpoPush(token)
  } catch {
    // 网络失败留给后端 DeviceNotRegistered 清理兜底
  }
  await AsyncStorage.removeItem(LAST_TOKEN_KEY).catch(() => undefined)
}
