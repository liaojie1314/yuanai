'use client'

import { useEffect, useRef, type JSX } from 'react'
import { X, CircleCheck, CircleAlert, Info, TriangleAlert } from 'lucide-react'
import { useToastStore, type ToastItem } from '@/hooks/useToast'

/** 单条 Toast 组件（带自动消失倒计时） */
function Toast({ item }: { item: ToastItem }): JSX.Element {
  const dismiss = useToastStore((s) => s.dismiss)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    timerRef.current = setTimeout(() => dismiss(item.id), 4000)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [item.id, dismiss])

  const icons: Record<ToastItem['type'], JSX.Element> = {
    error: <CircleAlert size={16} />,
    success: <CircleCheck size={16} />,
    info: <Info size={16} />,
    warning: <TriangleAlert size={16} />,
  }

  return (
    <div className={`ch-toast ch-toast-${item.type}`} role="alert" aria-live="assertive">
      <span className="ch-toast-icon">{icons[item.type]}</span>
      <span className="ch-toast-msg">{item.message}</span>
      <button className="ch-toast-close" onClick={() => dismiss(item.id)} aria-label="关闭通知">
        <X size={14} />
      </button>
    </div>
  )
}

/**
 * Toast 通知容器组件。
 *
 * 放置在根布局中即可全局生效，无需在每个页面单独引入。
 * Toast 显示在屏幕右上角，4 秒后自动消失，也可手动关闭。
 */
export function Toaster(): JSX.Element | null {
  const toasts = useToastStore((s) => s.toasts)
  if (toasts.length === 0) return null
  return (
    <div className="ch-toaster" role="region" aria-label="通知">
      {toasts.map((item) => (
        <Toast key={item.id} item={item} />
      ))}
    </div>
  )
}
