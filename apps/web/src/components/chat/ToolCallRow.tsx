'use client'

import { useState, type JSX } from 'react'
import { ChevronRight, Wrench, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react'
import type { ToolCall, ToolCallStatus } from '@yuanai/types'

/**
 * 工具调用状态到 UI 展示的映射。
 */
function statusMeta(status: ToolCallStatus): {
  label: string
  className: string
  icon: JSX.Element
} {
  switch (status) {
    case 'running':
      return {
        label: '进行中…',
        className: 'run',
        icon: <Loader2 size={11} className="ch-tool-spin" />,
      }
    case 'done':
      return { label: '已完成', className: 'done', icon: <CheckCircle2 size={11} /> }
    case 'error':
      return { label: '失败', className: 'err', icon: <XCircle size={11} /> }
    case 'pending':
    default:
      return { label: '等待中', className: 'pending', icon: <Clock size={11} /> }
  }
}

/**
 * 尝试格式化工具入参 JSON；失败时原样返回。
 */
function tryFormatJson(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return trimmed
  }
}

export interface ToolCallRowProps {
  /** 单次工具调用的完整信息 */
  toolCall: ToolCall
}

/**
 * 工具调用单行组件。
 *
 * 折叠状态：一行显示 `工具名(参数预览)` + 状态徽标；
 * 展开后显示完整参数 JSON、执行结果或错误。
 */
export function ToolCallRow({ toolCall }: ToolCallRowProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const meta = statusMeta(toolCall.status)
  const argsPreview = toolCall.arguments.replace(/\s+/g, ' ').slice(0, 60)
  const durationLabel =
    toolCall.durationMs !== undefined ? `${(toolCall.durationMs / 1000).toFixed(1)} 秒` : null

  return (
    <div className={`ch-tool-call ${open ? 'open' : ''}`}>
      <button className="ch-tool-hd" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="ch-tool-ic">
          <Wrench size={12} />
        </span>
        <span className="ch-tool-call-body">
          <span className="ch-tool-name">{toolCall.name}</span>
          {argsPreview && <span className="ch-tool-args">({argsPreview})</span>}
        </span>
        {durationLabel && <span className="ch-tool-dur">{durationLabel}</span>}
        <span className={`ch-tool-status ${meta.className}`}>
          {meta.icon}
          <span>{meta.label}</span>
        </span>
        <span className="ch-tool-chev" aria-hidden="true">
          <ChevronRight size={12} />
        </span>
      </button>
      {open && (
        <div className="ch-tool-body">
          {toolCall.arguments && (
            <div className="ch-tool-section">
              <div className="ch-tool-lbl">调用参数</div>
              <pre className="ch-tool-code">{tryFormatJson(toolCall.arguments)}</pre>
            </div>
          )}
          {toolCall.status === 'done' && toolCall.result && (
            <div className="ch-tool-section">
              <div className="ch-tool-lbl">执行结果</div>
              <pre className="ch-tool-code">{toolCall.result}</pre>
            </div>
          )}
          {toolCall.status === 'error' && toolCall.error && (
            <div className="ch-tool-section">
              <div className="ch-tool-lbl ch-tool-lbl-err">错误</div>
              <pre className="ch-tool-code ch-tool-code-err">{toolCall.error}</pre>
            </div>
          )}
          {toolCall.status === 'running' && (
            <div className="ch-tool-section ch-tool-running">正在执行工具，请稍候…</div>
          )}
        </div>
      )}
    </div>
  )
}
