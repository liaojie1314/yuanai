import { FlashList, type FlashListProps } from '@shopify/flash-list'
import type { Message } from '@yuanai/types'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
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
 * 自动滚动 = 「跟随」模型（对齐 ChatGPT）：
 *  - 默认跟随：新行 / 流式内容增长都滚到**真实底部**
 *  - 用户上滑离开底部（距底 > FOLLOW_RESUME_PX）→ 暂停跟随，不抢视口
 *  - 用户滑回底部附近 → 自动恢复跟随
 *  - 外部命令式 scrollToEnd（发送新消息）→ 强制恢复跟随
 *
 * ⚠️ 不能用 FlashList.scrollToEnd：底层是 RecyclerListView.scrollToIndex(最后一项)，
 * 语义是「滚到最后一项的顶部」。流式回复是一个持续长高的超长条目，滚到它顶部
 * 意味着永远看不到底部新增内容。这里改用 rlv 的内容总高度手动算真实底部偏移。
 */
const FOLLOW_RESUME_PX = 100

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
  // 是否处于「跟随底部」状态；只在滚动事件里读写，不触发 re-render
  const followRef = useRef(true)
  // 当前滚动是否由用户手势发起。程序化 scrollTo（尤其 animated）的中间帧距底
  // 可能 > 阈值，若也参与判定会把跟随态误判成「用户上滑」——只有手势能改 follow。
  const userScrollingRef = useRef(false)

  const scrollToTrueEnd = useCallback((animated: boolean) => {
    const list = listRef.current
    if (!list) return
    userScrollingRef.current = false
    const rlv = list.recyclerlistview_unsafe
    if (rlv) {
      const offset = Math.max(0, rlv.getContentDimension().height - rlv.getRenderedSize().height)
      list.scrollToOffset({ offset, animated })
    } else {
      list.scrollToEnd({ animated })
    }
  }, [])

  useImperativeHandle(ref, () => ({
    scrollToEnd: (animated = true) => {
      followRef.current = true
      scrollToTrueEnd(animated)
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

  // 进入会话即落底（用户预期看到最新消息），并在跟随态下持续贴底。
  // RecyclerListView 的内容总高度是渐进量出来的：长消息分块挂载、文本异步排版，
  // 高度会在挂载后数秒内持续增长，固定次数的延迟重滚赶不上 —— 这里用低频轮询
  // 监测内容高度，跟随态下发现变高就重新贴底（250ms 一次的原生只读调用，开销可忽略）。
  useEffect(() => {
    followRef.current = true
    const raf = requestAnimationFrame(() => scrollToTrueEnd(false))
    let lastHeight = 0
    const timer = setInterval(() => {
      if (!followRef.current) return
      const rlv = listRef.current?.recyclerlistview_unsafe
      if (!rlv) return
      const h = rlv.getContentDimension().height
      if (h !== lastHeight) {
        lastHeight = h
        scrollToTrueEnd(false)
      }
    }, 250)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(timer)
    }
  }, [convId, scrollToTrueEnd])

  // 自动滚到底（仅在跟随态下）：
  //  - 行数变化（真实消息到达 / 乐观用户消息 / 流式 AI 占位加入）→ 立即滚
  //    ⚠️ 用 rows.length 而非 messages.length：乐观用户消息与流式占位不在 messages
  //    数组里，只反映在合成后的 rows 上；发送瞬间就是靠这里把新气泡带进视口的。
  //  - 流式内容每 ~20 字符滚一次（避免每 token 都触发 layout）
  const lastRowCount = useRef(rows.length)
  const lastStreamTick = useRef(0)
  useEffect(() => {
    if (rows.length !== lastRowCount.current) {
      lastRowCount.current = rows.length
      if (!followRef.current) return
      requestAnimationFrame(() => scrollToTrueEnd(true))
    }
  }, [rows.length, scrollToTrueEnd])
  useEffect(() => {
    if (!isStreaming) return
    const tick = Math.floor(streamingContent.length / 20)
    if (tick !== lastStreamTick.current) {
      lastStreamTick.current = tick
      if (!followRef.current) return
      requestAnimationFrame(() => scrollToTrueEnd(false))
    }
  }, [streamingContent, isStreaming, scrollToTrueEnd])
  // 键盘弹起 → 重新贴底。KAV 的收缩动画约 250-300ms，单次 50ms 延迟会在
  // 动画中途取到过期的视口高度（表现为键盘盖住底部回复）；分多个时点重滚，
  // 覆盖不同机型的动画时长。
  useEffect(() => {
    if (!keyboardVisible || !followRef.current) return
    const timers = [80, 250, 500].map((ms) =>
      setTimeout(() => {
        if (followRef.current) scrollToTrueEnd(false)
      }, ms)
    )
    return () => {
      timers.forEach(clearTimeout)
    }
  }, [keyboardVisible, scrollToTrueEnd])

  // 跟随态维护：仅用户手势期间（拖拽 + 松手后的惯性）实时判断距底距离。
  // onScrollBeginDrag 标记手势开始；程序化滚动在 scrollToTrueEnd 里复位标记，
  // 其滚动帧不参与判定。
  const handleScrollBeginDrag = useCallback(() => {
    userScrollingRef.current = true
  }, [])
  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!userScrollingRef.current) return
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
    const distanceToBottom = contentSize.height - layoutMeasurement.height - contentOffset.y
    followRef.current = distanceToBottom <= FOLLOW_RESUME_PX
  }, [])

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
      // FlashList v1 用 estimatedItemSize；不同 role 大小差异大，取中位偏保守。
      // ⚠️ 不用 initialScrollIndex：超长消息实际高度与估值差几个数量级，RLV 初始
      // 偏移会落进未布局区域直接白屏；进入贴底交给上面的高度轮询完成。
      estimatedItemSize={80}
      // 不同类型分池 recycle，切换 user↔ai 时不会拿到脏 layout
      getItemType={(item) =>
        item.kind === 'msg' ? item.role : item.kind === 'streaming-user' ? 'user' : 'assistant'
      }
      ListHeaderComponent={<View style={styles.pad} />}
      ListFooterComponent={<View style={styles.pad} />}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      onScrollBeginDrag={handleScrollBeginDrag}
      onScroll={handleScroll}
      scrollEventThrottle={64}
    />
  )
})

const styles = StyleSheet.create({
  pad: { height: spacing.md },
})
