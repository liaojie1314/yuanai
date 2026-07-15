import { FlashList, type FlashListProps } from '@shopify/flash-list'
import type { Message } from '@yuanai/types'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { useKeyboardState } from 'react-native-keyboard-controller'

import { useChatStore } from '@yuanai/core/stores'

import { spacing } from '@/theme/tokens'

import { AIMessage } from './AIMessage'
import { UserMessage } from './UserMessage'

/**
 * MessageList 对外句柄：命令式滚到底部（发送后 / 键盘弹起时用得上）。
 */
export interface MessageListHandle {
  scrollToEnd: (animated?: boolean) => void
}

interface MessageListProps {
  convId: string
  messages: readonly Message[]
}

/**
 * 展示条目：真实消息或流式占位。
 *
 * 用 discriminated union 让 renderItem 里无需再次 role 判断，减少 FlashList 类型分歧
 * 触发 re-render（不同 item 类型走各自 recycler 池，能命中 cell reuse）。
 */
type Row =
  | { kind: 'msg'; id: string; role: 'user' | 'assistant'; content: string }
  | { kind: 'streaming-user'; id: '__opt_user__'; content: string }
  | { kind: 'streaming-ai'; id: '__stream_ai__'; content: string }

// FlashList v1.7 的 class 类型与当前 @types/react 组合下 JSX 断言失败
// （跨 workspace React 18/19 hoist 引起的 Component<any,any,any> 位缺失）。
// 用一层泛型函数签名 shim 承接，运行时行为不变。
type FlashListComponent<T> = (
  props: FlashListProps<T> & { ref?: React.Ref<FlashList<T>> }
) => React.JSX.Element
const TypedFlashList = FlashList as unknown as FlashListComponent<Row>

/**
 * FlashList 承载消息列表 + 流式追加。
 *
 * 数据源合成规则（`useMemo` 依赖：messages / streamingConvId / optimisticUserMsg /
 * streamingContent）：
 *  1. 真实消息按顺序渲染
 *  2. 若正在流式（streamingConvId === convId）：
 *     - 有 optimisticUserMsg → 末尾追加 streaming-user 行（后端持久化前的乐观展示）
 *     - 追加 streaming-ai 行承载实时 token；streamingContent 为空也保留占位以显示光标
 *  3. finalizeStream 后：query 会自动 refetch 真实消息，两条占位随之下线
 *
 * 自动滚动：消息数变化 / 流式内容长度变化 时 scrollToEnd。streaming-ai 长度 tick
 * 到 20 才滚一次（避免每 token 都触发 layout）。
 */
export const MessageList = forwardRef<MessageListHandle, MessageListProps>(function MessageList(
  { convId, messages },
  ref
) {
  const streamingConvId = useChatStore((s) => s.streamingConvId)
  const streamingContent = useChatStore((s) => s.streamingContent)
  const optimisticUserMsg = useChatStore((s) => s.optimisticUserMsg)
  const isStreaming = streamingConvId === convId
  // 键盘弹起时列表视口收缩，原本贴底的内容会被推到视口下方看不见 —— 监听
  // 键盘可见性，弹起瞬间重新滚到底，保证最新消息始终可见（配合 KeyboardAvoidingView）。
  const keyboardVisible = useKeyboardState((s) => s.isVisible)

  const listRef = useRef<FlashList<Row> | null>(null)
  useImperativeHandle(ref, () => ({
    scrollToEnd: (animated = true) => {
      listRef.current?.scrollToEnd?.({ animated })
    },
  }))

  const rows = useMemo<Row[]>(() => {
    const base: Row[] = messages.map((m) => ({
      kind: 'msg',
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))
    if (isStreaming) {
      if (optimisticUserMsg) {
        base.push({ kind: 'streaming-user', id: '__opt_user__', content: optimisticUserMsg })
      }
      base.push({ kind: 'streaming-ai', id: '__stream_ai__', content: streamingContent })
    }
    return base
  }, [messages, isStreaming, optimisticUserMsg, streamingContent])

  // 自动滚到底：
  //  - 行数变化（真实消息到达 / 乐观用户消息 / 流式 AI 占位加入）→ 立即滚
  //    ⚠️ 用 rows.length 而非 messages.length：乐观用户消息与流式占位不在 messages
  //    数组里，只反映在合成后的 rows 上；发送瞬间就是靠这里把新气泡带进视口的。
  //  - 流式内容每 ~20 字符滚一次（避免每 token 都触发 layout）
  const lastRowCount = useRef(rows.length)
  const lastStreamTick = useRef(0)
  useEffect(() => {
    if (rows.length !== lastRowCount.current) {
      lastRowCount.current = rows.length
      requestAnimationFrame(() => listRef.current?.scrollToEnd?.({ animated: true }))
    }
  }, [rows.length])
  useEffect(() => {
    if (!isStreaming) return
    const tick = Math.floor(streamingContent.length / 20)
    if (tick !== lastStreamTick.current) {
      lastStreamTick.current = tick
      requestAnimationFrame(() => listRef.current?.scrollToEnd?.({ animated: false }))
    }
  }, [streamingContent, isStreaming])
  // 键盘弹起 → 重新贴底（延迟一帧等 KAV 完成收缩再滚，位置才准）
  useEffect(() => {
    if (!keyboardVisible) return
    const t = setTimeout(() => listRef.current?.scrollToEnd?.({ animated: true }), 50)
    return () => clearTimeout(t)
  }, [keyboardVisible])

  return (
    <TypedFlashList
      ref={listRef}
      data={rows}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => {
        if (item.kind === 'msg') {
          return item.role === 'user' ? (
            <UserMessage content={item.content} />
          ) : (
            <AIMessage content={item.content} />
          )
        }
        if (item.kind === 'streaming-user') return <UserMessage content={item.content} />
        return <AIMessage content={item.content} streaming />
      }}
      // FlashList v1 用 estimatedItemSize；不同 role 大小差异大，取中位偏保守
      estimatedItemSize={80}
      // 不同类型分池 recycle，切换 user↔ai 时不会拿到脏 layout
      getItemType={(item) =>
        item.kind === 'msg' ? item.role : item.kind === 'streaming-user' ? 'user' : 'assistant'
      }
      ListHeaderComponent={<View style={styles.pad} />}
      ListFooterComponent={<View style={styles.pad} />}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    />
  )
})

const styles = StyleSheet.create({
  pad: { height: spacing.md },
})
