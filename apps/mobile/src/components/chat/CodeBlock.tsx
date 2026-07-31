import * as Clipboard from 'expo-clipboard'
import { Check, Copy, ExternalLink } from 'lucide-react-native'
import { memo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { useArtifactStore } from '@yuanai/core/stores'

import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'
import { useTranslation } from 'react-i18next'

import { HighlightedCode } from './HighlightedCode'

interface CodeBlockProps {
  code: string
  language?: string | undefined
}

interface CodeBlockInnerProps extends CodeBlockProps {
  colorScheme: 'light' | 'dark'
  codeFontSize: number
}

/** 超过该行数降级纯文本，避免每 token 一个 <Text> 导致长块卡顿 / ANR */
const HIGHLIGHT_MAX_LINES = 300

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
  const theme = useTheme()
  const { t } = useTranslation()
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
    <View
      style={[
        styles.container,
        {
          borderColor: theme.border.default,
          backgroundColor: colorScheme === 'dark' ? '#1C2130' : '#F7F7F5',
        },
      ]}
    >
      <View
        style={[
          styles.header,
          { backgroundColor: colorScheme === 'dark' ? theme.bg.elevated : '#EFEEEA' },
        ]}
      >
        <Text style={[styles.lang, { color: theme.text.secondary }]}>{displayLang}</Text>
        <View style={styles.actions}>
          <Pressable
            onPress={() => {
              void onCopy()
            }}
            hitSlop={6}
            style={styles.actBtn}
            accessibilityLabel={t('chat.copyCode')}
          >
            {copied ? (
              <Check size={13} color={theme.text.secondary} />
            ) : (
              <Copy size={13} color={theme.text.secondary} />
            )}
            <Text style={[styles.actLabel, { color: theme.text.secondary }]}>
              {copied ? t('chat.copied') : t('chat.copy')}
            </Text>
          </Pressable>
          <Pressable
            onPress={onOpenPanel}
            hitSlop={6}
            style={styles.actBtn}
            accessibilityLabel={t('chat.openPanel')}
          >
            <ExternalLink size={13} color={theme.text.secondary} />
            <Text style={[styles.actLabel, { color: theme.text.secondary }]}>
              {t('chat.panel')}
            </Text>
          </Pressable>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.codeScroll}>
        <HighlightedCode
          code={code}
          language={language}
          maxLines={HIGHLIGHT_MAX_LINES}
          fontSize={codeFontSize}
        />
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
})
