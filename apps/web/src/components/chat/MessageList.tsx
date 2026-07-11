'use client'

import { useMemo, type JSX, type RefObject } from 'react'
import { Virtuoso, type VirtuosoHandle, type ListRange } from 'react-virtuoso'
import { useChatStore } from '@yuanai/core/stores'
import type { MockMessage } from '@yuanai/core/stores'
import { UserMessage } from './UserMessage'
import { AIMessage } from './AIMessage'
import type { MsgPair } from './utils'

/**
 * 单个虚拟列表项描述（一条用户消息或一条 AI 消息，
 * 或流式过程中的乐观占位）。
 */
interface RowUser {
  kind: 'user'
  pair: MsgPair
}
interface RowAI {
  kind: 'ai'
  pair: MsgPair
  isStreaming: boolean
  streamingContent: string
  versionCount: number
  versionIdx: number
}
interface RowOptimisticUser {
  kind: 'opt-user'
  content: string
}
interface RowStreamingAI {
  kind: 'stream-ai'
  streamingContent: string
}
type Row = RowUser | RowAI | RowOptimisticUser | RowStreamingAI

export interface MessageListProps {
  virtuosoRef: RefObject<VirtuosoHandle | null>
  pairs: MsgPair[]
  /** 流式过程中显示的乐观用户消息（未持久化） */
  streamingUserMsg: string | null
  /** 是否要额外显示一条流式 AI 消息（非重新生成场景） */
  showStreamingAI: boolean
  /** 若非空，则该 pair 内联展示流式重新生成 */
  regeneratingPairKey: string | null
  /** 流式当前累积正文 */
  streamingContent: string
  timeFmt: '24h' | '12h'
  dateFmt: 'ymd' | 'mdy' | 'dmy'
  versionIdxs: Record<string, number>
  onFill: (text: string) => void
  editingMsgId: string | null
  onStartEdit: (msg: MockMessage) => void
  onSubmitEdit: (msg: MockMessage, text: string) => void
  onCancelEdit: () => void
  onVersionChange: (pairKey: string, idx: number) => void
  onRegenerate: (pair: MsgPair) => void
  onFeedback: (msgId: string, type: 'like' | 'dislike') => void
  msgFeedback: Record<string, 'like' | 'dislike'>
  onAtBottomStateChange: (atBottom: boolean) => void
  /**
   * 可视区域变化时回调「最能代表当前视野」的 pair 索引（用于右侧 outline 跟踪）。
   *
   * 选取策略：取可视区间中点对应的 pair，避免仅看首行时把上一条 pair 当作 active。
   */
  onRangeChanged?: (activePairIdx: number) => void
}

/**
 * 消息列表（虚拟滚动）。
 *
 * 使用 `react-virtuoso` 支持变高 item + 自动跟随粘底 + 平滑滚动。
 * 长对话中仅渲染可视区域附近的消息，性能不随长度退化。
 */
