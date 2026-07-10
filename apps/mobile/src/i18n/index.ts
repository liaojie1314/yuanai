import * as Localization from 'expo-localization'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import { enUS } from './messages/en-US'
import { zhCN } from './messages/zh-CN'

/**
 * i18next 初始化：读取系统 locale，命中的 tag 走对应资源，否则退回 zh-CN。
 *
 * 后续「用户手动切换语言」会由 SettingsModal（Phase 3 UI 阶段）调用
 * `i18n.changeLanguage()`，并把选择结果通过 AsyncStorage 持久化后
 * 在启动时优先加载——脚手架阶段先只做被动跟随系统。
 */
export function initI18n(): void {
  if (i18n.isInitialized) return
  const systemLocale = Localization.getLocales()[0]?.languageTag ?? 'zh-CN'
  void i18n.use(initReactI18next).init({
    resources: {
      'zh-CN': { translation: zhCN },
      'en-US': { translation: enUS },
    },
    lng: systemLocale,
    fallbackLng: 'zh-CN',
    interpolation: { escapeValue: false },
    // RN 侧统一走 v3 兼容 API
    compatibilityJSON: 'v4',
  })
}

export { default as i18n } from 'i18next'
