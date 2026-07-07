'use client'

import { memo, useState, useRef, type JSX } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  RotateCcw,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react'
import { useChatStore, usePrefsStore } from '@yuanai/core/stores'
import type { MockMessage } from '@yuanai/core/stores'
import type { ToolCall } from '@yuanai/types'
import MarkdownContent from '@/components/MarkdownContent'
import { ThinkBlock } from './ThinkBlock'
import { CodeBlock } from './CodeBlock'
import { getMsgText, formatMsgTime, stripMarkdown } from './utils'

export interface AIMessageProps {
  msg: MockMessage
  isStreaming: boolean
  streamingContent: string
  onFill: (text: string) => void
  timeFmt: '24h' | '12h'
  dateFmt: 'ymd' | 'mdy' | 'dmy'
  versionCount?: number
  versionIdx?: number
  onVersionChange?: (idx: number) => void
  onRegenerate?: () => void
  onFeedback?: (type: 'like' | 'dislike') => void
  feedbackGiven?: 'like' | 'dislike' | undefined
  /** 是否处于流式思考中（外部传入以支持 shimmer 状态） */
  streamingThink?: string
  /** 流式过程中已产生的工具调用（有序） */
  streamingToolCalls?: ToolCall[]
}

/**
 * AI 消息渲染组件。
 *
 * 展示头像 + 思考块 + 内容（Markdown 或结构化 messageParts）+ 版本切换 / 复制 / 重新生成 / 反馈 / 追问。
 *
 * 用 `React.memo` 包裹，避免长对话滚动 / 兄弟消息状态变化触发的多余重渲；
 * 流式消息由 `streamingContent`/`streamingThink` 驱动，正常刷新不受影响。
 */
