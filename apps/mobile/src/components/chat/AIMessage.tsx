import Markdown, { type ASTNode } from 'react-native-markdown-display'
import { memo, useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { brand, radius, spacing, text } from '@/theme/tokens'

import { CodeBlock } from './CodeBlock'

interface AIMessageProps {
  content: string
  /** 流式中：末尾追加闪烁光标 */
  streaming?: boolean
}

/**
 * 长消息分块渲染的块大小（行数）。
 *
 * markdown-it 每次渲染都要 parse 全文并重建全部 RN 节点——单条上千行的消息
 * （如让 AI 数数）流式中每次增量都全量 parse，JS 线程直接被打满（真机 ANR）。
 * 按行切块 + 块级 memo 后：历史块引用不变直接命中缓存，流式中只有最后一块
 * 重新 parse，渲染成本从 O(全文) 降到 O(块)。
 */
const CHUNK_LINES = 24

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

const mdRules = {
  fence: (node: ASTNode) => {
    // markdown-it 把 ```lang 的 info string 塞到 sourceInfo
    const info = (node as unknown as { sourceInfo?: string }).sourceInfo ?? ''
    const lang = info.trim().split(/\s+/)[0] || undefined
    return <CodeBlock key={node.key} code={node.content} language={lang} />
  },
  code_block: (node: ASTNode) => <CodeBlock key={node.key} code={node.content} language="text" />,
}

/** 单块 markdown：md 文本不变时彻底跳过 parse + reconcile */
const MarkdownChunk = memo(function MarkdownChunk({ md }: { md: string }): React.JSX.Element {
  return (
    <Markdown style={mdStyles} rules={mdRules}>
      {md}
    </Markdown>
  )
})

/**
 * AI 回复：左对齐 + AI 头像徽章 + Markdown 渲染。
 *
 * - `react-native-markdown-display` 已内置 GFM + 表格 + 引用等
 * - 覆盖 `fence` (```lang) 与 `code_block` (4-space indent) 两个规则为自定义 CodeBlock
 * - 流式态：末尾追加光标（用 `▊` + 静态展示；MVP 不做动画避免与 markdown 排版冲突）
 * - 长文按行分块渲染（见 CHUNK_LINES），整组件再套 memo 挡掉列表 recycle 重渲染
 *
 * 头像放在气泡外侧顶部，与 web AIMessage 一致；不用 SVG 以省一个包。
 */
export const AIMessage = memo(function AIMessage({
  content,
  streaming = false,
}: AIMessageProps): React.JSX.Element {
  const display = streaming ? `${content}▊` : content
  const chunks = useMemo(() => splitChunks(display), [display])

  return (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>元</Text>
      </View>
      <View style={styles.bubbleWrap}>
        {chunks.map((c, i) => (
          // index key 即可：只有最后一块内容会变化，前面块 md 相同 → memo 命中
          <MarkdownChunk key={i} md={c} />
        ))}
      </View>
    </View>
  )
})

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
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
  avatarText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  bubbleWrap: {
    flex: 1,
    maxWidth: '86%',
  },
})

// Markdown 全局样式（覆盖 react-native-markdown-display 默认值以对齐主题）。
// 只列出正文常用节点；其他节点走库默认样式，避免维护成本。
const mdStyles = {
  body: {
    color: text.primary,
    fontSize: 15,
    lineHeight: 22,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: spacing.sm,
  },
  heading1: { fontSize: 22, fontWeight: '700' as const, marginBottom: spacing.sm },
  heading2: { fontSize: 19, fontWeight: '700' as const, marginBottom: spacing.sm },
  heading3: { fontSize: 17, fontWeight: '600' as const, marginBottom: spacing.xs },
  link: { color: brand.solid, textDecorationLine: 'underline' as const },
  code_inline: {
    backgroundColor: brand.light,
    color: brand.hover,
    fontFamily: 'monospace',
    fontSize: 13,
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
    backgroundColor: text.muted,
    marginVertical: spacing.md,
  },
}
