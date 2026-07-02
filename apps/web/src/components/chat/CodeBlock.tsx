'use client'

import { useState, type JSX } from 'react'
import { Copy, Check, ExternalLink, Play, Download } from 'lucide-react'
import { useArtifactStore } from '@yuanai/core/stores'
import { isRunnableLang, langToExtension } from './utils'
import { CodeHighlight } from './CodeHighlight'

/**
 * 代码块渲染组件。
 *
 * 展示语言标签 + 语法高亮正文 + 四种操作：
 * - 复制代码到剪贴板
 * - 下载为对应扩展名的文件
 * - 在 Artifact 面板中查看（只读）
 * - 在受限 iframe 沙箱中运行（仅 HTML/CSS/JS）
 */
export interface CodeBlockProps {
  /** 语法语言，例如 `typescript`、`html`、`css`、`javascript` */
  lang: string
  /** 代码正文 */
  code: string
  /** 可选标题，会传递给 Artifact 面板，也用作下载文件名 */
  title?: string
}

/**
 * 代码块渲染组件（详情见 {@link CodeBlockProps}）。
 */
export function CodeBlock({ lang, code, title }: CodeBlockProps): JSX.Element {
  const [copied, setCopied] = useState(false)
  // 用 selector 而非整体订阅：避免面板 open/payload 变化时，页面里每个代码块都跟着重渲染
  const openView = useArtifactStore((s) => s.openView)
  const openRun = useArtifactStore((s) => s.openRun)
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

  const download = (): void => {
    const ext = langToExtension(lang)
    const filename = `${title ?? 'code'}.${ext}`
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
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
          <button className="ch-code-act" onClick={download} aria-label="下载代码">
            <Download size={12} /> 下载
          </button>
          <button
            className="ch-code-act ch-code-act-panel"
            onClick={openInPanel}
            aria-label="面板查看"
          >
            <ExternalLink size={12} /> 面板查看
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
      <CodeHighlight
        lang={lang}
        code={code}
        className="ch-code-body"
        padding="14px 16px"
        fontSize="12.5px"
        lineHeight={1.6}
      />
    </div>
  )
}
