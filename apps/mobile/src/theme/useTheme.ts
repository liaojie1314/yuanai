import { createContext, useContext } from 'react'

import { darkTheme, lightTheme, type ThemeTokens } from './tokens'

/**
 * 主题 Context。ThemeShell 计算出当前生效的 tokens 后通过它下发；
 * 不再依赖 NativeWind 的 useColorScheme —— NativeWind 4 的 setColorScheme
 * 在 Fabric + tailwind darkMode:'class' 组合下抛
 * "Unable to manually set color scheme without using darkMode: class"，
 * 导致切黑必崩（真机复现）。既然组件颜色全走 useTheme，就完全绕开 NativeWind
 * 的主题机制，自己算 auto/light/dark。
 */
export const ThemeContext = createContext<ThemeTokens>(lightTheme)

/** 消费当前主题 tokens。必须在 ThemeShell 内使用；外层默认返回 lightTheme。 */
export function useTheme(): ThemeTokens {
  return useContext(ThemeContext)
}

export { darkTheme, lightTheme }
