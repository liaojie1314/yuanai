'use client'

import { useState, type JSX } from 'react'
import { Copy, Check, ExternalLink, Play } from 'lucide-react'
import { useArtifactStore } from '@yuanai/core/stores'
import { isRunnableLang } from './utils'

/**
 * 代码块渲染组件。
 *
 * 展示语言标签 + 三种操作：
 * - 复制代码到剪贴板
 * - 在 Artifact 面板中查看（只读）
 * - 在受限 iframe 沙箱中运行（仅 HTML/CSS/JS）
 */
export interface CodeBlockProps {
  /** 语法语言，例如 `typescript`、`html`、`css`、`javascript` */
  lang: string
  /** 代码正文 */
  code: string
  /** 可选标题，会传递给 Artifact 面板 */
  title?: string
}

/**
 * 代码块渲染组件（详情见 {@link CodeBlockProps}）。
 */
export function CodeBlock({ lang, code, title }: CodeBlockProps): JSX.Element {
  const [copied, setCopied] = useState(false)
  const { openView, openRun } = useArtifactStore()
  const displayLang = lang || 'Code'
  const runnable = isRunnableLang(lang)

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 忽略权限失败
    }
  }

  const openInPanel = (): void => {
    openView({ title: title ?? displayLang, lang: displayLang, code })
  }

  const runInPanel = (): void => {
    if (!runnable) return
    openRun({ title: title ?? `${displayLang} 运行`, lang: displayLang, code })
  }

  return (
    <div className="ch-code-block">
      <div className="ch-code-head">
        <span className="ch-code-lang">{displayLang}</span>
        <div className="ch-code-acts">
          <button
            className={`ch-code-act ${copied ? 'copied' : ''}`}
            onClick={() => {
              void copy()
            }}
            aria-label="复制代码"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? '已复制' : '复制'}
          </button>
          <button
            className="ch-code-act ch-code-act-panel"
            onClick={openInPanel}
            aria-label="在面板中查看"
          >
            <ExternalLink size={12} /> 在面板中查看
          </button>
          {runnable && (
            <button
              className="ch-code-act ch-code-act-run"
              onClick={runInPanel}
              aria-label="运行代码"
            >
              <Play size={12} /> 运行
            </button>
          )}
        </div>
      </div>
      <pre className="ch-code-body">
        <code>{code}</code>
      </pre>
    </div>
  )
}
