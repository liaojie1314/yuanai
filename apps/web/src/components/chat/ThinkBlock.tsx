'use client'

import { useState, useEffect, type JSX } from 'react'
import { Brain, ChevronDown } from 'lucide-react'
import type { ToolCall } from '@yuanai/types'
import { ToolCallRow } from './ToolCallRow'

export interface ThinkBlockProps {
  /** 思考过程原始文字，可为空（仅工具调用场景） */
  content: string
  /** 消息包含的工具调用（有序） */
  toolCalls?: ToolCall[]
  /** 是否处于流式活跃态（显示 shimmer + 折叠图标动画） */
  active?: boolean
  /** 思考完成后累计的耗时（毫秒） */
  durationMs?: number
  /** 首次渲染时是否展开 */
  defaultOpen?: boolean
}

/**
 * 思考块组件。
 *
 * 展示 AI 一次回复的推理过程 + 工具调用链路：
 * - `active === true` 时头部有 shimmer 动画，默认展开；
 * - 完成后默认折叠，头部显示耗时。
 */
export function ThinkBlock({
  content,
  toolCalls,
  active = false,
  durationMs,
  defaultOpen,
}: ThinkBlockProps): JSX.Element {
  // 流式思考中默认展开；思考完成后自动折叠（对标原型图行为）
  const [open, setOpen] = useState(defaultOpen ?? active)

  useEffect(() => {
    if (active) {
      // 进入思考态：自动展开
      setOpen(true)
    } else {
      // 思考完成：自动折叠，用户可手动展开
      setOpen(false)
    }
  }, [active])

  const state = active ? 'active' : 'done'
  const label = active ? '正在思考…' : '已完成思考'
  const durationLabel =
    !active && durationMs !== undefined && durationMs > 0
      ? `${(durationMs / 1000).toFixed(1)} 秒`
      : null

  return (
    <div className={`ch-think-block ${open ? 'open' : ''}`} data-state={state}>
      <button
        className="ch-think-hd"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        type="button"
      >
        <span className="ch-think-hd-l">
          <span className="ch-think-ic">
            <Brain size={14} />
          </span>
          <span className="ch-think-lbl">{label}</span>
        </span>
        <span className="ch-think-hd-r">
          {durationLabel && <span className="ch-think-time">{durationLabel}</span>}
          <span className="ch-think-chev" aria-hidden="true">
            <ChevronDown size={13} />
          </span>
        </span>
      </button>
      <div className="ch-think-body">
        {content && <div className="ch-think-text">{content}</div>}
        {toolCalls && toolCalls.length > 0 && (
          <div className="ch-tool-list">
            {toolCalls.map((tc) => (
              <ToolCallRow key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}
        {!content && (!toolCalls || toolCalls.length === 0) && active && (
          <div className="ch-think-text ch-think-empty">正在准备…</div>
        )}
      </div>
    </div>
  )
}
