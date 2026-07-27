import { FlashList, type FlashListProps } from '@shopify/flash-list'
import type { Message } from '@yuanai/types'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import { useKeyboardState } from 'react-native-keyboard-controller'

import { buildMessagePairs, clampVersionIdx } from '@yuanai/core/utils'
import { useChatStore } from '@yuanai/core/stores'

import { spacing } from '@/theme/tokens'

import { AIMessage } from './AIMessage'
import { AIMessageActions, type FeedbackType } from './AIMessageActions'
import { ScrollToBottomFab } from './ScrollToBottomFab'
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
  /** 各 pair 当前选中的回答版本下标（key = pairKey） */
  versionIdxs: Record<string, number>
  /** 正在「重新生成」的 pairKey：该 pair 内联渲染流式块，而不是在列表尾部追加 */
  regeneratingPairKey: string | null
  /** 正在内联编辑的用户消息 ID */
  editingMsgId: string | null
  /** 各 AI 消息的点赞/踩状态（key = 消息 ID） */
  msgFeedback: Record<string, FeedbackType>
  onVersionChange: (pairKey: string, idx: number) => void
  /** 重新生成：带上该轮的用户提问原文，直接重发一次 */
  onRegenerate: (pairKey: string, userContent: string) => void
  onFeedback: (msgId: string, type: FeedbackType) => void
  /** 用户气泡「编辑」图标 → 进入内联编辑 */
  onStartEdit: (msgId: string) => void
  onSubmitEdit: (msgId: string, nextText: string) => void
  onCancelEdit: () => void
}

/**
 * 展示条目 = 一个「气泡片段」。
 *
 * ⚠️ 一条 AI 回复不是一行，而是按行切成多行（见 CHUNK_LINES）：
 * recycler 无法处理「单个条目高度是视口好几倍」的情形——RLV 的内容总高度与条目
 * layout 会短暂不一致，按 layout 算出的滚动偏移超出它认知的内容范围时，渲染窗口
 * 落到数据之外导致**整屏空白且不自恢复**（真机复现：数到 150 必现，数到 60 不现）。
 * 拆成小条目后每项都小于视口，估算与滚动数学都回到正常区间，顺带只渲染可视块。
 *
 * 交互挂载点：用户气泡下方常驻图标行（复制/编辑）；AI 操作行是独立列表行（见
 * ActionsRow）；思考块挂 AI 首块。全部直点，无长按菜单/弹层（用户明确要求）。
 */
interface UserRow {
  role: 'user'
  /** 列表 key */
  id: string
  /** 真实消息 ID；`null` = 流式期间的乐观占位（不可编辑/长按） */
  msgId: string | null
  content: string
}

interface AIRow {
  role: 'assistant'
  /** `${消息ID}#${块序号}`，流式占位用固定前缀 */
  id: string
  /** 真实消息 ID；`null` = 流式占位 */
  msgId: string | null
  /** 所属 pair 的 key；`null` = 尾部流式占位（还没有归属的 pair） */
  pairKey: string | null
  /** 该轮的用户提问原文，供「重新生成」重发 */
  userContent: string
  content: string
  /** 该消息的首块（显示头像 + 思考块 + 上内边距） */
  isFirst: boolean
  /** 该消息的末块（下内边距；流式时承载光标） */
  isLast: boolean
  /** 与下一块的接缝在同一 markdown 块内部 → 吃掉收尾外边距（见 AIMessage） */
  seamlessBottom: boolean
  /** 流式中的末块 → 追加光标 */
  streaming: boolean
  /** 本块属于正在流式输出的那条消息 */
  streamingMsg: boolean
  thinkContent: string
  thinkDurationMs: number | undefined
}

/**
 * 操作条（版本切换/复制/重新生成/反馈）独立成行，**不挂在末块内**：
 * 挂在块内会让末块在思考块/操作条布局完成后长高，RLV 的内容总高度跟不上，
 * 贴底偏移越界 → 末块被顶出视口（docs-internal 第 9 条变体，真机已复现）。
 * 独立行高度固定且小，估算稳定。
 */
