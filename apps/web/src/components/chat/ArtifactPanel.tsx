'use client'

import { useEffect, useMemo, useState, type JSX } from 'react'
import {
  Copy,
  Check,
  X,
  Play,
  Eye,
  Maximize2,
  Minimize2,
  Terminal,
  Pencil,
  Table2,
} from 'lucide-react'
import CodeMirror, { type Extension } from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { html as cmHtml } from '@codemirror/lang-html'
import { css as cmCss } from '@codemirror/lang-css'
import { json as cmJson } from '@codemirror/lang-json'
import { markdown as cmMarkdown } from '@codemirror/lang-markdown'
import { useArtifactStore, type ArtifactPayload } from '@yuanai/core/stores'
import { buildRunSrcDoc, isRunnableLang, isDataPreviewLang, isDark } from './utils'
import { CodeHighlight } from './CodeHighlight'
import { ARTIFACT_MSG_SOURCE } from '@yuanai/core'

const EMPTY_PAYLOAD: ArtifactPayload = { title: '', lang: '', code: '', mode: 'view' }

/** 控制台面板最多保留的消息条数，超出则丢弃最旧的 */
const CONSOLE_MAX = 200

/** 控制台单条消息级别 */
type ConsoleLevel = 'log' | 'info' | 'warn' | 'error'

/** 控制台单条消息 */
interface ConsoleEntry {
  level: ConsoleLevel
  text: string
}

/**
 * 校验来自 iframe 的 postMessage 是否为可信的控制台桥消息。
 *
 * 入站消息一律视为不可信，需逐字段校验 source/level/text 的形状。
 */
function parseConsoleMessage(data: unknown): ConsoleEntry | null {
  if (typeof data !== 'object' || data === null) return null
  const obj = data as Record<string, unknown>
  if (obj.source !== ARTIFACT_MSG_SOURCE) return null
  const level = obj.level
  if (level !== 'log' && level !== 'info' && level !== 'warn' && level !== 'error') return null
  const text = typeof obj.text === 'string' ? obj.text : ''
  return { level, text }
}

/** 依据代码语言返回 CodeMirror 语言扩展，未识别则不加语言扩展 */
function langExtensions(lang: string): Extension[] {
  const l = lang.trim().toLowerCase()
  if (l === 'js' || l === 'javascript' || l === 'mjs' || l === 'cjs') return [javascript()]
  if (l === 'jsx') return [javascript({ jsx: true })]
  if (l === 'ts' || l === 'typescript') return [javascript({ typescript: true })]
  if (l === 'tsx') return [javascript({ jsx: true, typescript: true })]
  if (l === 'html' || l === 'htm' || l === 'vue' || l === 'svelte') return [cmHtml()]
  if (l === 'css' || l === 'scss' || l === 'less') return [cmCss()]
  if (l === 'json') return [cmJson()]
  if (l === 'markdown' || l === 'md') return [cmMarkdown()]
  return []
}

/** 极简 CSV 解析：按行拆分，字段以逗号分隔，支持基础的双引号包裹与 `""` 转义 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.length > 1 || (r[0] ?? '') !== '')
}

/**
 * JSON 树节点（递归渲染）。
 *
 * 对象/数组默认展开，可点击折叠；标量按类型着色。纯自实现，无外部依赖，SSR 安全。
 */
function JsonNode({ name, value }: { name?: string; value: unknown }): JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const isObject = typeof value === 'object' && value !== null
  const keyLabel = name === undefined ? null : <span className="ch-ap-data-key">{name}: </span>

  if (!isObject) {
    let cls = 'ch-ap-data-val'
    if (typeof value === 'string') cls += ' ch-ap-data-str'
    else if (typeof value === 'number') cls += ' ch-ap-data-num'
    else if (typeof value === 'boolean') cls += ' ch-ap-data-bool'
    else if (value === null) cls += ' ch-ap-data-null'
    const text = typeof value === 'string' ? `"${value}"` : String(value)
    return (
      <div className="ch-ap-data-row">
        {keyLabel}
        <span className={cls}>{text}</span>
      </div>
    )
  }

  const isArray = Array.isArray(value)
  const entries: [string, unknown][] = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>)
  const open = isArray ? '[' : '{'
  const close = isArray ? ']' : '}'

  return (
    <div className="ch-ap-data-node">
      <div
        className="ch-ap-data-row ch-ap-data-branch"
        onClick={() => setCollapsed((c) => !c)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setCollapsed((c) => !c)
        }}
      >
        <span className="ch-ap-data-caret">{collapsed ? '▸' : '▾'}</span>
        {keyLabel}
        <span className="ch-ap-data-brace">
          {open}
          {collapsed ? `…${close} (${entries.length})` : ''}
        </span>
      </div>
      {!collapsed && (
        <div className="ch-ap-data-children">
          {entries.map(([k, v]) => (
            <JsonNode key={k} name={k} value={v} />
          ))}
          <div className="ch-ap-data-row ch-ap-data-brace">{close}</div>
        </div>
      )}
    </div>
  )
}

