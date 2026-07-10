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
    // nativewind 的类型定义把 setColorScheme 声明为 'light' | 'dark' | 'system'
    setColorScheme(theme === 'auto' ? 'system' : theme)
  }, [theme, setColorScheme])

  return (
    <>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      {children}
    </>
  )
}
