import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Localization from 'expo-localization'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import { enUS } from './messages/en-US'
import { zhCN } from './messages/zh-CN'

export type AppLocale = 'zh-CN' | 'en-US'

const LOCALE_KEY = 'yuanai-locale'

/**
 * i18next 初始化：AsyncStorage 里的用户手动选择优先，其次系统 locale，
 * 都未命中退回 zh-CN。
 */
export async function initI18n(): Promise<void> {
  if (i18n.isInitialized) return
  let saved: string | null = null
  try {
    saved = await AsyncStorage.getItem(LOCALE_KEY)
  } catch {
    /* 存储异常时跟随系统 */
  }
  const systemLocale = Localization.getLocales()[0]?.languageTag ?? 'zh-CN'
  const lng = saved === 'zh-CN' || saved === 'en-US' ? saved : systemLocale
  await i18n.use(initReactI18next).init({
    resources: {
      'zh-CN': { translation: zhCN },
      'en-US': { translation: enUS },
    },
    lng,
    fallbackLng: 'zh-CN',
    interpolation: { escapeValue: false },
    // RN 侧统一走 v3 兼容 API
    compatibilityJSON: 'v4',
  })
}

/** 切换语言并持久化，供设置-语言屏调用 */
export async function changeAppLocale(locale: AppLocale): Promise<void> {
  await i18n.changeLanguage(locale)
  try {
    await AsyncStorage.setItem(LOCALE_KEY, locale)
  } catch {
    /* 持久化失败不阻塞切换 */
  }
}

export { default as i18n } from 'i18next'
