import { useEffect, useState, type ReactElement } from 'react'

import { buildRunSrcDoc } from '@yuanai/core/utils'
import type { DesktopArtifactPayload } from '../../shared/ipc-contract'

import './artifact.css'

/** 独立 Artifact 窗口，安全展示代码或在隔离 iframe 中运行预览。 */
export function App(): ReactElement {
  const [payload, setPayload] = useState<DesktopArtifactPayload | null>(null)

  useEffect(() => window.yuanai.events.onArtifactInit(setPayload), [])

  if (!payload) return <main className="artifact__empty">正在准备 Artifact…</main>

  return (
    <main className="artifact" aria-label="Artifact 预览" tabIndex={-1}>
      <header className="artifact__header">
        <div>
          <h1>{payload.title}</h1>
          <p>{payload.lang || 'Code'}</p>
        </div>
        <span className="artifact__mode">{payload.mode === 'run' ? '运行预览' : '代码查看'}</span>
      </header>
      <section className="artifact__content">
        {payload.mode === 'run' ? (
          <iframe
            className="artifact__frame"
            sandbox="allow-scripts"
            srcDoc={buildRunSrcDoc(payload.lang, payload.code)}
            title={`${payload.title} 预览`}
          />
        ) : (
          <pre className="artifact__code">
            <code>{payload.code}</code>
          </pre>
        )}
      </section>
    </main>
  )
}
