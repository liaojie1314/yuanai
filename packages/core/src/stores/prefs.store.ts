import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** 24 小时制 / 12 小时制 */
export type TimeFmt = '24h' | '12h'
/** 日期格式：年月日 / 月日年 / 日月年 */
export type DateFmt = 'ymd' | 'mdy' | 'dmy'

interface PrefsState {
  timeFmt: TimeFmt
  dateFmt: DateFmt
  /** 是否显示 AI 的思考过程（仅在模型支持时有效） */
  showThinking: boolean
  setTimeFmt: (fmt: TimeFmt) => void
  setDateFmt: (fmt: DateFmt) => void
  /** 切换思考过程显示开关 */
  setShowThinking: (show: boolean) => void
}

/**
 * 用户偏好设置 store（Zustand + persist）
 *
 * 持久化到 localStorage（key: `yuanai-prefs`），跨组件共享时间/日期格式及思考过程等设置。
 */
export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      timeFmt: '24h',
      dateFmt: 'ymd',
      showThinking: true,
      setTimeFmt: (timeFmt) => set({ timeFmt }),
      setDateFmt: (dateFmt) => set({ dateFmt }),
      setShowThinking: (showThinking) => set({ showThinking }),
    }),
    { name: 'yuanai-prefs' }
  )
)
