import { useEffect, useState, type CSSProperties, type ReactElement } from 'react'
import { PrismAsyncLight as PrismAsyncLightRaw } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'

const FONT_STACK = '"SF Mono", "Fira Code", "Cascadia Code", "Courier New", monospace'

/** 代码高亮组件的显示配置。 */
export interface CodeHighlightProps {
  /** Markdown 代码块声明的语言。 */
  lang: string
  /** 待渲染的原始代码。 */
  code: string
  /** 组件根节点样式类。 */
  className?: string | undefined
  /** `pre` 的内边距。 */
  padding?: CSSProperties['padding']
  /** 代码字号。 */
  fontSize?: CSSProperties['fontSize']
  /** 代码行高。 */
  lineHeight?: CSSProperties['lineHeight']
}

type SyntaxHighlighterProps = {
  language: string
  style: unknown
  className?: string | undefined
  customStyle?: CSSProperties
  codeTagProps?: { style?: CSSProperties }
  children: string
}

const PrismAsyncLight = PrismAsyncLightRaw as unknown as (
  props: SyntaxHighlighterProps
) => ReactElement

/** 将常见 Markdown 语言别名归一到 Prism 支持的标识。 */
function normalizeLanguage(lang: string): string {
  const value = lang.trim().toLocaleLowerCase()
  if (value === 'ts') return 'typescript'
  if (value === 'js' || value === 'mjs' || value === 'cjs') return 'javascript'
  if (value === 'py') return 'python'
  if (value === 'sh' || value === 'shell') return 'bash'
  if (value === 'yml') return 'yaml'
  return value || 'text'
}

/** 监听主题切换，使 Prism 颜色和桌面端全局主题保持一致。 */
function useDarkTheme(): boolean {
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute('data-theme') === 'dark'
  )

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDark(document.documentElement.getAttribute('data-theme') === 'dark')
    })
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  return dark
}

/** 在消息代码块和 Artifact 面板中按需加载 Prism 语言并渲染语法高亮。 */
export function CodeHighlight({
  lang,
  code,
  className,
  padding = 0,
  fontSize,
  lineHeight,
}: CodeHighlightProps): ReactElement {
  const dark = useDarkTheme()

  return (
    <PrismAsyncLight
      language={normalizeLanguage(lang)}
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
    </PrismAsyncLight>
  )
}
