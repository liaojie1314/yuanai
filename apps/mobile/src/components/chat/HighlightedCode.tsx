import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { useTheme } from '@/theme/useTheme'

import { normalizeHighlightLang } from './codeLang'

// RN 桥接层：把 react-syntax-highlighter 的 vdom 转成原生 <Text> token 树
// eslint-disable-next-line @typescript-eslint/no-require-imports
const rnshModule = require('react-native-syntax-highlighter') as {
  default: React.ComponentType<{
    language?: string
    style?: Record<string, React.CSSProperties | object>
    customStyle?: object
    fontSize?: number
    fontFamily?: string
    highlighter?: 'hljs' | 'prism'
    PreTag?: React.ElementType
    CodeTag?: React.ElementType
    children: string
  }> & { defaultProps?: object | undefined }
}
const SyntaxHighlighter = rnshModule.default
// React 18.3 起函数组件的 defaultProps 触发 LogBox 告警；
// 清掉它并在 JSX 显式传 fontSize/fontFamily/PreTag/CodeTag。
SyntaxHighlighter.defaultProps = undefined

// hljs atom-one 主题（v16 子路径由 metro.config.js 映射到 dist/cjs）
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { atomOneDark, atomOneLight } = require('react-syntax-highlighter/styles/hljs') as {
  atomOneDark: Record<string, object>
  atomOneLight: Record<string, object>
}

interface HighlightedCodeProps {
  code: string
  language?: string | undefined
  /** 超过该行数降级纯文本（每 token 一个 <Text>，长块会卡顿 / ANR） */
  maxLines: number
  fontSize?: number
}

/**
 * 语法高亮代码正文（CodeBlock 气泡与 Artifact 面板共用）。
 * 自行订阅 useTheme：主题/字号变化时即使父级被 memo 也会随 context 重渲。
 */
export function HighlightedCode({
  code,
  language,
  maxLines,
  fontSize,
}: HighlightedCodeProps): React.JSX.Element {
  const theme = useTheme()
  const hlLang = normalizeHighlightLang(language)
  const lineCount = useMemo(() => code.split('\n').length, [code])
  const canHighlight = lineCount <= maxLines && hlLang !== 'text'
  const codeFontSize = fontSize ?? theme.typography.code
  const themeStyle = theme.colorScheme === 'dark' ? atomOneDark : atomOneLight

  if (!canHighlight) {
    return (
      <Text
        selectable
        style={[
          styles.plain,
          {
            color: theme.text.primary,
            fontSize: codeFontSize,
            lineHeight: Math.round(codeFontSize * 1.45),
          },
        ]}
      >
        {code}
      </Text>
    )
  }

  return (
    <SyntaxHighlighter
      language={hlLang}
      style={themeStyle}
      highlighter="hljs"
      fontSize={codeFontSize}
      fontFamily="monospace"
      PreTag={View}
      CodeTag={View}
      customStyle={styles.transparent}
    >
      {code}
    </SyntaxHighlighter>
  )
}

const styles = StyleSheet.create({
  plain: { fontFamily: 'monospace' },
  transparent: { backgroundColor: 'transparent', padding: 0, margin: 0 },
})
