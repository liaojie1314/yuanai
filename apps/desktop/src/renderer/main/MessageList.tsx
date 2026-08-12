import { useMemo, type ReactElement, type RefObject } from 'react'
import {
  Virtuoso,
  type ListProps,
  type ScrollSeekConfiguration,
  type ScrollSeekPlaceholderProps,
  type VirtuosoHandle,
} from 'react-virtuoso'

import { clampVersionIdx } from '@yuanai/core/utils'
import type { MessagePair } from '@yuanai/core/utils'
import type { DateFmt, TimeFmt } from '@yuanai/core/stores'
import type { User } from '@yuanai/types'

import type { DesktopArtifactPayload } from '../../shared/ipc-contract'
import { ChatMessage, StreamingMessage } from './MessageContent'

interface PairRow {
  kind: 'pair'
  pair: MessagePair
}

interface OptimisticUserRow {
  content: string
  kind: 'optimistic-user'
}

interface StreamingAssistantRow {
  kind: 'streaming-assistant'
}

type MessageListRow = PairRow | OptimisticUserRow | StreamingAssistantRow

const SCROLL_SEEK_CONFIGURATION: ScrollSeekConfiguration = {
  enter: (velocity) => Math.abs(velocity) > 100,
  exit: (velocity) => Math.abs(velocity) < 10,
}

function ScrollSeekPlaceholder({ height }: ScrollSeekPlaceholderProps): ReactElement {
  return (
    <div className="desktop-chat__scroll-seek-placeholder" style={{ height }} aria-hidden="true" />
  )
}

/** 桌面端虚拟消息列表的交互输入。 */
export interface MessageListProps {
  /** 消息列表的命令式滚动句柄。 */
  listRef: RefObject<VirtuosoHandle | null>
  /** 当前会话按问答关系整理后的消息对。 */
  pairs: readonly MessagePair[]
  /** 当前登录用户，用于用户消息头像。 */
  user: User | null
  /** 是否正在接收 SSE 流式回复。 */
  isStreaming: boolean
  /** 当前会话是否为不持久化的临时对话。 */
  isTemporaryConversation: boolean
  /** 正在重新生成的问答对键。 */
  regeneratingPairKey: string | null
  /** 尚未写入消息历史的乐观用户消息。 */
  optimisticUserMessage: string | null
  /** 当前流式回复正文。 */
  streamingContent: string
  /** 当前流式思考内容。 */
  streamingThinking: string
  /** 当前流式思考耗时。 */
  streamingThinkingDurationMs: number
  /** 当前流式工具调用。 */
  streamingToolCalls: Parameters<typeof StreamingMessage>[0]['toolCalls']
  /** AI 多版本的当前选中下标。 */
  versionIndexes: Readonly<Record<string, number>>
  /** 已提交的 AI 消息反馈。 */
  messageFeedback: Readonly<Record<string, 'like' | 'dislike'>>
  /** 用户偏好的消息时间格式。 */
  timeFmt: TimeFmt
  /** 用户偏好的消息日期格式。 */
  dateFmt: DateFmt
  /** 虚拟列表是否贴近底部的状态回调。 */
  onAtBottomStateChange(atBottom: boolean): void
  /** 覆盖用户消息并重新请求回复。 */
  onEditMessage(messageId: string, content: string): void
  /** 重新生成一条 AI 回复。 */
  onRegenerateMessage(content: string, pairKey: string): void
  /** 打开 AI 消息反馈弹窗。 */
  onOpenFeedback(messageId: string, type: 'like' | 'dislike'): void
  /** 在 Artifact 窗口中打开代码或数据。 */
  onOpenArtifact(payload: DesktopArtifactPayload): void
  /** 切换同一个问题下的 AI 回复版本。 */
  onVersionChange(pairKey: string, index: number): void
}

/**
 * 虚拟化桌面端聊天历史。
 *
 * 每一项保持完整的「用户问题 + 当前 AI 版本」关系，既减少长会话的 DOM 节点，
 * 也不会破坏重新生成和版本切换行为。流式更新仅重绘可视区域附近的项目。
 */
