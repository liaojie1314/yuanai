'use client'

import { memo, useEffect, useRef, useState, type JSX } from 'react'
import { Copy, Check, Pencil } from 'lucide-react'
import type { MockMessage } from '@yuanai/core/stores'
import { getMsgText, formatMsgTime } from './utils'

export interface UserMessageProps {
  msg: MockMessage
  editing: boolean
  timeFmt: '24h' | '12h'
  dateFmt: 'ymd' | 'mdy' | 'dmy'
  onStartEdit: () => void
  onSubmitEdit: (text: string) => void
  onCancelEdit: () => void
}

/**
 * 用户消息气泡组件。
 *
 * 提供编辑与复制两种操作。复制直接写入用户原始输入文本，不弹出格式选择。
 *
 * 用 `React.memo` 包裹：MessageList 每次滚动/流式 token 到达都会重建 rows，
 * 若不 memo，UserMessage 会随父组件每次渲染而重渲，长对话下滚动明显掉帧。
 */
function UserMessageBase({
  msg,
  editing,
  timeFmt,
  dateFmt,
  onStartEdit,
  onSubmitEdit,
  onCancelEdit,
}: UserMessageProps): JSX.Element {
  const text = getMsgText(msg)
  const editRef = useRef<HTMLTextAreaElement>(null)
  const [localEdit, setLocalEdit] = useState(text)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (editing) {
      setLocalEdit(text)
      requestAnimationFrame(() => {
        const ta = editRef.current
        if (!ta) return
        ta.style.height = 'auto'
        ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
        ta.focus()
        ta.setSelectionRange(ta.value.length, ta.value.length)
      })
    }
  }, [editing, text])

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const trimmed = localEdit.trim()
      if (trimmed) onSubmitEdit(trimmed)
      else onCancelEdit()
    }
    if (e.key === 'Escape') onCancelEdit()
  }

  const copy = (): void => {
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (editing) {
    return (
      <div className="ch-msg ch-msg-user">
        <div className="ch-msg-body ch-msg-body-edit">
          <textarea
            ref={editRef}
            className="ch-edit-ta"
            value={localEdit}
            onChange={(e) => {
              setLocalEdit(e.target.value)
              const ta = e.currentTarget
              ta.style.height = 'auto'
              ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
            }}
            onKeyDown={handleKey}
          />
          <div className="ch-edit-acts">
            <span className="ch-edit-hint">Shift+Enter 换行 · Enter 提交</span>
            <button className="ch-edit-cancel" onClick={onCancelEdit}>
              取消
            </button>
            <button
              className="ch-edit-submit"
              onClick={() => {
                const t = localEdit.trim()
                if (t) onSubmitEdit(t)
              }}
            >
              提交
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="ch-msg ch-msg-user">
      <div className="ch-msg-body">
        <div className="ch-msg-bubble">{text}</div>
        <div className="ch-msg-acts">
          <span className="ch-msg-ts">{formatMsgTime(msg.createdAt, timeFmt, dateFmt)}</span>
          <button
            className={`ch-msg-act ${copied ? 'copied' : ''}`}
            onClick={copy}
            title="复制"
            aria-label="复制"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? '已复制' : '复制'}
          </button>
          <button className="ch-msg-act" onClick={onStartEdit} aria-label="编辑消息">
            <Pencil size={12} /> 编辑
          </button>
        </div>
      </div>
    </div>
  )
}

/** 同 AIMessage：MessageList 内联绑定回调导致身份变化，memo 只比较数据类 props。 */
export const UserMessage = memo(UserMessageBase, (prev, next) => {
  return (
    prev.msg === next.msg &&
    prev.editing === next.editing &&
    prev.timeFmt === next.timeFmt &&
    prev.dateFmt === next.dateFmt
  )
}) as unknown as (props: UserMessageProps) => JSX.Element
