'use client'

import { useEffect, useState, type CSSProperties, type JSX } from 'react'
import { PrismAsyncLight as SyntaxHighlighterRaw } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { isDark } from './utils'

// 用 PrismAsyncLight 而非 Prism：后者把全部 300+ 种语言语法同步打包，
// 会话里代码块一多，光解析求值这个 bundle 就明显拖慢首屏；
// AsyncLight 只按需异步加载当前用到的语言，未加载完前先原样展示纯文本再渐进高亮。
// react-syntax-highlighter 的 @types 落后于运行时的 v16 API；cast 修正类型不匹配。
const SyntaxHighlighter = SyntaxHighlighterRaw as unknown as (props: {
  language: string
  style: unknown
  className?: string | undefined
  customStyle?: CSSProperties | undefined
  codeTagProps?: { style?: CSSProperties | undefined } | undefined
  children: string
}) => JSX.Element

const FONT_STACK = '"SF Mono", "Fira Code", "Cascadia Code", "Courier New", monospace'

export interface CodeHighlightProps {
  /** 语法语言标识，例如 `typescript`、`python`；未识别的语言原样展示不高亮 */
  lang: string
  code: string
  className?: string
  /** pre 容器 padding，不同调用方视觉规范不同（如消息代码块 vs 面板），默认 0 */
  padding?: CSSProperties['padding']
  fontSize?: CSSProperties['fontSize']
  lineHeight?: CSSProperties['lineHeight']
}

/** 监听 `data-theme` 属性变化，驱动语法高亮配色跟随明暗主题切换 */
function useIsDarkTheme(): boolean {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    setDark(isDark())
    const observer = new MutationObserver(() => setDark(isDark()))
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

/**
 * 代码语法高亮展示（Prism 引擎），供消息代码块与 Artifact 面板复用。
 *
 * Prism 主题以内联样式覆盖 pre/code 的 padding/margin/background/字体等属性，
 * 外层 CSS 类无法覆盖同名内联样式，因此 padding/字号/行高改由调用方显式传入，
 * 且同时应用到 pre 与 code 两层（主题对二者分别设置了 lineHeight/fontFamily）。
 */
export function CodeHighlight({
  lang,
  code,
  className,
  padding = 0,
  fontSize,
  lineHeight,
}: CodeHighlightProps): JSX.Element {
  const dark = useIsDarkTheme()
  return (
    <SyntaxHighlighter
      language={lang.trim().toLowerCase()}
      style={dark ? oneDark : oneLight}
      className={className}
      customStyle={{
        margin: 0,
        padding,
        background: 'transparent',
        borderRadius: 0,
        fontFamily: FONT_STACK,
        fontSize,
        lineHeight,
      }}
      codeTagProps={{
        style: {
          fontFamily: 'inherit',
          fontSize: 'inherit',
          lineHeight: 'inherit',
          background: 'transparent',
        },
      }}
    >
      {code}
    </SyntaxHighlighter>
  )
}
