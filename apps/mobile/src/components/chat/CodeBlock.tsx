import * as Clipboard from 'expo-clipboard'
import { Check, Copy, ExternalLink } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { useArtifactStore } from '@yuanai/core/stores'

import { border, radius, spacing, text } from '@/theme/tokens'

interface CodeBlockProps {
  code: string
  language?: string | undefined
}

/**
 * 代码块（MVP 版）：monospace + 中性底 + 语言标签 + 复制 / 面板查看 按钮。
 *
 * MVP 决定不上 react-native-syntax-highlighter：
 * - MVP 目标是"能读"，语法高亮属于视觉锦上添花
 * - RN 版 syntax-highlighter 会把每个 token 渲染成独立 `<Text>`，大代码块性能骤降
 *   Step 7 收尾时再评估是否引入并做 memo/懒渲染
 *
 * 长代码用水平 ScrollView 承载，避免自动换行破坏缩进结构。
 * "面板查看"按钮 → `useArtifactStore.openView(...)` → ArtifactSurface Modal 打开。
 */
export function CodeBlock({ code, language }: CodeBlockProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const openView = useArtifactStore((s) => s.openView)
  const displayLang = language || 'text'

  const onCopy = async (): Promise<void> => {
    await Clipboard.setStringAsync(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const onOpenPanel = (): void => {
    openView({ title: displayLang, lang: displayLang, code })
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.lang}>{displayLang}</Text>
        <View style={styles.actions}>
          <Pressable
            onPress={() => {
              void onCopy()
            }}
            hitSlop={6}
            style={styles.actBtn}
            accessibilityLabel="复制代码"
          >
            {copied ? (
              <Check size={13} color={text.secondary} />
            ) : (
              <Copy size={13} color={text.secondary} />
            )}
            <Text style={styles.actLabel}>{copied ? '已复制' : '复制'}</Text>
          </Pressable>
          <Pressable
            onPress={onOpenPanel}
            hitSlop={6}
            style={styles.actBtn}
            accessibilityLabel="在面板中查看"
          >
            <ExternalLink size={13} color={text.secondary} />
            <Text style={styles.actLabel}>面板</Text>
          </Pressable>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.codeScroll}>
        <Text selectable style={styles.code}>
          {code}
        </Text>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: border.default,
    backgroundColor: '#F7F7F5',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    backgroundColor: '#EFEEEA',
  },
  lang: {
    fontSize: 11,
    color: text.secondary,
    fontFamily: 'monospace',
    textTransform: 'lowercase',
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  actLabel: { fontSize: 11, color: text.secondary },
  codeScroll: { padding: spacing.md },
  code: {
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 19,
    color: text.primary,
  },
})
