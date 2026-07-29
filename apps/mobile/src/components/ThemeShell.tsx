import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Appearance } from 'react-native'
import { StatusBar } from 'expo-status-bar'

import { usePrefsStore } from '@yuanai/core'

import type { ThemeTokens } from '@/theme/tokens'
import { darkTheme, lightTheme, ThemeContext } from '@/theme/useTheme'

/**
 * 主题外壳：把 `usePrefsStore.theme` 三态（auto/light/dark）与系统外观合成为
 * 当前生效 tokens，通过 ThemeContext 下发给所有 useTheme() 消费者。
 *
 * 之前用 NativeWind `setColorScheme` 同步的方案在 NativeWind 4 + tailwind
 * darkMode:'class' 下会抛「Unable to manually set color scheme」并 crash
 * （切「深色」立即触发）；改为自管：`auto` → 订阅 `Appearance` 变化；
 * `light` / `dark` → 直接锁定。组件颜色全走 useTheme，完全绕开 NativeWind
 * 的主题机制。
 *
 * 状态栏 style 与实际主题互补（浅底深字，深底浅字）。
 */
export function ThemeShell({ children }: { children: ReactNode }): ReactNode {
  const theme = usePrefsStore((s) => s.theme)
  const [systemScheme, setSystemScheme] = useState<'light' | 'dark'>(() =>
    Appearance.getColorScheme() === 'dark' ? 'dark' : 'light'
  )

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme === 'dark' ? 'dark' : 'light')
    })
    return () => sub.remove()
  }, [])

  const effective: 'light' | 'dark' = theme === 'auto' ? systemScheme : theme
  const tokens: ThemeTokens = effective === 'dark' ? darkTheme : lightTheme

  return (
    <ThemeContext.Provider value={tokens}>
      <StatusBar style={effective === 'dark' ? 'light' : 'dark'} />
      {children}
    </ThemeContext.Provider>
  )
}
