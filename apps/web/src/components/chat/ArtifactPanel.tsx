'use client'

import { useEffect, useMemo, useState, type JSX } from 'react'
import { Copy, Check, X, Play, Eye } from 'lucide-react'
import { useArtifactStore, type ArtifactPayload } from '@yuanai/core/stores'
import { buildRunSrcDoc, isRunnableLang } from './utils'
import { CodeHighlight } from './CodeHighlight'

const EMPTY_PAYLOAD: ArtifactPayload = { title: '', lang: '', code: '', mode: 'view' }

/**
 * Artifact 面板（右侧滑出）。
 *
 * 面板容器始终挂载（哪怕从未打开过），只有内容随 store 的 payload 变化而更新。
 * 若改成"仅 open 时才挂载"，首次打开会因为 DOM 节点创建与祖先 `.ap-open` 类的应用
 * 发生在同一次 React commit 里，浏览器没有"关闭态"的前一帧可供过渡，滑入动画会直接跳变；
 * 关闭时同理会立刻卸载导致滑出动画被打断。保持常驻挂载 + 记住最后一次 payload，
 * 才能让每次打开/关闭都成为已存在节点上的一次真实样式变化，交给 CSS transition 处理。
 *
 * 订阅 `useArtifactStore`：
 * - `mode === 'view'`：只读代码展示
 * - `mode === 'run'`：iframe `srcdoc` 沙箱执行（`sandbox="allow-scripts"`）
 */
export function ArtifactPanel(): JSX.Element {
  const open = useArtifactStore((s) => s.open)
  const payload = useArtifactStore((s) => s.payload)
  const openView = useArtifactStore((s) => s.openView)
  const openRun = useArtifactStore((s) => s.openRun)
  const close = useArtifactStore((s) => s.close)
  const [copied, setCopied] = useState(false)
  const [shown, setShown] = useState<ArtifactPayload>(EMPTY_PAYLOAD)

  useEffect(() => {
    if (payload) setShown(payload)
  }, [payload])

  const srcdoc = useMemo(() => {
    if (shown.mode !== 'run') return ''
    return buildRunSrcDoc(shown.lang, shown.code)
  }, [shown])

  const lineCount = shown.code.split('\n').length
  const runnable = isRunnableLang(shown.lang)

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(shown.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* 忽略权限失败 */
    }
  }

  return (
    <div
      className="ch-artifact-panel"
      role="complementary"
      aria-label="代码面板"
      aria-hidden={!open}
    >
      <div className="ch-ap-head">
        <span className="ch-ap-lang">{shown.lang}</span>
        <span className="ch-ap-title" title={shown.title}>
          {shown.title}
        </span>
        <div className="ch-ap-head-acts">
          {runnable && shown.mode === 'view' && (
            <button
              className="ch-ib"
              onClick={() => openRun({ title: shown.title, lang: shown.lang, code: shown.code })}
              title="运行代码"
              aria-label="运行代码"
            >
              <Play size={16} />
            </button>
          )}
          {shown.mode === 'run' && (
            <button
              className="ch-ib"
              onClick={() => openView({ title: shown.title, lang: shown.lang, code: shown.code })}
              title="查看源码"
              aria-label="查看源码"
            >
              <Eye size={16} />
            </button>
          )}
          <button className="ch-ib" onClick={close} title="关闭面板" aria-label="关闭面板">
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="ch-ap-body">
        {shown.mode === 'view' ? (
          <CodeHighlight lang={shown.lang} code={shown.code} fontSize="12px" lineHeight={1.6} />
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
          {shown.lang} · {lineCount} 行
        </span>
      </div>
    </div>
  )
}
