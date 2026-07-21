import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import { useEffect, useState } from 'react'
import { Platform } from 'react-native'

import { SettingsGroup, SettingsSwitchRow } from '@/components/settings/SettingsRows'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { useDialog } from '@/components/ui/Dialog'

const KEYS = {
  aiReply: 'notif_ai_reply',
  sound: 'notif_sound',
} as const

async function loadBool(key: string, def: boolean): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(key)
    return v === null ? def : v === 'true'
  } catch {
    return def
  }
}

/**
 * 通知屏：AI 回复通知（含系统权限申请）+ 声音开关。
 * 开关值落 AsyncStorage；推送 token 上报后端属 Step 9（Expo Push）范围。
 */
export default function NotificationsScreen(): React.JSX.Element {
  const dialog = useDialog()
  const [aiReply, setAiReply] = useState(false)
  const [sound, setSound] = useState(false)

  useEffect(() => {
    void (async () => {
      setAiReply(await loadBool(KEYS.aiReply, false))
      setSound(await loadBool(KEYS.sound, false))
    })()
  }, [])

  const persist = (key: string, v: boolean): void => {
    void AsyncStorage.setItem(key, String(v)).catch(() => undefined)
  }

  const onToggleAiReply = (next: boolean): void => {
    if (!next) {
      setAiReply(false)
      persist(KEYS.aiReply, false)
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
