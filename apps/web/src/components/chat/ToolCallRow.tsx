'use client'

import { useState, type JSX } from 'react'
import { ChevronRight, Wrench, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ToolCall, ToolCallStatus } from '@yuanai/types'

/**
 * 工具调用状态到 UI 展示的映射。
 */
function statusMeta(
  status: ToolCallStatus,
  labels: {
    running: string
    done: string
    failed: string
    pending: string
  }
): {
  label: string
  className: string
  icon: JSX.Element
} {
  switch (status) {
    case 'running':
      return {
        label: labels.running,
        className: 'run',
        icon: <Loader2 size={11} className="ch-tool-spin" />,
      }
    case 'done':
      return { label: labels.done, className: 'done', icon: <CheckCircle2 size={11} /> }
    case 'error':
      return { label: labels.failed, className: 'err', icon: <XCircle size={11} /> }
    case 'pending':
    default:
      return { label: labels.pending, className: 'pending', icon: <Clock size={11} /> }
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
  const t = useTranslations('chat')
  const meta = statusMeta(toolCall.status, {
    running: t('toolRunning'),
    done: t('toolDone'),
    failed: t('toolFailed'),
    pending: t('toolPending'),
  })
  const argsPreview = toolCall.arguments.replace(/\s+/g, ' ').slice(0, 60)
  const durationLabel =
    toolCall.durationMs !== undefined
      ? t('toolDuration', { seconds: (toolCall.durationMs / 1000).toFixed(1) })
      : null

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
              <div className="ch-tool-lbl">{t('toolArguments')}</div>
              <pre className="ch-tool-code">{tryFormatJson(toolCall.arguments)}</pre>
            </div>
          )}
          {toolCall.status === 'done' && toolCall.result && (
            <div className="ch-tool-section">
              <div className="ch-tool-lbl">{t('toolResult')}</div>
              <pre className="ch-tool-code">{toolCall.result}</pre>
            </div>
          )}
          {toolCall.status === 'error' && toolCall.error && (
            <div className="ch-tool-section">
              <div className="ch-tool-lbl ch-tool-lbl-err">{t('toolError')}</div>
              <pre className="ch-tool-code ch-tool-code-err">{toolCall.error}</pre>
            </div>
          )}
          {toolCall.status === 'running' && (
            <div className="ch-tool-section ch-tool-running">{t('toolWaiting')}</div>
          )}
        </div>
      )}
    </div>
  )
}