function AIMessageBase({
  msg,
  isStreaming,
  streamingContent,
  onFill,
  timeFmt,
  dateFmt,
  versionCount = 1,
  versionIdx = 0,
  onVersionChange,
  onRegenerate,
  onFeedback,
  feedbackGiven,
  streamingThink,
  streamingToolCalls,
}: AIMessageProps): JSX.Element {
  const displayContent = isStreaming ? streamingContent : getMsgText(msg)
  const [copyState, setCopyState] = useState<'idle' | 'open' | 'md' | 'txt'>('idle')
  const thinkDuration = useChatStore((s) => s.streamingThinkDurationMs)
  const showThinking = usePrefsStore((s) => s.showThinking)

  const copyMd = (): void => {
    void navigator.clipboard.writeText(displayContent)
    setCopyState('md')
    setTimeout(() => setCopyState('idle'), 2000)
  }

  const copyTxt = (): void => {
    void navigator.clipboard.writeText(stripMarkdown(displayContent))
    setCopyState('txt')
    setTimeout(() => setCopyState('idle'), 2000)
  }

  // 复制格式下拉：hover 展开，离开后延迟 200ms 收起，防止鼠标经过间隙时意外关闭
  const copyCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openCopyMenu = (): void => {
    if (copyCloseTimer.current) {
      clearTimeout(copyCloseTimer.current)
      copyCloseTimer.current = null
    }
    setCopyState((p) => (p === 'md' || p === 'txt' ? p : 'open'))
  }
  const closeCopyMenu = (): void => {
    if (copyCloseTimer.current) clearTimeout(copyCloseTimer.current)
    copyCloseTimer.current = setTimeout(() => setCopyState((p) => (p === 'open' ? 'idle' : p)), 200)
  }

  // 决定思考块的数据源与状态：流式期间用 store 数据，否则用消息静态数据
  const finalThinkContent = isStreaming ? (streamingThink ?? '') : (msg.thinkContent ?? '')
  const finalToolCalls = isStreaming ? (streamingToolCalls ?? []) : (msg.toolCalls ?? [])
  const hasThink = finalThinkContent.length > 0 || finalToolCalls.length > 0
  const thinkActive =
    isStreaming && (finalToolCalls.some((tc) => tc.status === 'running') || streamingContent === '')

  return (
    <div className="ch-msg ch-msg-ai">
      <div className="ch-msg-ai-av">元</div>
      <div className="ch-msg-body">
        {hasThink && showThinking && (
          <ThinkBlock
            content={finalThinkContent}
            toolCalls={finalToolCalls}
            active={thinkActive}
            {...(isStreaming
              ? { durationMs: thinkDuration }
              : msg.thinkDurationMs !== undefined
                ? { durationMs: msg.thinkDurationMs }
                : {})}
          />
        )}
        {displayContent && <MarkdownContent content={displayContent} streaming={isStreaming} />}
        {/* 结构化 parts 中的多模态资源渲染 */}
        {msg.parts
          .filter((p) => p.type === 'code' && p.code)
          .map((p, i) => (
            <CodeBlock key={`code-${i}`} lang={p.lang ?? ''} code={p.code ?? ''} />
          ))}
        {!isStreaming && (
          <>
            {versionCount > 1 && onVersionChange && (
              <div className="ch-ver-nav">
                <button
                  className="ch-ver-btn"
                  disabled={versionIdx === 0}
                  onClick={() => onVersionChange(versionIdx - 1)}
                  title="上一个版本"
                >
                  <ChevronLeft size={12} />
                </button>
                <span className="ch-ver-label">
                  {versionIdx + 1} / {versionCount}
                </span>
                <button
                  className="ch-ver-btn"
                  disabled={versionIdx === versionCount - 1}
                  onClick={() => onVersionChange(versionIdx + 1)}
                  title="下一个版本"
                >
                  <ChevronRight size={12} />
                </button>
              </div>
            )}
            <div className="ch-msg-acts">
              <span className="ch-msg-ts">{formatMsgTime(msg.createdAt, timeFmt, dateFmt)}</span>
              <div
                className="ch-copy-wrap"
                onMouseEnter={openCopyMenu}
                onMouseLeave={closeCopyMenu}
                onFocus={openCopyMenu}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) closeCopyMenu()
                }}
              >
                <button
                  className={`ch-msg-act ${copyState === 'md' || copyState === 'txt' ? 'copied' : ''}`}
                  onClick={copyMd}
                  title="复制内容"
                >
                  {copyState === 'md' || copyState === 'txt' ? (
                    <Check size={12} />
                  ) : (
                    <Copy size={12} />
                  )}
                  {copyState === 'md' ? '已复制 MD' : copyState === 'txt' ? '已复制文本' : '复制'}
                </button>
                {copyState === 'open' && (
                  <div
                    className="ch-copy-dropdown"
                    onMouseEnter={openCopyMenu}
                    onMouseLeave={closeCopyMenu}
                  >
                    <button className="ch-copy-opt" onClick={copyMd}>
                      复制 Markdown
                    </button>
                    <button className="ch-copy-opt" onClick={copyTxt}>
                      复制纯文本
                    </button>
                  </div>
                )}
              </div>
              <div className="ch-msg-act-sep" />
              {onRegenerate && (
                <button className="ch-msg-act" onClick={onRegenerate} title="重新生成回答">
                  <RotateCcw size={12} /> 重新生成
                </button>
              )}
              {onFeedback && (
                <>
                  <button
                    className={`ch-msg-act ${feedbackGiven === 'like' ? 'active-fb' : ''}`}
                    onClick={() => onFeedback('like')}
                    title="有帮助"
                  >
                    <ThumbsUp size={12} />
                  </button>
                  <button
                    className={`ch-msg-act ${feedbackGiven === 'dislike' ? 'active-fb' : ''}`}
                    onClick={() => onFeedback('dislike')}
                    title="有问题"
                  >
                    <ThumbsDown size={12} />
                  </button>
                </>
              )}
            </div>
          </>
        )}
        {!isStreaming && msg.followUps && msg.followUps.length > 0 && (
          <div className="ch-followups">
            {msg.followUps.map((fu) => (
              <button key={fu} className="ch-fu" onClick={() => onFill(fu)}>
                {fu}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * 自定义比较：MessageList itemContent 每次渲染都会生成新的箭头函数回调
 * （因为要绑定当前 pair）。回调身份变化本身不表明消息内容变化，因此
 * memo 只比较数据类 props，跳过回调比较。
 */
export const AIMessage = memo(AIMessageBase, (prev, next) => {
  return (
    prev.msg === next.msg &&
    prev.isStreaming === next.isStreaming &&
    prev.streamingContent === next.streamingContent &&
    prev.streamingThink === next.streamingThink &&
    prev.streamingToolCalls === next.streamingToolCalls &&
    prev.timeFmt === next.timeFmt &&
    prev.dateFmt === next.dateFmt &&
    prev.versionCount === next.versionCount &&
    prev.versionIdx === next.versionIdx &&
    prev.feedbackGiven === next.feedbackGiven
  )
}) as unknown as (props: AIMessageProps) => JSX.Element
