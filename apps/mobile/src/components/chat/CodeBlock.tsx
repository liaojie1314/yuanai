import * as Clipboard from 'expo-clipboard'
import { Check, Copy, ExternalLink } from 'lucide-react-native'
import { memo, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
// RN 桥接层：把 react-syntax-highlighter 的 vdom 转成原生 <Text> token 树
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SyntaxHighlighter = require('react-native-syntax-highlighter')
  .default as React.ComponentType<{
  language?: string
  style?: Record<string, React.CSSProperties | object>
  customStyle?: object
  fontSize?: number
  fontFamily?: string
  highlighter?: 'hljs' | 'prism'
  PreTag?: React.ComponentType<{ style?: object; children?: React.ReactNode }>
  CodeTag?: React.ComponentType<{ style?: object; children?: React.ReactNode }>
  children: string
}>
// hljs atom-one 主题（与 plan 的 atom-one-light / atom-one-dark 一致）
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { atomOneDark, atomOneLight } = require('react-syntax-highlighter/styles/hljs') as {
  atomOneDark: Record<string, object>
  atomOneLight: Record<string, object>
}

import { useArtifactStore } from '@yuanai/core/stores'

import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'

import { normalizeHighlightLang } from './codeLang'

interface CodeBlockProps {
  code: string
  language?: string | undefined
}

interface CodeBlockInnerProps extends CodeBlockProps {
  colorScheme: 'light' | 'dark'
  codeFontSize: number
}

/** 超过该行数降级纯文本，避免每 token 一个 <Text> 导致长块卡顿 / ANR */
const HIGHLIGHT_MAX_LINES = 50

/**
 * 代码块：语言标签 + 复制 / 面板 + 语法高亮（短块）或纯文本（长块）。
 *
 * 高亮引擎：react-native-syntax-highlighter（hljs vdom → RN Text）。
 * 长代码块（>50 行）降级纯 Text，规避 token 爆炸。
 * 外层订阅 useTheme，把 colorScheme/字号透传给 memo 内层，保证主题切换时重渲。
 */
export function CodeBlock({ code, language }: CodeBlockProps): React.JSX.Element {
  const t = useTheme()
  return (
    <CodeBlockInner
      code={code}
      language={language}
      colorScheme={t.colorScheme}
      codeFontSize={t.typography.code}
    />
  )
}

const CodeBlockInner = memo(function CodeBlockInner({
  code,
  language,
  colorScheme,
  codeFontSize,
}: CodeBlockInnerProps): React.JSX.Element {
  const t = useTheme()
  const [copied, setCopied] = useState(false)
  const openView = useArtifactStore((s) => s.openView)
  const displayLang = language || 'text'
  const hlLang = normalizeHighlightLang(language)
  const lineCount = useMemo(() => code.split('\n').length, [code])
  const canHighlight = lineCount <= HIGHLIGHT_MAX_LINES && hlLang !== 'text'
  const themeStyle = colorScheme === 'dark' ? atomOneDark : atomOneLight

  const onCopy = async (): Promise<void> => {
    await Clipboard.setStringAsync(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const onOpenPanel = (): void => {
    openView({ title: displayLang, lang: displayLang, code })
  }

  return (
    <View
      style={[
        styles.container,
        {
          borderColor: t.border.default,
          backgroundColor: colorScheme === 'dark' ? '#1C2130' : '#F7F7F5',
        },
      ]}
    >
      <View
        style={[
          styles.header,
          { backgroundColor: colorScheme === 'dark' ? t.bg.elevated : '#EFEEEA' },
        ]}
      >
        <Text style={[styles.lang, { color: t.text.secondary }]}>{displayLang}</Text>
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
              <Check size={13} color={t.text.secondary} />
            ) : (
              <Copy size={13} color={t.text.secondary} />
            )}
            <Text style={[styles.actLabel, { color: t.text.secondary }]}>
              {copied ? '已复制' : '复制'}
            </Text>
          </Pressable>
          <Pressable
            onPress={onOpenPanel}
            hitSlop={6}
            style={styles.actBtn}
            accessibilityLabel="在面板中查看"
          >
            <ExternalLink size={13} color={t.text.secondary} />
            <Text style={[styles.actLabel, { color: t.text.secondary }]}>面板</Text>
          </Pressable>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.codeScroll}>
        {canHighlight ? (
          <SyntaxHighlighter
            language={hlLang}
            style={themeStyle}
            highlighter="hljs"
            fontSize={codeFontSize}
            fontFamily="monospace"
            customStyle={{
              backgroundColor: 'transparent',
              padding: 0,
              margin: 0,
            }}
          >
            {code}
          </SyntaxHighlighter>
        ) : (
          <Text
            selectable
            style={[
              styles.code,
              {
                color: t.text.primary,
                fontSize: codeFontSize,
                lineHeight: Math.round(codeFontSize * 1.45),
              },
            ]}
          >
            {code}
          </Text>
        )}
      </ScrollView>
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    marginVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  lang: {
    fontSize: 11,
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
  actLabel: { fontSize: 11 },
  codeScroll: { padding: spacing.md },
  code: {
    fontFamily: 'monospace',
  },
})
