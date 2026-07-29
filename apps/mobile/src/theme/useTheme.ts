import { createContext, useContext, useMemo } from 'react'

import { usePrefsStore } from '@yuanai/core'

import {
  darkTheme,
  lightTheme,
  resolveDensity,
  resolveTypography,
  type DensityPref,
  type FontSizePref,
  type ThemeTokens,
} from './tokens'

/**
 * 主题 Context。ThemeShell 计算出当前生效的 **颜色** tokens 后通过它下发；
 * 不再依赖 NativeWind 的 useColorScheme —— NativeWind 4 的 setColorScheme
 * 在 Fabric + tailwind darkMode:'class' 组合下抛
 * "Unable to manually set color scheme without using darkMode: class"，
 * 导致切黑必崩（真机复现）。既然组件颜色全走 useTheme，就完全绕开 NativeWind
 * 的主题机制，自己算 auto/light/dark。
 *
 * 字号 / 密度不经 Context 下发：由 useTheme() 订阅 prefs store 再合并，
 * 避免偏好切换时整树 Provider 重建；同时保证 memo 组件因 store 订阅仍会重渲。
 */
export const ThemeContext = createContext<ThemeTokens>(lightTheme)

/** 消费当前主题 tokens（颜色 + 字号 + 密度）。必须在 ThemeShell 内使用；外层默认 light。 */
export function useTheme(): ThemeTokens {
  const base = useContext(ThemeContext)
  const fontSize = usePrefsStore((s) => s.fontSize) as FontSizePref
  const density = usePrefsStore((s) => s.density) as DensityPref

  return useMemo(
    () => ({
      ...base,
      typography: resolveTypography(fontSize),
      density: resolveDensity(density),
    }),
    [base, fontSize, density]
  )
}

export { darkTheme, lightTheme }
