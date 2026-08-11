import { useEffect, useState, type CSSProperties, type JSX } from 'react'
import { PrismAsyncLight as SyntaxHighlighterRaw } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'

const FONT_STACK = '"SF Mono", "Fira Code", "Cascadia Code", "Courier New", monospace'

const PRISM_LANG_ALIASES: Readonly<Record<string, string>> = {
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  svg: 'markup',
  vue: 'markup',
  ts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  sh: 'bash',
  shell: 'bash',
  yml: 'yaml',
  py: 'python',
  md: 'markdown',
}

// `@types/react-syntax-highlighter` 尚未覆盖运行时 v16 的异步 Prism 组件签名。
const SyntaxHighlighter = SyntaxHighlighterRaw as unknown as (props: {
  language: string
  style: unknown
  className?: string | undefined
  customStyle?: CSSProperties | undefined
  codeTagProps?: { style?: CSSProperties | undefined } | undefined
  children: string
}) => JSX.Element

/** 桌面端代码高亮的渲染参数。 */
export interface CodeHighlightProps {
  /** Markdown 代码块给出的语言标识。 */
  lang: string
  /** 待渲染的原始代码。 */
  code: string
  /** 附加到 Prism 根 `pre` 的样式类。 */
  className?: string
  /** 代码容器内边距。 */
  padding?: CSSProperties['padding']
  /** 代码字体大小。 */
  fontSize?: CSSProperties['fontSize']
  /** 代码行高。 */
  lineHeight?: CSSProperties['lineHeight']
}

function normalizePrismLang(lang: string): string {
  const normalized = lang.trim().toLowerCase()
  return PRISM_LANG_ALIASES[normalized] ?? normalized
}

function useIsDarkTheme(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark')

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDark(document.documentElement.dataset.theme === 'dark')
    })
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  return dark
}

/**
 * 使用 Web 同款 Prism 异步引擎渲染桌面端聊天和 Artifact 的只读源码。
 * @param props 代码语言、正文以及调用方所需的排版参数。
 * @returns 带按需语法高亮的 `pre` 元素。
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
      language={normalizePrismLang(lang)}
      style={dark ? oneDark : oneLight}
      className={className}
      customStyle={{
        margin: 0,
        padding,
        borderRadius: 0,
        background: 'transparent',
        fontFamily: FONT_STACK,
        fontSize,
        lineHeight,
      }}
      codeTagProps={{
        style: {
          background: 'transparent',
          fontFamily: 'inherit',
          fontSize: 'inherit',
          lineHeight: 'inherit',
        },
      }}
    >
      {code}
    </SyntaxHighlighter>
  )
}