interface ActionsRow {
  role: 'actions'
  id: string
  msgId: string
  pairKey: string
  userContent: string
  /** 完整回复原文（复制用；块只有片段） */
  content: string
  versionCount: number
  versionIdx: number
}

type Row = UserRow | AIRow | ActionsRow

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

/**
 * 判断第 i 块与第 i+1 块的接缝是否在同一个 markdown 块内部。
 *
 * 规则：切缝两侧的行都非空 ⇒ 源文本里它们本是相邻的非空行（同一段落的续行，
 * 或紧凑列表的相邻项），块间不应有额外间距；任一侧是空行 ⇒ 真正的段落边界，
 * 保留正常的块间距。
 */
function isSeamInsideBlock(chunk: string, nextChunk: string | undefined): boolean {
  if (nextChunk === undefined) return false
  const lastLine = chunk.slice(chunk.lastIndexOf('\n') + 1)
  const nlIdx = nextChunk.indexOf('\n')
  const firstLine = nlIdx === -1 ? nextChunk : nextChunk.slice(0, nlIdx)
  return lastLine.trim() !== '' && firstLine.trim() !== ''
}

/** 一条 AI 消息展开成若干展示块所需的元信息（各块共享） */
interface AIExpandSpec {
  idPrefix: string
  msgId: string | null
  pairKey: string | null
  userContent: string
  content: string
  streamingMsg: boolean
  thinkContent: string
  thinkDurationMs: number | undefined
}

