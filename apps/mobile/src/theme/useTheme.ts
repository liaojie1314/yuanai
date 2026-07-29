import { useColorScheme } from 'nativewind'

import { darkTheme, lightTheme, type ThemeTokens } from './tokens'

/**
 * 读取当前生效主题的 token 集合。
 *
 * ThemeShell 已把 usePrefsStore.theme（三态 auto|light|dark）同步到
 * NativeWind 的 colorScheme（含 auto → 系统 Appearance 的回落）；
 * 这里直接消费 NativeWind 的最终结果。
 *
 * 返回值是 lightTheme / darkTheme 之一（稳定引用），useMemo([t]) 在主题
 * 未切换时不会重新计算。
 */
export function useTheme(): ThemeTokens {
  const { colorScheme } = useColorScheme()
  return colorScheme === 'dark' ? darkTheme : lightTheme
}