/**
 * 数据预览：JSON → 可折叠树，CSV → 表格；解析失败时展示错误文本。
 */
function DataPreview({ lang, code }: { lang: string; code: string }): JSX.Element {
  const l = lang.toLowerCase()
  if (l === 'csv') {
    const rows = parseCsv(code)
    if (rows.length === 0) return <div className="ch-ap-data-empty">（空 CSV）</div>
    const [head, ...body] = rows
    return (
      <div className="ch-ap-data-wrap">
        <table className="ch-ap-data-table">
          <thead>
            <tr>
              {(head ?? []).map((cell, i) => (
                <th key={i}>{cell}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, ri) => (
              <tr key={ri}>
                {r.map((cell, ci) => (
                  <td key={ci}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  try {
    const parsed: unknown = JSON.parse(code)
    return (
      <div className="ch-ap-data-wrap ch-ap-data-json">
        <JsonNode value={parsed} />
      </div>
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return <div className="ch-ap-data-error">JSON 解析失败：{msg}</div>
  }
}

/**
 * 监听 `data-theme` 变化，驱动 CodeMirror 明暗主题切换。
 */
function useIsDarkTheme(): boolean {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    setDark(isDark())
    const observer = new MutationObserver(() => setDark(isDark()))
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

/**
 * Artifact 面板（右侧滑出）。
 *
 * 面板容器始终挂载（哪怕从未打开过），只有内容随 store 的 payload 变化而更新。
 * 若改成"仅 open 时才挂载"，首次打开会因为 DOM 节点创建与祖先 `.ap-open` 类的应用
 * 发生在同一次 React commit 里，浏览器没有"关闭态"的前一帧可供过渡，滑入动画会直接跳变；
 * 关闭时同理会立刻卸载导致滑出动画被打断。保持常驻挂载 + 记住最后一次 payload，
 * 才能让每次打开/关闭都成为已存在节点上的一次真实样式变化，交给 CSS transition 处理。
 *
 * 全部新增状态（控制台消息、全屏、编辑中的代码）均为组件本地 state，绝不写回 store。
 * 订阅 `useArtifactStore`：
 * - `mode === 'view'`：只读代码展示，可切换 CodeMirror 编辑
 * - `mode === 'run'`：数据语言走面板内数据预览，其余走 iframe `srcdoc` 沙箱
 */
export function ArtifactPanel(): JSX.Element {
  const open = useArtifactStore((s) => s.open)
  const payload = useArtifactStore((s) => s.payload)
  const openView = useArtifactStore((s) => s.openView)
  const openRun = useArtifactStore((s) => s.openRun)
  const close = useArtifactStore((s) => s.close)
  const [copied, setCopied] = useState(false)
  const [shown, setShown] = useState<ArtifactPayload>(EMPTY_PAYLOAD)
  const [fullscreen, setFullscreen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editedCode, setEditedCode] = useState('')
  const [consoleMsgs, setConsoleMsgs] = useState<ConsoleEntry[]>([])
  const [consoleOpen, setConsoleOpen] = useState(false)
  const dark = useIsDarkTheme()

  // payload 变化：同步展示内容，并重置编辑态（新内容不应残留上一次的编辑草稿）
  useEffect(() => {
    if (payload) {
      setShown(payload)
      setEditedCode(payload.code)
      setEditing(false)
    }
  }, [payload])

  const isData = isDataPreviewLang(shown.lang)
  const runnable = isRunnableLang(shown.lang)

  const srcdoc = useMemo(() => {
    if (shown.mode !== 'run' || isData) return ''
    return buildRunSrcDoc(shown.lang, shown.code)
  }, [shown, isData])

  // 每次运行（srcdoc 变化）都清空控制台，避免上一次运行的日志串档
  useEffect(() => {
    setConsoleMsgs([])
  }, [srcdoc])

  // 监听 iframe 控制台桥消息；入站数据一律不可信，校验后入列并限长
  useEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      const entry = parseConsoleMessage(e.data)
      if (!entry) return
      setConsoleMsgs((prev) => {
        const next = [...prev, entry]
        return next.length > CONSOLE_MAX ? next.slice(next.length - CONSOLE_MAX) : next
      })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const currentCode = editing ? editedCode : shown.code
  const lineCount = currentCode.split('\n').length

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(currentCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* 忽略权限失败 */
    }
  }

  const errorCount = consoleMsgs.filter((m) => m.level === 'error').length

  return (
    <div
      className={`ch-artifact-panel${fullscreen ? 'ch-ap-fullscreen' : ''}`}
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
              onClick={() => openRun({ title: shown.title, lang: shown.lang, code: currentCode })}
              title="运行代码"
              aria-label="运行代码"
            >
              <Play size={16} />
            </button>
          )}
          {isData && shown.mode === 'view' && (
            <button
              className="ch-ib"
              onClick={() => openRun({ title: shown.title, lang: shown.lang, code: currentCode })}
              title="数据预览"
              aria-label="数据预览"
            >
              <Table2 size={16} />
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
          {shown.mode === 'view' && (
            <button
              className={`ch-ib${editing ? 'active' : ''}`}
              onClick={() => setEditing((v) => !v)}
              title={editing ? '结束编辑' : '编辑代码'}
              aria-label={editing ? '结束编辑' : '编辑代码'}
            >
              <Pencil size={16} />
            </button>
          )}
          {editing && runnable && (
            <button
              className="ch-ib"
              onClick={() => openRun({ title: shown.title, lang: shown.lang, code: editedCode })}
              title="重新运行"
              aria-label="重新运行"
            >
              <Play size={16} />
            </button>
          )}
          <button
            className={`ch-ib${consoleOpen ? 'active' : ''}`}
            onClick={() => setConsoleOpen((v) => !v)}
            title="控制台"
            aria-label="控制台"
          >
            <Terminal size={16} />
          </button>
          <button
            className="ch-ib"
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? '退出全屏' : '全屏'}
            aria-label={fullscreen ? '退出全屏' : '全屏'}
          >
            {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button className="ch-ib" onClick={close} title="关闭面板" aria-label="关闭面板">
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="ch-ap-body">
        {shown.mode === 'view' ? (
          editing ? (
            <CodeMirror
              className="ch-ap-cm"
              value={editedCode}
              extensions={langExtensions(shown.lang)}
              theme={dark ? 'dark' : 'light'}
              onChange={(v: string) => setEditedCode(v)}
              height="100%"
            />
          ) : (
            <CodeHighlight lang={shown.lang} code={shown.code} fontSize="12px" lineHeight={1.6} />
          )
        ) : isData ? (
          <DataPreview lang={shown.lang} code={shown.code} />
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
      {consoleOpen && (
        <div className="ch-ap-console">
          <div className="ch-ap-console-head">
            <span className="ch-ap-console-title">
              控制台{errorCount > 0 ? ` · ${errorCount} 错误` : ''}
            </span>
            <button
              className="ch-ap-console-clear"
              onClick={() => setConsoleMsgs([])}
              aria-label="清空控制台"
            >
              清空
            </button>
          </div>
          <div className="ch-ap-console-body">
            {consoleMsgs.length === 0 ? (
              <div className="ch-ap-console-empty">暂无输出</div>
            ) : (
              consoleMsgs.map((m, i) => (
                <div key={i} className={`ch-ap-console-row ch-ap-console-${m.level}`}>
                  {m.text}
                </div>
              ))
            )}
          </div>
        </div>
      )}
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
