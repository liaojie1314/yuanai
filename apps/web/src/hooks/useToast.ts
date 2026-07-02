'use client'

import { create } from 'zustand'

/** Toast 通知类型 */
export type ToastType = 'error' | 'success' | 'info' | 'warning'

/** 单条 Toast 数据 */
export interface ToastItem {
  id: string
  type: ToastType
  message: string
}

interface ToastStore {
  toasts: ToastItem[]
  /** 添加一条 toast，自动生成唯一 ID */
  push: (type: ToastType, message: string) => void
  /** 移除指定 ID 的 toast */
  dismiss: (id: string) => void
}

let _counter = 0

/** 全局 Toast store（zustand，无需 Provider） */
export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (type, message) => {
    const id = `toast-${++_counter}`
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }))
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/**
 * Toast 通知快捷 Hook。
 *
 * 在任意客户端组件中调用 `toast.error('消息')` 即可弹出浮动通知，
 * 无需传递 props 或 context — 底层由 zustand 全局 store 驱动。
 *
 * @example
 * ```tsx
 * const toast = useToast()
 * toast.error('用户名或密码错误')
 * toast.success('登录成功')
 * ```
 */
export function useToast() {
  const push = useToastStore((s) => s.push)
  return {
    error: (message: string) => push('error', message),
    success: (message: string) => push('success', message),
    info: (message: string) => push('info', message),
    warning: (message: string) => push('warning', message),
  }
}
