import { Check, Copy, Eye, Maximize2, Minimize2, Play, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'

import { useArtifactStore, type ArtifactPayload } from '@yuanai/core/stores'
import { buildRunSrcDoc, isRunnableLang } from '@yuanai/core/utils'

import { copyText } from '../shared/clipboard'
import { CodeHighlight } from './CodeHighlight'

const EMPTY_PAYLOAD: ArtifactPayload = { code: '', lang: '', mode: 'view', title: '' }

/** 主窗口右侧的 Artifact 面板，统一展示源码与受限 iframe 预览。 */
export function ArtifactPanel(): ReactElement {
  const open = useArtifactStore((state) => state.open)
  const payload = useArtifactStore((state) => state.payload)
  const openView = useArtifactStore((state) => state.openView)
  const openRun = useArtifactStore((state) => state.openRun)
  const close = useArtifactStore((state) => state.close)
  const [shown, setShown] = useState<ArtifactPayload>(EMPTY_PAYLOAD)
  const [copied, setCopied] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    if (!payload) return
    setShown(payload)
    setCopied(false)
  }, [payload])

  const runnable = isRunnableLang(shown.lang)
  const srcDoc = useMemo(
    () => (shown.mode === 'run' ? buildRunSrcDoc(shown.lang, shown.code) : ''),
    [shown]
  )

  function handleCopy(): void {
    void copyText(shown.code).then((didCopy) => {
      if (!didCopy) return
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    })
  }

  function handleShowSource(): void {
    openView({ code: shown.code, lang: shown.lang, title: shown.title })
  }

  function handleRunPreview(): void {
    openRun({ code: shown.code, lang: shown.lang, title: shown.title })
  }

  const panelClassName = [
    'desktop-artifact-panel',
    open ? 'is-open' : '',
    fullscreen ? 'is-fullscreen' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <aside
      className={panelClassName}
      role="complementary"
      aria-label="代码面板"
      aria-hidden={!open}
    >
      <header className="desktop-artifact-panel__header">
        <span className="desktop-artifact-panel__language">{shown.lang || 'code'}</span>
        <strong className="desktop-artifact-panel__title" title={shown.title}>
          {shown.title || '代码面板'}
        </strong>
        <div className="desktop-artifact-panel__actions">
          {shown.mode === 'view' && runnable ? (
            <button type="button" aria-label="运行预览" title="运行预览" onClick={handleRunPreview}>
              <Play size={16} aria-hidden="true" />
            </button>
          ) : null}
          {shown.mode === 'run' ? (
            <button type="button" aria-label="查看源码" title="查看源码" onClick={handleShowSource}>
              <Eye size={16} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            aria-label={fullscreen ? '退出全屏' : '全屏代码面板'}
            title={fullscreen ? '退出全屏' : '全屏'}
            onClick={() => setFullscreen((value) => !value)}
          >
            {fullscreen ? (
              <Minimize2 size={16} aria-hidden="true" />
            ) : (
              <Maximize2 size={16} aria-hidden="true" />
            )}
          </button>
          <button type="button" aria-label="关闭代码面板" title="关闭" onClick={close}>
            <X size={17} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="desktop-artifact-panel__body">
        {shown.mode === 'run' ? (
          <iframe
            key={srcDoc}
            className="desktop-artifact-panel__frame"
            sandbox="allow-scripts allow-forms"
            srcDoc={srcDoc}
            title={`${shown.title || shown.lang || '代码'} 预览`}
          />
        ) : (
          <CodeHighlight
            className="desktop-artifact-panel__code"
            code={shown.code}
            lang={shown.lang}
            padding="16px"
            fontSize="12px"
            lineHeight={1.65}
          />
        )}
      </div>
      <footer className="desktop-artifact-panel__footer">
        <button type="button" onClick={handleCopy}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied ? '已复制' : '复制代码'}
        </button>
        <span>
          {shown.lang || 'code'} · {shown.code.split('\n').length} 行
        </span>
      </footer>
    </aside>
  )
}
