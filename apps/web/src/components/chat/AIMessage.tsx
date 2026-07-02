'use client'

import { useState, type JSX } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  RotateCcw,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react'
import { useChatStore } from '@yuanai/core/stores'
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
 */
export function AIMessage({
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

  // 复制格式下拉改为 hover 触发（悬浮展开 / 移出收起），而非点击切换
  const openCopyMenu = (): void => setCopyState((p) => (p === 'md' || p === 'txt' ? p : 'open'))
  const closeCopyMenu = (): void => setCopyState((p) => (p === 'open' ? 'idle' : p))

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
        {hasThink && (
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
