import { useEffect, type ReactElement, type ReactNode } from 'react'

import { useMyPreferences } from '@yuanai/core/hooks'
import { useAuthStore, usePrefsStore } from '@yuanai/core/stores'

import { applyDesktopAppearance, applyRendererPreferences, applyRendererTheme } from './appearance'
import { changeDesktopLanguage } from './i18n'

/** 为所有 renderer 同步真实用户偏好与 Electron 原生主题。 */
export function AppearanceProvider({ children }: { children: ReactNode }): ReactElement {
  const hasSession = useAuthStore((state) => state.accessToken !== null)
  const theme = usePrefsStore((state) => state.theme)
  const replaceAll = usePrefsStore((state) => state.replaceAll)
  const setTheme = usePrefsStore((state) => state.setTheme)
  const preferencesQuery = useMyPreferences()

  useEffect(() => {
    void window.yuanai.appearance
      .get()
      .then((state) => {
        applyDesktopAppearance(state)
        setTheme(state.choice)
      })
      .catch(() => applyRendererTheme(theme))
  }, [setTheme, theme])

  useEffect(
    () =>
      window.yuanai.events.onAppearanceChanged((state) => {
        applyDesktopAppearance(state)
        if (state.choice !== usePrefsStore.getState().theme) setTheme(state.choice)
      }),
    [setTheme]
  )

  useEffect(
    () =>
      window.yuanai.events.onDisplayPreferencesChanged((preferences) => {
        applyRendererPreferences(preferences)
        void changeDesktopLanguage(preferences.language)
        replaceAll({
          theme: preferences.theme,
          fontSize: preferences.fontSize,
          density: preferences.density,
          timeFmt: preferences.timeFormat,
          dateFmt: preferences.dateFormat,
        })
      }),
    [replaceAll]
  )

  useEffect(() => {
    if (!hasSession || !preferencesQuery.data) return
    const preferences = preferencesQuery.data
    applyRendererPreferences(preferences)
    void changeDesktopLanguage(preferences.language)
    replaceAll({
      theme: preferences.theme,
      fontSize: preferences.fontSize,
      density: preferences.density,
      timeFmt: preferences.timeFormat,
      dateFmt: preferences.dateFormat,
    })
    void window.yuanai.appearance.apply(preferences.theme).catch(() => undefined)
  }, [hasSession, preferencesQuery.data, replaceAll])

  return <>{children}</>
}
