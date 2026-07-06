'use client'

import { useState, type JSX } from 'react'
import { Check, Copy, Download } from 'lucide-react'
import { CodeHighlight } from '@/components/chat/CodeHighlight'
import { langToExtension } from '@/components/chat/utils'

export interface ShareCodeBlockProps {
  lang: string
  code: string
}

/**
 * 分享页专用的简化代码块。
 *
 * 相比登录后聊天页的 CodeBlock：
 * - 移除"面板查看"和"运行"按钮（分享页无 artifact store）
 * - 仅保留复制、下载
 * - 样式完全自包含在 share.css 内
 */
export function ShareCodeBlock({ lang, code }: ShareCodeBlockProps): JSX.Element {
  const [copied, setCopied] = useState(false)
  const displayLang = lang || 'code'

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  const download = (): void => {
    const ext = langToExtension(lang)
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `code.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="sh-code">
      <div className="sh-code-hd">
        <span className="sh-code-lang">{displayLang}</span>
        <div className="sh-code-acts">
          <button className="sh-code-act" onClick={() => void copy()} type="button">
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? '已复制' : '复制'}
          </button>
          <button className="sh-code-act" onClick={download} type="button">
            <Download size={12} />
            下载
          </button>
        </div>
      </div>
      <div className="sh-code-body">
        <CodeHighlight
          lang={lang}
          code={code}
          padding="14px 16px"
          fontSize="12.5px"
          lineHeight="1.6"
        />
      </div>
    </div>
  )
}
