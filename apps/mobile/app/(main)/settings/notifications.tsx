import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import { useEffect, useState } from 'react'
import { Platform } from 'react-native'

import { SettingsGroup, SettingsSwitchRow } from '@/components/settings/SettingsRows'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { useDialog } from '@/components/ui/Dialog'
import {
  loadNotifPref,
  NOTIF_KEYS as KEYS,
  registerForPushNotifications,
  unregisterPushNotifications,
} from '@/lib/pushNotifications'

/**
 * 通知屏：AI 回复通知（含系统权限申请 + Expo token 上报）+ 声音开关。
 * 开关值落 AsyncStorage；开 → 上报 Expo push token，关 → 后端退订。
 */
export default function NotificationsScreen(): React.JSX.Element {
  const dialog = useDialog()
  const [aiReply, setAiReply] = useState(false)
  const [sound, setSound] = useState(false)

  useEffect(() => {
    void (async () => {
      setAiReply(await loadNotifPref(KEYS.aiReply, false))
      setSound(await loadNotifPref(KEYS.sound, false))
    })()
  }, [])

  const persist = (key: string, v: boolean): void => {
    void AsyncStorage.setItem(key, String(v)).catch(() => undefined)
  }

  const onToggleAiReply = (next: boolean): void => {
    if (!next) {
      setAiReply(false)
      persist(KEYS.aiReply, false)
      void unregisterPushNotifications()
      return
    }
    void (async () => {
      let { status } = await Notifications.getPermissionsAsync()
      if (status !== 'granted') {
        const req = await Notifications.requestPermissionsAsync()
        status = req.status
      }
      if (status !== 'granted') {
        void dialog.alert({
          title: '通知权限被拒绝',
          message: '请到系统设置 → 应用 → 元AI 里手动开启通知权限',
        })
        return
      }
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: '默认',
          importance: Notifications.AndroidImportance.DEFAULT,
        })
      }
      setAiReply(true)
      persist(KEYS.aiReply, true)
      // token 上报失败（占位 projectId / 模拟器）不阻断开关——EAS 配好后自动生效
      void registerForPushNotifications()
    })()
  }

  return (
    <SettingsShell title="通知">
      <SettingsGroup label="推送">
        <SettingsSwitchRow
          label="AI 回复通知"
          sublabel="AI 在后台完成回复时提醒我"
          value={aiReply}
          onValueChange={onToggleAiReply}
        />
        <SettingsSwitchRow
          label="提示音"
          sublabel="收到通知时播放声音"
          divider={false}
          value={sound}
          onValueChange={(v) => {
            setSound(v)
            persist(KEYS.sound, v)
          }}
        />
      </SettingsGroup>
    </SettingsShell>
  )
}