export function MessageList({
  listRef,
  pairs,
  user,
  isStreaming,
  isTemporaryConversation,
  regeneratingPairKey,
  optimisticUserMessage,
  streamingContent,
  streamingThinking,
  streamingThinkingDurationMs,
  streamingToolCalls,
  versionIndexes,
  messageFeedback,
  timeFmt,
  dateFmt,
  onAtBottomStateChange,
  onEditMessage,
  onRegenerateMessage,
  onOpenFeedback,
  onOpenArtifact,
  onVersionChange,
}: MessageListProps): ReactElement {
  const rows = useMemo((): MessageListRow[] => {
    const nextRows: MessageListRow[] = pairs.map((pair) => ({ kind: 'pair', pair }))
    const shouldRenderOptimisticUser =
      isStreaming &&
      regeneratingPairKey === null &&
      optimisticUserMessage !== null &&
      !isTemporaryConversation

    if (shouldRenderOptimisticUser && optimisticUserMessage) {
      nextRows.push({ kind: 'optimistic-user', content: optimisticUserMessage })
    }
    if (isStreaming && regeneratingPairKey === null) {
      nextRows.push({ kind: 'streaming-assistant' })
    }
    return nextRows
  }, [isStreaming, isTemporaryConversation, optimisticUserMessage, pairs, regeneratingPairKey])

  return (
    <Virtuoso<MessageListRow>
      ref={listRef}
      className="desktop-chat__messages"
      data={rows}
      aria-busy={isStreaming}
      computeItemKey={(_index, row) =>
        row.kind === 'pair' ? row.pair.pairKey : `desktop-${row.kind}`
      }
      followOutput={(atBottom) => (atBottom ? 'auto' : false)}
      initialTopMostItemIndex={{ index: 'LAST', align: 'end' }}
      atBottomStateChange={onAtBottomStateChange}
      atBottomThreshold={80}
      increaseViewportBy={{ top: 120, bottom: 120 }}
      overscan={{ main: 480, reverse: 480 }}
      scrollSeekConfiguration={SCROLL_SEEK_CONFIGURATION}
      components={{
        Header: () => <div className="desktop-chat__message-list-spacer" />,
        Footer: () => <div className="desktop-chat__message-list-spacer" />,
        List: (props: ListProps) => <div {...props} className="desktop-chat__message-list" />,
        ScrollSeekPlaceholder,
      }}
      itemContent={(_index, row) => {
        if (row.kind === 'optimistic-user') {
          return (
            <article className="desktop-chat__message desktop-chat__message--user">
              <div className="desktop-chat__message-body">
                <div className="desktop-chat__markdown desktop-chat__message-bubble">
                  <p>{row.content}</p>
                </div>
              </div>
            </article>
          )
        }

        if (row.kind === 'streaming-assistant') {
          return (
            <StreamingMessage
              content={streamingContent}
              thinking={streamingThinking}
              thinkingDurationMs={streamingThinkingDurationMs}
              toolCalls={streamingToolCalls}
              onOpenArtifact={onOpenArtifact}
            />
          )
        }

        const { pair } = row
        const versionCount = pair.assistants.length
        const versionIndex = clampVersionIdx(versionCount, versionIndexes[pair.pairKey])
        const assistantMessage = pair.assistants[versionIndex]
        const isPairRegenerating = isStreaming && regeneratingPairKey === pair.pairKey

        return (
          <>
            {pair.userMsg ? (
              <ChatMessage
                user={user}
                message={pair.userMsg}
                isStreaming={isStreaming}
                canRegenerate={false}
                timeFmt={timeFmt}
                dateFmt={dateFmt}
                onFeedback={onOpenFeedback}
                onOpenArtifact={onOpenArtifact}
                onRegenerate={() => undefined}
                onEditMessage={onEditMessage}
              />
            ) : null}
            {isPairRegenerating ? (
              <StreamingMessage
                content={streamingContent}
                thinking={streamingThinking}
                thinkingDurationMs={streamingThinkingDurationMs}
                toolCalls={streamingToolCalls}
                onOpenArtifact={onOpenArtifact}
              />
            ) : assistantMessage ? (
              <ChatMessage
                user={user}
                message={assistantMessage}
                isStreaming={isStreaming}
                canRegenerate={!isTemporaryConversation && pair.userMsg !== null}
                timeFmt={timeFmt}
                dateFmt={dateFmt}
                versionCount={versionCount}
                versionIndex={versionIndex}
                onFeedback={onOpenFeedback}
                onOpenArtifact={onOpenArtifact}
                onRegenerate={() => {
                  if (pair.userMsg) onRegenerateMessage(pair.userMsg.content, pair.pairKey)
                }}
                onEditMessage={onEditMessage}
                onVersionChange={(index) => onVersionChange(pair.pairKey, index)}
                {...(messageFeedback[assistantMessage.id]
                  ? { feedback: messageFeedback[assistantMessage.id] }
                  : {})}
              />
            ) : null}
          </>
        )
      }}
    />
  )
}
