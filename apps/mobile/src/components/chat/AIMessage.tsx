import Markdown, { type ASTNode } from 'react-native-markdown-display'
import { memo, useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { brand, radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'

import { CodeBlock } from './CodeBlock'
import { StreamingThinkBlock, ThinkBlock } from './ThinkBlock'

interface AIMessageProps {
  content: string
  /** 流式中：末尾追加闪烁光标 */
  streaming?: boolean
  /** 该消息的首块：显示头像 + 上内边距（非首块用等宽占位保持文本对齐） */
  isFirst?: boolean
  /** 该消息的末块：下内边距 */
  isLast?: boolean
  /**
   * 与下一块的接缝在同一个 markdown 块内部（长列表/长段落被拦腰切开）：
   * 用负 marginBottom 吃掉本块最后一个 block 的尾部外边距，跨块行距与块内一致。
   * 若不吃掉，每个切块边界会多出一份 block margin，渲染成一条谜之空行。
   */
  seamlessBottom?: boolean
  /** 本块属于正在流式输出的那条消息（思考块改读 store） */
  streamingMsg?: boolean
  /** 历史消息的思考原文（流式态不用，改由 StreamingThinkBlock 订阅 store） */
  thinkContent?: string
  /** 历史消息的思考耗时（毫秒） */
  thinkDurationMs?: number | undefined
  /**
   * 字号/密度快照。MessageList 透传以便 memo 在偏好变化时失效；
   * 组件内仍读 useTheme()，本字段只作比较键。
   */
  prefsKey?: string
}

const mdRules = {
  fence: (node: ASTNode) => {
    // markdown-it 把 ```lang 的 info string 塞到 sourceInfo
    const info = (node as unknown as { sourceInfo?: string }).sourceInfo ?? ''
    const lang = info.trim().split(/\s+/)[0] || undefined
    return <CodeBlock key={node.key} code={node.content} language={lang} />
  },
  code_block: (node: ASTNode) => <CodeBlock key={node.key} code={node.content} language="text" />,
}

/**
 * AI 回复的一个展示块（一条长回复由 MessageList 切成多块，每块一个列表项）。
 *
 * - `react-native-markdown-display` 已内置 GFM + 表格 + 引用等
 * - 覆盖 `fence` (```lang) 与 `code_block` (4-space indent) 两个规则为自定义 CodeBlock
 * - 流式态：末块尾部追加光标（用 `▊` + 静态展示；MVP 不做动画避免与 markdown 排版冲突）
 * - memo：流式期间列表高频重渲染，历史块 props 不变直接跳过（只有末块重新 parse）
 *
 * 块级职责划分：
 * - **首块**：头像 + 思考块 / 工具调用（属于整条消息的元信息）
 * - 操作行（版本切换 / 复制 / 重新生成 / 点赞踩）**不在本组件里**——它是 MessageList
 *   的独立列表行。挂在末块内会让末块在布局后长高，RLV 的内容总高度跟不上，
 *   贴底偏移再次越界（docs-internal 第 9 条的变体，真机已复现：末块被顶出视口）。
 *   交互一律直点操作行图标，无长按菜单（用户明确要求）。
 *
 * ⚠️ props 全部是**扁平的数据 + 回调**，不要收成对象再传：列表 `renderItem` 每次渲染
 * 都会新建对象/箭头函数，套一层对象会让下面的 memo 比较必然失败 →
 * 回到「每个 token 全量重渲」的 ANR 老路（docs-internal 第 8 条）。
 *
 * 头像放在气泡外侧顶部，与 web AIMessage 一致；不用 SVG 以省一个包。
 */
function AIMessageBase({
  content,
  streaming = false,
  isFirst = true,
  isLast = true,
  seamlessBottom = false,
  streamingMsg = false,
  thinkContent = '',
  thinkDurationMs,
  prefsKey: _prefsKey,
}: AIMessageProps): React.JSX.Element {
  const t = useTheme()
  const display = streaming ? `${content}▊` : content

  // Markdown 样式随主题 / 字号变化
  const mdStyles = useMemo(
    () => ({
      body: {
        color: t.text.primary,
        fontSize: t.typography.body,
        lineHeight: t.typography.bodyLineHeight,
      },
      paragraph: {
        marginTop: 0,
        marginBottom: spacing.sm,
      },
      heading1: {
        fontSize: t.typography.h1,
        fontWeight: '700' as const,
        marginBottom: spacing.sm,
      },
      heading2: {
        fontSize: t.typography.h2,
        fontWeight: '700' as const,
        marginBottom: spacing.sm,
      },
      heading3: {
        fontSize: t.typography.h3,
        fontWeight: '600' as const,
        marginBottom: spacing.xs,
      },
      link: { color: brand.solid, textDecorationLine: 'underline' as const },
      code_inline: {
        backgroundColor: brand.light,
        color: brand.hover,
        fontFamily: 'monospace',
        fontSize: t.typography.code,
        paddingHorizontal: 4,
        paddingVertical: 1,
        borderRadius: radius.sm,
      },
      bullet_list: { marginBottom: spacing.sm },
      ordered_list: { marginBottom: spacing.sm },
      blockquote: {
        backgroundColor: brand.light,
        borderLeftWidth: 3,
        borderLeftColor: brand.solid,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        marginBottom: spacing.sm,
      },
      hr: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: t.text.muted,
        marginVertical: spacing.md,
      },
    }),
    [t]
  )

  const rowPad = {
    paddingTop: isFirst ? t.density.messagePy : 0,
    paddingBottom: isLast ? t.density.messagePy : 0,
  }

  return (
    <View style={[styles.row, rowPad]}>
      {isFirst ? (
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>元</Text>
        </View>
      ) : (
        // 非首块：等宽占位，保证多块文本左边缘对齐
        <View style={styles.avatarPlaceholder} />
      )}
      <View style={[styles.bubbleWrap, seamlessBottom && styles.bubbleSeamless]}>
        {isFirst && streamingMsg ? <StreamingThinkBlock /> : null}
        {isFirst && !streamingMsg && thinkContent ? (
          <ThinkBlock content={thinkContent} durationMs={thinkDurationMs} />
        ) : null}
        {display ? (
          <Markdown style={mdStyles} rules={mdRules}>
            {display}
          </Markdown>
        ) : null}
      </View>
    </View>
  )
}

/**
 * 自定义比较：`renderItem` 每次渲染都会为每行新建箭头函数回调，回调身份变化本身
 * 不代表内容变化，所以只比较数据类 props（与 web `AIMessage` 的 memo 同策略）。
 */
export const AIMessage = memo(
  AIMessageBase,
  (prev, next) =>
    prev.content === next.content &&
    prev.streaming === next.streaming &&
    prev.isFirst === next.isFirst &&
    prev.isLast === next.isLast &&
    prev.seamlessBottom === next.seamlessBottom &&
    prev.streamingMsg === next.streamingMsg &&
    prev.thinkContent === next.thinkContent &&
    prev.thinkDurationMs === next.thinkDurationMs &&
    prev.prefsKey === next.prefsKey
)

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: brand.solid,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  avatarPlaceholder: { width: 28 },
  avatarText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  bubbleWrap: {
    flex: 1,
    maxWidth: '86%',
  },
  // 吃掉块内最后一个 markdown block 的尾部外边距（paragraph/list 均为 spacing.sm），
  // 让被拦腰切开的段落/列表跨块行距与块内一致（否则每个切缝多一条 8px 空带）。
  bubbleSeamless: { marginBottom: -spacing.sm },
})

// Markdown 全局样式已移入 AIMessageBase 的 useMemo（随主题变化）
