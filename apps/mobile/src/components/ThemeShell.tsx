import { useColorScheme } from 'nativewind'
import { useEffect } from 'react'
import { type ReactNode } from 'react'
import { StatusBar } from 'expo-status-bar'

import { usePrefsStore } from '@yuanai/core'

/**
 * 主题外壳：把 `usePrefsStore.theme` 的三态（auto/light/dark）翻译成 NativeWind 的
 * `colorScheme` 并管理系统状态栏样式。
 *
 * - `auto`：清除手动覆盖，NativeWind 回落到系统外观（`Appearance` API）
 * - `light` / `dark`：显式设置对应 colorScheme
 *
 * 系统状态栏 style 与最终生效的 colorScheme 保持互补（浅色底 → 深色字，反之亦然）。
 */
export function ThemeShell({ children }: { children: ReactNode }): ReactNode {
  const theme = usePrefsStore((s) => s.theme)
  const { colorScheme, setColorScheme } = useColorScheme()

  useEffect(() => {
    // NativeWind 4 需要 tailwind.config.js 设 darkMode: 'class' 才允许手动切换。
    // 用户偏好 auto 时不覆盖（让 NativeWind 跟随系统 Appearance）；light/dark 显式切换。
    if (theme === 'auto') return
    setColorScheme(theme)
  }, [theme, setColorScheme])

  return (
    <>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      {children}
    </>
  )
}
