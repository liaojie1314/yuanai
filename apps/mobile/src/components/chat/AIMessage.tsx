import Markdown, { type ASTNode } from 'react-native-markdown-display'
import { StyleSheet, Text, View } from 'react-native'

import { brand, radius, spacing, text } from '@/theme/tokens'

import { CodeBlock } from './CodeBlock'

interface AIMessageProps {
  content: string
  /** 流式中：末尾追加闪烁光标 */
  streaming?: boolean
}

/**
 * AI 回复：左对齐 + AI 头像徽章 + Markdown 渲染。
 *
 * - `react-native-markdown-display` 已内置 GFM + 表格 + 引用等
 * - 覆盖 `fence` (```lang) 与 `code_block` (4-space indent) 两个规则为自定义 CodeBlock
 * - 流式态：末尾追加光标（用 `▊` + 静态展示；MVP 不做动画避免与 markdown 排版冲突）
 * - 内联 code (`x`) 用默认样式，但改成品牌浅背景以对齐 web 版气泡
 *
 * 头像放在气泡外侧顶部，与 web AIMessage 一致；不用 SVG 以省一个包。
 */
export function AIMessage({ content, streaming = false }: AIMessageProps): React.JSX.Element {
  const display = streaming ? `${content}▊` : content

  return (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>元</Text>
      </View>
      <View style={styles.bubbleWrap}>
        <Markdown
          style={mdStyles}
          rules={{
            fence: (node: ASTNode) => {
              // markdown-it 把 ```lang 的 info string 塞到 sourceInfo
              const info = (node as unknown as { sourceInfo?: string }).sourceInfo ?? ''
              const lang = info.trim().split(/\s+/)[0] || undefined
              return <CodeBlock key={node.key} code={node.content} language={lang} />
            },
            code_block: (node: ASTNode) => (
              <CodeBlock key={node.key} code={node.content} language="text" />
            ),
          }}
        >
          {display}
        </Markdown>
      </View>
    </View>
  )
}

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
