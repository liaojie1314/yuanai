'use client'

import { useMemo, useState, type JSX } from 'react'
import { Copy, Check, X, Play, Eye } from 'lucide-react'
import { useArtifactStore } from '@yuanai/core/stores'
import { buildRunSrcDoc, isRunnableLang } from './utils'

/**
 * Artifact 面板（右侧滑出）。
 *
 * 订阅 `useArtifactStore`：
 * - `mode === 'view'`：只读代码展示
 * - `mode === 'run'`：iframe `srcdoc` 沙箱执行（`sandbox="allow-scripts"`）
 *
 * 面板可在 view / run 两态间切换（如果代码可运行）。
 */
export function ArtifactPanel(): JSX.Element | null {
  const open = useArtifactStore((s) => s.open)
  const payload = useArtifactStore((s) => s.payload)
  const openView = useArtifactStore((s) => s.openView)
  const openRun = useArtifactStore((s) => s.openRun)
  const close = useArtifactStore((s) => s.close)
  const [copied, setCopied] = useState(false)

  const srcdoc = useMemo(() => {
    if (!payload || payload.mode !== 'run') return ''
    return buildRunSrcDoc(payload.lang, payload.code)
  }, [payload])

  if (!open || !payload) return null

  const lineCount = payload.code.split('\n').length
  const runnable = isRunnableLang(payload.lang)

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(payload.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* 忽略权限失败 */
    }
  }

  return (
    <div className="ch-artifact-panel" role="complementary" aria-label="代码面板">
      <div className="ch-ap-head">
        <span className="ch-ap-lang">{payload.lang}</span>
        <span className="ch-ap-title" title={payload.title}>
          {payload.title}
        </span>
        <div className="ch-ap-head-acts">
          {runnable && payload.mode === 'view' && (
            <button
              className="ch-ib"
              onClick={() =>
                openRun({ title: payload.title, lang: payload.lang, code: payload.code })
              }
              title="运行代码"
              aria-label="运行代码"
            >
              <Play size={16} />
            </button>
          )}
          {payload.mode === 'run' && (
            <button
              className="ch-ib"
              onClick={() =>
                openView({ title: payload.title, lang: payload.lang, code: payload.code })
              }
              title="查看源码"
              aria-label="查看源码"
            >
              <Eye size={16} />
            </button>
          )}
          <button
            className="ch-ib"
            onClick={() => {
              void copy()
            }}
            title="复制代码"
            aria-label="复制代码"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
          <button className="ch-ib" onClick={close} title="关闭面板" aria-label="关闭面板">
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="ch-ap-body">
        {payload.mode === 'view' ? (
          <pre>{payload.code}</pre>
        ) : (
          <iframe
            key={srcdoc}
            className="ch-ap-iframe"
            title="沙箱预览"
            sandbox="allow-scripts allow-forms"
            srcDoc={srcdoc}
          />
        )}
      </div>
      <div className="ch-ap-footer">
        <button
          className="ch-ap-copy-btn"
          onClick={() => {
            void copy()
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? '已复制' : '复制代码'}
        </button>
        <span className="ch-ap-finfo">
          {payload.lang} · {lineCount} 行
        </span>
      </div>
    </div>
  )
}
