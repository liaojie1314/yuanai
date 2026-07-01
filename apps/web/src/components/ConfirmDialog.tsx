'use client'

import type { JSX } from 'react'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): JSX.Element | null {
  if (!open) return null
  return (
    <div className="ch-confirm-overlay" onClick={onCancel}>
      <div className="ch-confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="ch-confirm-title">{title}</h3>
        <p className="ch-confirm-msg">{message}</p>
        <div className="ch-confirm-btns">
          <button className="ch-confirm-cancel" onClick={onCancel}>
            {cancelText}
          </button>
          <button className={`ch-confirm-ok${danger ? 'danger' : ''}`} onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
