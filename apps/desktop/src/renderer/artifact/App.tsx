import { Check, Copy, Eye, Play } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'

import { buildRunSrcDoc, isRunnableLang } from '@yuanai/core/utils'
import type { DesktopArtifactPayload } from '../../shared/ipc-contract'
import { copyText } from '../shared/clipboard'

import './artifact.css'

/** 独立 Artifact 窗口，在同一窗口内切换源码展示和隔离运行预览。 */
export function App(): ReactElement {
  const [payload, setPayload] = useState<DesktopArtifactPayload | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(
    () =>
      window.yuanai.events.onArtifactInit((nextPayload) => {
        setPayload(nextPayload)
        setCopied(false)
      }),
    []
  )

  if (!payload) return <main className="artifact__empty">正在准备 Artifact…</main>

  const shown = payload
  const runnable = isRunnableLang(shown.lang)

  function switchMode(mode: DesktopArtifactPayload['mode']): void {
    setPayload((current) => (current ? { ...current, mode } : current))
  }

  function handleCopy(): void {
    void copyText(shown.code).then((didCopy) => {
      if (!didCopy) return
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <main className="artifact" aria-label="Artifact 预览" tabIndex={-1}>
      <header className="artifact__header">
        <div>
          <h1>{shown.title}</h1>
          <p>{shown.lang || 'Code'}</p>
        </div>
        <div className="artifact__actions">
          {shown.mode === 'view' && runnable ? (
            <button
              type="button"
              aria-label="运行预览"
              title="运行预览"
              onClick={() => switchMode('run')}
            >
              <Play size={16} aria-hidden="true" />
            </button>
          ) : null}
          {shown.mode === 'run' ? (
            <button
              type="button"
              aria-label="查看源码"
              title="查看源码"
              onClick={() => switchMode('view')}
            >
              <Eye size={16} aria-hidden="true" />
            </button>
          ) : null}
          <span className="artifact__mode">{shown.mode === 'run' ? '运行预览' : '代码查看'}</span>
        </div>
      </header>
      <section className="artifact__content">
        {shown.mode === 'run' ? (
          <iframe
            className="artifact__frame"
            sandbox="allow-scripts allow-forms"
            srcDoc={buildRunSrcDoc(shown.lang, shown.code)}
            title={`${shown.title} 预览`}
          />
        ) : (
          <pre className="artifact__code">
            <code>{shown.code}</code>
          </pre>
        )}
      </section>
      <footer className="artifact__footer">
        <button type="button" onClick={handleCopy}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied ? '已复制' : '复制代码'}
        </button>
        <span>
          {shown.lang || 'Code'} · {shown.code.split('\n').length} 行
        </span>
      </footer>
    </main>
  )
}
