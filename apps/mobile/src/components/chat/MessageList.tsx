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
 * 展示条目 = 一个「气泡片段」。
 *
 * ⚠️ 一条 AI 回复不是一行，而是按行切成多行（见 CHUNK_LINES）：
 * recycler 无法处理「单个条目高度是视口好几倍」的情形——RLV 的内容总高度与条目
 * layout 会短暂不一致，按 layout 算出的滚动偏移超出它认知的内容范围时，渲染窗口
 * 落到数据之外导致**整屏空白且不自恢复**（真机复现：数到 150 必现，数到 60 不现）。
 * 拆成小条目后每项都小于视口，估算与滚动数学都回到正常区间，顺带只渲染可视块。
 */
interface Row {
  /** `${消息ID}#${块序号}`，流式占位用固定前缀 */
  id: string
  role: 'user' | 'assistant'
  content: string
  /** 该消息的首块（显示头像 + 上内边距） */
  isFirst: boolean
  /** 该消息的末块（下内边距；流式时承载光标） */
  isLast: boolean
  /** 流式中的末块 → 追加光标 */
  streaming: boolean
}

/** AI 消息按行切块的块大小；块高需明显小于视口高度 */
const CHUNK_LINES = 12

/** 按行切块；``` 围栏内不切，避免把代码块拦腰截断破坏 markdown 结构 */
function splitChunks(md: string): string[] {
  const lines = md.split('\n')
  if (lines.length <= CHUNK_LINES) return [md]
  const chunks: string[] = []
  let buf: string[] = []
  let inFence = false
  for (const line of lines) {
    buf.push(line)
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    if (!inFence && buf.length >= CHUNK_LINES) {
      chunks.push(buf.join('\n'))
      buf = []
    }
  }
  if (buf.length) chunks.push(buf.join('\n'))
  return chunks
}

/** 把一条消息展开成若干展示行 */
function expand(
  idPrefix: string,
  role: 'user' | 'assistant',
  content: string,
  streaming: boolean
): Row[] {
  // 用户消息不做 markdown、长度有限（4000 字），单行即可
  if (role === 'user') {
    return [{ id: idPrefix, role, content, isFirst: true, isLast: true, streaming: false }]
  }
  const chunks = splitChunks(content)
  return chunks.map((c, i) => ({
    id: `${idPrefix}#${i}`,
    role,
    content: c,
    isFirst: i === 0,
    isLast: i === chunks.length - 1,
    streaming: streaming && i === chunks.length - 1,
  }))
}

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
 *  - 默认跟随：新行 / 流式内容增长都滚到底部（末块底部对齐视口底部）
 *  - 用户上滑离开底部（距底 > FOLLOW_RESUME_PX）→ 暂停跟随，不抢视口
 *  - 用户滑回底部附近 → 自动恢复跟随
 *  - 外部命令式 scrollToEnd（发送新消息）→ 强制恢复跟随
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
  // 最新行数（渲染期同步写入），供命令式滚动读取，避免 useCallback 闭包读到旧值
  const rowCountRef = useRef(0)

  const scrollToTrueEnd = useCallback((animated: boolean) => {
    const list = listRef.current
    const lastIndex = rowCountRef.current - 1
    if (!list || lastIndex < 0) return
    userScrollingRef.current = false
    // viewPosition: 1 → 末块底部对齐视口底部。条目已按块拆小（见 Row 注释），
    // 偏移由该项真实 layout 推导且始终落在内容范围内，不会把渲染窗口推到数据之外。
    list.scrollToIndex({ index: lastIndex, animated, viewPosition: 1 })
  }, [])

  useImperativeHandle(ref, () => ({
    scrollToEnd: (animated = true) => {
      followRef.current = true
      scrollToTrueEnd(animated)
    },
  }))

  const rows = useMemo<Row[]>(() => {
    const base: Row[] = []
    for (const m of messages) {
      base.push(...expand(m.id, m.role as 'user' | 'assistant', m.content, false))
    }
    if (isStreaming) {
      if (optimisticUserMsg) {
        base.push(...expand('__opt_user__', 'user', optimisticUserMsg, false))
      }
      // streamingContent 为空也保留占位块以显示光标
      base.push(...expand('__stream_ai__', 'assistant', streamingContent, true))
    }
    return base
  }, [messages, isStreaming, optimisticUserMsg, streamingContent])

  // 渲染期同步暴露最新行数给命令式滚动（scrollToIndex 需要目标下标）
  rowCountRef.current = rows.length

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
      renderItem={({ item }) =>
        item.role === 'user' ? (
          <UserMessage content={item.content} />
        ) : (
          <AIMessage
            content={item.content}
            streaming={item.streaming}
            isFirst={item.isFirst}
            isLast={item.isLast}
          />
        )
      }
      // FlashList v1 用 estimatedItemSize；条目已按块拆小，取一块的中位高度。
      // ⚠️ 不用 initialScrollIndex：首帧尚未量出真实高度，初始偏移会落进未布局
      // 区域白屏；进入贴底交给上面的高度轮询完成。
      estimatedItemSize={140}
      // 不同类型分池 recycle，切换 user↔ai 时不会拿到脏 layout
      getItemType={(item) => item.role}
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
