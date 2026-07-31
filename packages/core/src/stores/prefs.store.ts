import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { StateStorage } from 'zustand/middleware'
import { getPlatformAdapter } from '../platform/index.js'

/** 24 小时制 / 12 小时制 */
export type TimeFmt = '24h' | '12h'
/** 日期格式：年月日 / 月日年 / 日月年 */
export type DateFmt = 'ymd' | 'mdy' | 'dmy'
/** 主题外观：跟随系统 / 明亮 / 暗黑 */
export type ThemeChoice = 'auto' | 'light' | 'dark'
/** 字号档位 */
export type FontSize = 'small' | 'medium' | 'large'
/** 界面密度 */
export type Density = 'compact' | 'standard' | 'loose'

interface PrefsState {
  timeFmt: TimeFmt
  dateFmt: DateFmt
  /** 是否显示 AI 的思考过程（仅在模型支持时有效） */
  showThinking: boolean
  /** 主题外观 */
  theme: ThemeChoice
  /** 字号 */
  fontSize: FontSize
  /** 界面密度 */
  density: Density
  setTimeFmt: (fmt: TimeFmt) => void
  setDateFmt: (fmt: DateFmt) => void
  /** 切换思考过程显示开关 */
  setShowThinking: (show: boolean) => void
  setTheme: (theme: ThemeChoice) => void
  setFontSize: (size: FontSize) => void
  setDensity: (d: Density) => void
  /** 批量替换（登录后从后端同步用） */
  replaceAll: (
    state: Partial<
      Omit<
        PrefsState,
        | 'setTimeFmt'
        | 'setDateFmt'
        | 'setShowThinking'
        | 'setTheme'
        | 'setFontSize'
        | 'setDensity'
        | 'replaceAll'
      >
    >
  ) => void
}

/**
 * 用户偏好设置 store（Zustand + persist）
 *
 * 持久化通过 {@link getPlatformAdapter} 暴露的 `storage` 桥接：
 * - Web：localStorage
 * - Mobile：AsyncStorage
 *
 * 跨组件共享时间/日期格式、主题、字号、密度及思考过程等设置。
 * 登录状态下会与后端 `/auth/me/preferences` 双向同步。
 */
// 与 auth.store 同款转发层：createJSONStorage 工厂在模块加载时立即求值，
// 若直接捕获 adapter 的 storage，会钉死在 setPlatformAdapter 之前的 Web 实现。
const lazyPrefsStorage: StateStorage = {
  getItem: (name) => getPlatformAdapter().storage.getItem(name),
  setItem: (name, value) => getPlatformAdapter().storage.setItem(name, value),
  removeItem: (name) => getPlatformAdapter().storage.removeItem(name),
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      timeFmt: '24h',
      dateFmt: 'ymd',
      showThinking: true,
      theme: 'auto',
      fontSize: 'medium',
      density: 'standard',
      setTimeFmt: (timeFmt) => set({ timeFmt }),
      setDateFmt: (dateFmt) => set({ dateFmt }),
      setShowThinking: (showThinking) => set({ showThinking }),
      setTheme: (theme) => set({ theme }),
      setFontSize: (fontSize) => set({ fontSize }),
      setDensity: (density) => set({ density }),
      replaceAll: (partial) => set(partial),
    }),
    {
      name: 'yuanai-prefs',
      storage: createJSONStorage(() => lazyPrefsStorage),
    }
  )
)
