import type { UserPreferences } from '@yuanai/core/api'

import type { DesktopAppearanceState } from '../../shared/ipc-contract'

/** 根据 renderer 当前系统偏好解析实际主题。 */
export function resolveRendererTheme(theme: UserPreferences['theme']): 'light' | 'dark' {
  if (theme === 'light' || theme === 'dark') return theme
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

/** 将完整用户显示偏好应用到当前 renderer 文档。 */
export function applyRendererPreferences(preferences: UserPreferences): void {
  applyRendererTheme(preferences.theme)
  document.documentElement.setAttribute('data-density', preferences.density)
  document.documentElement.style.setProperty(
    '--desktop-font-size',
    preferences.fontSize === 'small' ? '12px' : preferences.fontSize === 'large' ? '15px' : '13px'
  )
}

/** 将用户主题选择应用到当前 renderer 文档。 */
export function applyRendererTheme(theme: UserPreferences['theme']): void {
  document.documentElement.setAttribute('data-theme', resolveRendererTheme(theme))
}

/** 将主进程已解析的主题应用到当前 renderer。 */
export function applyDesktopAppearance(state: DesktopAppearanceState): void {
  document.documentElement.setAttribute('data-theme', state.resolved)
}