/** 把一条 AI 消息展开成若干展示块 */
function expandAI(spec: AIExpandSpec): AIRow[] {
  const chunks = splitChunks(spec.content)
  return chunks.map((c, i) => ({
    role: 'assistant' as const,
    id: `${spec.idPrefix}#${i}`,
    msgId: spec.msgId,
    pairKey: spec.pairKey,
    userContent: spec.userContent,
    content: c,
    isFirst: i === 0,
    isLast: i === chunks.length - 1,
    seamlessBottom: isSeamInsideBlock(c, chunks[i + 1]),
    streaming: spec.streamingMsg && i === chunks.length - 1,
    streamingMsg: spec.streamingMsg,
    thinkContent: spec.thinkContent,
    thinkDurationMs: spec.thinkDurationMs,
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
 * 数据源合成规则（`useMemo` 依赖：pairs / versionIdxs / regeneratingPairKey /
 * streamingConvId / optimisticUserMsg / streamingContent）：
 *  1. 消息先折叠成 pair（一问 + 多个答，见 `buildMessagePairs`），每 pair 渲染
 *     「用户气泡 + 当前选中版本的 AI 回复块」
 *  2. `regeneratingPairKey` 命中的 pair：AI 侧换成流式块（内联展示新版本）
 *  3. 若正在流式且不是重新生成：
 *     - 有 optimisticUserMsg → 末尾追加乐观用户气泡（后端持久化前的展示）
 *     - 追加流式 AI 块承载实时 token；streamingContent 为空也保留占位以显示光标
 *  4. finalizeStream 后：query 会自动 refetch 真实消息，占位随之下线
 *
 * ⚠️ 流式的**思考文字与工具调用不进 rows**（由 `StreamingThinkBlock` 自己订阅
 * store）：它们每 80ms 变一次，进了依赖会让整个 rows 重建 → memo 全失效 → ANR。
 *
 * 自动滚动 = 「跟随」模型（对齐 ChatGPT）：
 *  - 默认跟随：新行 / 流式内容增长都滚到底部（末块底部对齐视口底部）
 *  - 用户上滑离开底部（距底 > FOLLOW_RESUME_PX）→ 暂停跟随，不抢视口
 *  - 用户滑回底部附近 → 自动恢复跟随
 *  - 外部命令式 scrollToEnd（发送新消息）→ 强制恢复跟随
 *  - 内联编辑中 → 强制暂停跟随，否则贴底会把正在编辑的气泡顶出视口
 */
const FOLLOW_RESUME_PX = 100

export const MessageList = forwardRef<MessageListHandle, MessageListProps>(function MessageList(
  {
    convId,
    messages,
    versionIdxs,
    regeneratingPairKey,
    editingMsgId,
    msgFeedback,
    onVersionChange,
    onRegenerate,
    onFeedback,
    onStartEdit,
    onSubmitEdit,
    onCancelEdit,
  },
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
  // 「回到底部」FAB 的显隐；只在跨越阈值时翻转，避免每个滚动事件都 setState
  const [atBottom, setAtBottom] = useState(true)

  const scrollToTrueEnd = useCallback((animated: boolean) => {
    const list = listRef.current
    const lastIndex = rowCountRef.current - 1
    if (!list || lastIndex < 0) return
    userScrollingRef.current = false
    // viewPosition: 1 → 末块底部对齐视口底部。条目已按块拆小（见 Row 注释），
    // 偏移由该项真实 layout 推导且始终落在内容范围内，不会把渲染窗口推到数据之外。
    list.scrollToIndex({ index: lastIndex, animated, viewPosition: 1 })
  }, [])

  const resumeFollowAndScroll = useCallback(
    (animated: boolean) => {
      followRef.current = true
      scrollToTrueEnd(animated)
    },
    [scrollToTrueEnd]
  )

  useImperativeHandle(ref, () => ({
    scrollToEnd: (animated = true) => {
      resumeFollowAndScroll(animated)
    },
  }))

  const pairs = useMemo(() => buildMessagePairs(messages), [messages])

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    let regenRendered = false

    for (const pair of pairs) {
      const userContent = pair.userMsg?.content ?? ''
      if (pair.userMsg) {
        out.push({
          role: 'user',
          id: pair.userMsg.id,
          msgId: pair.userMsg.id,
          content: pair.userMsg.content,
        })
      }

      const isRegen = isStreaming && regeneratingPairKey === pair.pairKey
      if (isRegen) {
        // 重新生成中：在原位置渲染流式块（无操作条行——流式中不可交互）
        out.push(
          ...expandAI({
            idPrefix: `__regen__${pair.pairKey}`,
            msgId: null,
            pairKey: pair.pairKey,
            userContent,
            content: streamingContent,
            streamingMsg: true,
            thinkContent: '',
            thinkDurationMs: undefined,
          })
        )
        regenRendered = true
        continue
      }

      const versionIdx = clampVersionIdx(pair.assistants.length, versionIdxs[pair.pairKey])
      const asst = pair.assistants[versionIdx]
      if (!asst) continue
      out.push(
        ...expandAI({
          idPrefix: asst.id,
          msgId: asst.id,
          pairKey: pair.pairKey,
          userContent,
          content: asst.content,
          streamingMsg: false,
          thinkContent: asst.thinkingContent ?? '',
          thinkDurationMs: asst.thinkingDurationMs ?? undefined,
        })
      )
      out.push({
        role: 'actions',
        // key 只含 pairKey：版本切换时行身份不变，避免整行卸载重挂闪一下
        id: `__acts__${pair.pairKey}`,
        msgId: asst.id,
        pairKey: pair.pairKey,
        userContent,
        content: asst.content,
        versionCount: pair.assistants.length,
        versionIdx,
      })
    }

    if (isStreaming) {
      if (optimisticUserMsg !== null) {
        out.push({ role: 'user', id: '__opt_user__', msgId: null, content: optimisticUserMsg })
      }
      // 非重新生成场景在尾部追加流式块；regeneratingPairKey 指向的 pair 已消失时
      // 也走这里兜底，否则本轮输出会没有任何落点而整段看不见。
      if (!regenRendered) {
        out.push(
          ...expandAI({
            idPrefix: '__stream_ai__',
            msgId: null,
            pairKey: null,
            userContent: '',
            content: streamingContent,
            streamingMsg: true,
            thinkContent: '',
            thinkDurationMs: undefined,
          })
        )
      }
    }
    return out
  }, [pairs, versionIdxs, regeneratingPairKey, isStreaming, optimisticUserMsg, streamingContent])

  // 渲染期同步暴露最新行数给命令式滚动（scrollToIndex 需要目标下标）
  rowCountRef.current = rows.length

  // 内联编辑中强制暂停跟随：否则内容高度轮询/键盘重滚会把正在编辑的气泡顶出视口
  useEffect(() => {
    if (editingMsgId !== null) followRef.current = false
  }, [editingMsgId])

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
  // FAB 的显隐则不区分来源 —— 它反映的是「现在是否贴底」这一客观位置。
  const handleScrollBeginDrag = useCallback(() => {
    userScrollingRef.current = true
  }, [])
  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
    const distanceToBottom = contentSize.height - layoutMeasurement.height - contentOffset.y
    const nowAtBottom = distanceToBottom <= FOLLOW_RESUME_PX
    setAtBottom(nowAtBottom)
    if (!userScrollingRef.current) return
    followRef.current = nowAtBottom
  }, [])

  const renderItem = useCallback(
    ({ item }: { item: Row }): React.JSX.Element => {
      if (item.role === 'user') {
        const msgId = item.msgId
        // 乐观占位没有真实 ID，不给复制/编辑入口（后端还没落库，操作无处落）
        if (msgId === null) return <UserMessage content={item.content} />
        return (
          <UserMessage
            content={item.content}
            editing={editingMsgId === msgId}
            showActions
            onStartEdit={() => onStartEdit(msgId)}
            onSubmitEdit={(next) => onSubmitEdit(msgId, next)}
            onCancelEdit={onCancelEdit}
          />
        )
      }

      if (item.role === 'actions') {
        const { msgId, pairKey } = item
        return (
          <View style={styles.actionsRow}>
            <AIMessageActions
              content={item.content}
              versionCount={item.versionCount}
              versionIdx={item.versionIdx}
              feedback={msgFeedback[msgId]}
              busy={isStreaming}
              onVersionChange={(idx) => onVersionChange(pairKey, idx)}
              onRegenerate={() => onRegenerate(pairKey, item.userContent)}
              onFeedback={(type) => onFeedback(msgId, type)}
            />
          </View>
        )
      }

      return (
        <AIMessage
          content={item.content}
          streaming={item.streaming}
          streamingMsg={item.streamingMsg}
          isFirst={item.isFirst}
          isLast={item.isLast}
          seamlessBottom={item.seamlessBottom}
          thinkContent={item.thinkContent}
          thinkDurationMs={item.thinkDurationMs}
        />
      )
    },
    [
      editingMsgId,
      msgFeedback,
      isStreaming,
      onStartEdit,
      onSubmitEdit,
      onCancelEdit,
      onVersionChange,
      onRegenerate,
      onFeedback,
    ]
  )

  return (
    <View style={styles.container}>
      <TypedFlashList
        ref={listRef}
        data={rows}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        // FlashList v1 用 estimatedItemSize；条目已按块拆小，取一块的中位高度。
        // ⚠️ 不用 initialScrollIndex：首帧尚未量出真实高度，初始偏移会落进未布局
        // 区域白屏；进入贴底交给上面的高度轮询完成。
        estimatedItemSize={140}
        // 不同类型分池 recycle，切换 user↔ai 时不会拿到脏 layout。
        // 编辑态单独分池：编辑卡片与普通气泡结构差异大，复用会留下脏 layout。
        getItemType={(item) =>
          item.role === 'user' && item.msgId !== null && item.msgId === editingMsgId
            ? 'user-edit'
            : item.role
        }
        ListHeaderComponent={<View style={styles.pad} />}
        ListFooterComponent={<View style={styles.pad} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScrollBeginDrag={handleScrollBeginDrag}
        onScroll={handleScroll}
        scrollEventThrottle={64}
      />
      <ScrollToBottomFab
        visible={!atBottom}
        streaming={isStreaming}
        onPress={() => resumeFollowAndScroll(true)}
      />
    </View>
  )
})

const styles = StyleSheet.create({
  container: { flex: 1 },
  pad: { height: spacing.md },
  // 与 AIMessage 的正文左边缘对齐：行内边距 16 + 头像 28 + gap 8
  actionsRow: { paddingLeft: spacing.lg + 28 + spacing.sm, paddingRight: spacing.lg },
})