export function MessageList({
  virtuosoRef,
  pairs,
  streamingUserMsg,
  showStreamingAI,
  regeneratingPairKey,
  streamingContent,
  timeFmt,
  dateFmt,
  versionIdxs,
  onFill,
  editingMsgId,
  onStartEdit,
  onSubmitEdit,
  onCancelEdit,
  onVersionChange,
  onRegenerate,
  onFeedback,
  msgFeedback,
  onAtBottomStateChange,
  onRangeChanged,
}: MessageListProps): JSX.Element {
  const streamingThink = useChatStore((s) => s.streamingThink)
  const streamingToolCalls = useChatStore((s) => s.streamingToolCalls)

  const rows: Row[] = useMemo(() => {
    const list: Row[] = []
    for (const pair of pairs) {
      list.push({ kind: 'user', pair })
      const rawIdx = versionIdxs[pair.pairKey] ?? pair.assistants.length - 1
      const vIdx = Math.max(0, Math.min(rawIdx, pair.assistants.length - 1))
      const isPairRegenerating = regeneratingPairKey === pair.pairKey
      const effectiveVersionCount = pair.assistants.length + (isPairRegenerating ? 1 : 0)
      const effectiveVIdx = isPairRegenerating ? effectiveVersionCount - 1 : vIdx
      if (isPairRegenerating) {
        list.push({
          kind: 'ai',
          pair,
          isStreaming: true,
          streamingContent,
          versionCount: effectiveVersionCount,
          versionIdx: effectiveVIdx,
        })
      } else if (pair.assistants[vIdx]) {
        list.push({
          kind: 'ai',
          pair,
          isStreaming: false,
          streamingContent: '',
          versionCount: effectiveVersionCount,
          versionIdx: effectiveVIdx,
        })
      }
    }
    if (streamingUserMsg) list.push({ kind: 'opt-user', content: streamingUserMsg })
    if (showStreamingAI) list.push({ kind: 'stream-ai', streamingContent })
    return list
  }, [pairs, versionIdxs, regeneratingPairKey, streamingContent, streamingUserMsg, showStreamingAI])

  return (
    <Virtuoso<Row>
      ref={virtuosoRef as React.Ref<VirtuosoHandle>}
      data={rows}
      followOutput="auto"
      initialTopMostItemIndex={rows.length > 0 ? rows.length - 1 : 0}
      atBottomStateChange={onAtBottomStateChange}
      rangeChanged={(range: ListRange) => {
        if (!onRangeChanged) return
        // 每两行对应一个 pair（user + ai）；取可视区间中点，
        // 避免仅看到上一条 AI 尾部时误把上一 pair 当作 active。
        const midRow = Math.round((range.startIndex + range.endIndex) / 2)
        const pairIdx = Math.floor(midRow / 2)
        onRangeChanged(pairIdx)
      }}
      atBottomThreshold={80}
      increaseViewportBy={{ top: 300, bottom: 300 }}
      className="ch-virtuoso"
      components={{
        Header: () => <div style={{ height: 28 }} />,
        Footer: () => <div style={{ height: 20 }} />,
      }}
      itemContent={(_index, row) => {
        if (row.kind === 'user') {
          return (
            <div className="ch-msgs-inner ch-msgs-item">
              <UserMessage
                msg={row.pair.userMsg}
                editing={editingMsgId === row.pair.userMsg.id}
                timeFmt={timeFmt}
                dateFmt={dateFmt}
                onStartEdit={() => onStartEdit(row.pair.userMsg)}
                onSubmitEdit={(text) => onSubmitEdit(row.pair.userMsg, text)}
                onCancelEdit={onCancelEdit}
              />
            </div>
          )
        }
        if (row.kind === 'ai') {
          const asstMsg = row.isStreaming
            ? {
                id: `__regen__${row.pair.pairKey}`,
                role: 'assistant' as const,
                parts: [],
                createdAt: row.pair.userMsg.createdAt,
              }
            : (row.pair.assistants[row.versionIdx] as MockMessage)
          const asstId = asstMsg.id
          return (
            <div className="ch-msgs-inner ch-msgs-item">
              <AIMessage
                msg={asstMsg}
                isStreaming={row.isStreaming}
                streamingContent={row.streamingContent}
                onFill={onFill}
                timeFmt={timeFmt}
                dateFmt={dateFmt}
                versionCount={row.versionCount}
                versionIdx={row.versionIdx}
                onVersionChange={(i) => onVersionChange(row.pair.pairKey, i)}
                onRegenerate={() => onRegenerate(row.pair)}
                onFeedback={(type) => onFeedback(asstId, type)}
                feedbackGiven={msgFeedback[asstId]}
                streamingThink={streamingThink}
                streamingToolCalls={streamingToolCalls}
              />
            </div>
          )
        }
        if (row.kind === 'opt-user') {
          return (
            <div className="ch-msgs-inner ch-msgs-item">
              <UserMessage
                msg={{
                  id: '__opt_user__',
                  role: 'user',
                  parts: [{ type: 'text', content: row.content }],
                  createdAt: Date.now(),
                }}
                editing={false}
                timeFmt={timeFmt}
                dateFmt={dateFmt}
                onStartEdit={() => {}}
                onSubmitEdit={() => {}}
                onCancelEdit={() => {}}
              />
            </div>
          )
        }
        return (
          <div className="ch-msgs-inner ch-msgs-item">
            <AIMessage
              msg={{
                id: '__streaming__',
                role: 'assistant',
                parts: [],
                createdAt: Date.now(),
              }}
              isStreaming={true}
              streamingContent={row.streamingContent}
              onFill={onFill}
              timeFmt={timeFmt}
              dateFmt={dateFmt}
              streamingThink={streamingThink}
              streamingToolCalls={streamingToolCalls}
            />
          </div>
        )
      }}
    />
  )
}
