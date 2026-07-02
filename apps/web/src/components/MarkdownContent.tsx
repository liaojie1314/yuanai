'use client'

import type { JSX } from 'react'
// react-markdown v10 peer dep targets React 16-18; the cast fixes the React 19 type mismatch.
import ReactMarkdownRaw from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkGemoji from 'remark-gemoji'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { CodeBlock } from '@/components/chat/CodeBlock'

interface MarkdownProps {
  children: string
  remarkPlugins?: unknown[]
  rehypePlugins?: unknown[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components?: Record<string, (props: any) => JSX.Element | null>
}
// react-markdown v10 peer dep targets React 16-18; cast fixes React 19 type mismatch.
const ReactMarkdown = ReactMarkdownRaw as unknown as (props: MarkdownProps) => JSX.Element

interface MarkdownContentProps {
  content: string
  /** Show blinking cursor at end (for streaming) */
  streaming?: boolean
}

/**
 * 通用 Markdown 渲染组件
 *
 * 支持 GFM（表格、删除线、任务列表、脚注、代码块）、LaTeX 数学公式（`$..$` / `$$..$$`）、
 * `:emoji:` short code。代码块委托 `CodeBlock` 组件渲染（含复制/下载/面板查看/运行按钮）。
 *
 * 未启用原始 HTML 透传（`rehype-raw`）：消息内容可能来自 AI 生成或用户输入，
 * 放行原始 HTML 会引入 XSS 风险，如需支持需搭配 `rehype-sanitize` 白名单一起启用。
 */
export default function MarkdownContent({ content, streaming }: MarkdownContentProps): JSX.Element {
  return (
    <div className="ch-msg-content md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkGemoji]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({
            className,
            children,
          }: {
            className?: string
            children?: React.ReactNode
            inline?: boolean
          }) {
            const match = /language-(\w+)/.exec(className ?? '')
            const text = String(children)
            const isBlock = match !== null || text.includes('\n')
            if (isBlock) {
              return <CodeBlock lang={match?.[1] ?? ''} code={text.replace(/\n$/, '')} />
            }
            return <code className="ch-inline-code">{children}</code>
          },
          // Prevent react-markdown from wrapping CodeBlock inside <p>
          pre({ children }: { children?: React.ReactNode }) {
            return <>{children}</>
          },
        }}
      >
        {content}
      </ReactMarkdown>
      {streaming && <span className="ch-cursor" />}
    </div>
  )
}
