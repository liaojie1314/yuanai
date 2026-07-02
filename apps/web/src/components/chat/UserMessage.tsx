'use client'

import { useEffect, useRef, useState, type JSX } from 'react'
import { Copy, Check, Pencil } from 'lucide-react'
import type { MockMessage } from '@yuanai/core/stores'
import { getMsgText, formatMsgTime, stripMarkdown } from './utils'

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
 * 提供编辑与复制两种操作。复制支持两种模式：
 * - 复制 Markdown：保留原始格式
 * - 复制纯文本：剥离 Markdown 语法
 */
export function UserMessage({
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
  const copyWrapRef = useRef<HTMLDivElement>(null)
  const [localEdit, setLocalEdit] = useState(text)
  const [copyState, setCopyState] = useState<'idle' | 'open' | 'md' | 'txt'>('idle')

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

  useEffect(() => {
    if (copyState !== 'open') return
    const handler = (e: MouseEvent): void => {
      if (!copyWrapRef.current?.contains(e.target as Node)) setCopyState('idle')
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [copyState])

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const trimmed = localEdit.trim()
      if (trimmed) onSubmitEdit(trimmed)
      else onCancelEdit()
    }
    if (e.key === 'Escape') onCancelEdit()
  }

  const copyMd = (): void => {
    void navigator.clipboard.writeText(text)
    setCopyState('md')
    setTimeout(() => setCopyState('idle'), 2000)
  }

  const copyTxt = (): void => {
    void navigator.clipboard.writeText(stripMarkdown(text))
    setCopyState('txt')
    setTimeout(() => setCopyState('idle'), 2000)
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
          <div ref={copyWrapRef} className="ch-copy-wrap">
            <button
              className={`ch-msg-act ${copyState === 'md' || copyState === 'txt' ? 'copied' : ''}`}
              onClick={() => setCopyState((p) => (p === 'open' ? 'idle' : 'open'))}
              title="复制内容"
              aria-label="复制内容"
            >
              {copyState === 'md' || copyState === 'txt' ? <Check size={12} /> : <Copy size={12} />}
              {copyState === 'md' ? '已复制 MD' : copyState === 'txt' ? '已复制文本' : '复制'}
            </button>
            {copyState === 'open' && (
              <div className="ch-copy-dropdown">
                <button className="ch-copy-opt" onClick={copyMd}>
                  复制 Markdown
                </button>
                <button className="ch-copy-opt" onClick={copyTxt}>
                  复制纯文本
                </button>
              </div>
            )}
          </div>
          <button className="ch-msg-act" onClick={onStartEdit} aria-label="编辑消息">
            <Pencil size={12} /> 编辑
          </button>
        </div>
      </div>
    </div>
  )
}
