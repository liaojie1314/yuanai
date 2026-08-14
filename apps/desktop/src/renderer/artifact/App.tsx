import { Check, Copy, Eye, Play, Terminal } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ARTIFACT_MSG_SOURCE,
  buildRunSrcDoc,
  isDataPreviewLang,
  isRunnableLang,
} from '@yuanai/core/utils'
import type { DesktopArtifactPayload, DesktopCodeArtifactPayload } from '../../shared/ipc-contract'
import { copyText } from '../shared/clipboard'
import { CodeHighlight } from '../shared/CodeHighlight'
import '../shared/i18n'

import { DataPreview } from './DataPreview'

import './artifact.css'

const CONSOLE_MAX_ENTRIES = 200
type ConsoleLevel = 'log' | 'info' | 'warn' | 'error'

interface ConsoleEntry {
  level: ConsoleLevel
  text: string
}

function isJavascriptLang(lang: string): boolean {
  const normalized = lang.trim().toLowerCase()
  return (
    normalized === 'js' ||
    normalized === 'javascript' ||
    normalized === 'mjs' ||
    normalized === 'cjs'
  )
}

function parseConsoleEntry(value: unknown): ConsoleEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  if (candidate.source !== ARTIFACT_MSG_SOURCE) return null
  const level = candidate.level
  if (level !== 'log' && level !== 'info' && level !== 'warn' && level !== 'error') return null
  return { level, text: typeof candidate.text === 'string' ? candidate.text : '' }
}

function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.setAttribute('data-theme', theme)
}

function isFilePreviewPayload(
  payload: DesktopArtifactPayload
): payload is Extract<DesktopArtifactPayload, { kind: 'file-preview' }> {
  return payload.kind === 'file-preview'
}

/** 独立 Artifact 窗口，在同一窗口内切换源码展示和隔离运行预览。 */
export function App(): ReactElement {
  const { t } = useTranslation()
  const [payload, setPayload] = useState<DesktopArtifactPayload | null>(null)
  const [copied, setCopied] = useState(false)
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([])
  const [isConsoleOpen, setIsConsoleOpen] = useState(false)
  const [isDarkTheme, setIsDarkTheme] = useState(false)

  useEffect(
    () =>
      window.yuanai.events.onArtifactInit((nextPayload) => {
        setPayload(nextPayload)
        setCopied(false)
        setConsoleEntries([])
        setIsConsoleOpen(
          !isFilePreviewPayload(nextPayload) &&
            nextPayload.mode === 'run' &&
            isJavascriptLang(nextPayload.lang)
        )
        const theme = nextPayload.theme ?? 'light'
        applyTheme(theme)
        setIsDarkTheme(theme === 'dark')
      }),
    []
  )

  useEffect(() => {
    const synchronizeTheme = (): void => {
      setIsDarkTheme(document.documentElement.dataset.theme === 'dark')
    }
    synchronizeTheme()
    const observer = new MutationObserver(synchronizeTheme)
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>): void => {
      const entry = parseConsoleEntry(event.data)
      if (!entry) return
      setConsoleEntries((entries) => {
        const next = [...entries, entry]
        return next.length > CONSOLE_MAX_ENTRIES ? next.slice(-CONSOLE_MAX_ENTRIES) : next
      })
      setIsConsoleOpen(true)
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const srcDoc = useMemo(() => {
    if (!payload || isFilePreviewPayload(payload)) return ''
    if (payload.mode !== 'run' || !isRunnableLang(payload.lang)) return ''
    return buildRunSrcDoc(payload.lang, payload.code, { dark: isDarkTheme })
  }, [isDarkTheme, payload])

  if (!payload) return <main className="artifact__empty">{t('desktop.artifact.preparing')}</main>

  const shown = payload
  if (isFilePreviewPayload(shown)) {
    const isPdf = shown.mimeType === 'application/pdf'
    return (
      <main className="artifact" aria-label={`文件预览 ${shown.title}`} tabIndex={-1}>
        <header className="artifact__header">
          <div>
            <h1>{shown.title}</h1>
            <p>{isPdf ? 'PDF' : shown.mimeType}</p>
          </div>
          <span className="artifact__mode">文件预览</span>
        </header>
        <section className="artifact__content artifact__content--file">
          {isPdf ? (
            <iframe
              className="artifact__file-frame"
              sandbox="allow-downloads"
              src={shown.sourceUrl}
              title={`预览 ${shown.title}`}
            />
          ) : (
            <img className="artifact__file-image" src={shown.sourceUrl} alt={shown.title} />
          )}
        </section>
      </main>
    )
  }

  const codeArtifact: DesktopCodeArtifactPayload = shown
  const runnable = isRunnableLang(codeArtifact.lang)
  const dataPreview = isDataPreviewLang(codeArtifact.lang)
  const previewable = runnable || dataPreview

  function switchMode(mode: DesktopCodeArtifactPayload['mode']): void {
    setPayload((current) => {
      if (!current || isFilePreviewPayload(current)) return current
      setConsoleEntries([])
      setIsConsoleOpen(mode === 'run' && isJavascriptLang(current.lang))
      return { ...current, mode }
    })
  }

  function handleCopy(): void {
    void copyText(codeArtifact.code).then((didCopy) => {
      if (!didCopy) return
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <main className="artifact" aria-label="Artifact 预览" tabIndex={-1}>
      <header className="artifact__header">
        <div>
          <h1>{codeArtifact.title}</h1>
          <p>{codeArtifact.lang || 'Code'}</p>
        </div>
        <div className="artifact__actions">
          {codeArtifact.mode === 'view' && previewable ? (
            <button
              type="button"
              aria-label={
                dataPreview ? t('desktop.artifact.dataPreview') : t('desktop.artifact.runPreview')
              }
              title={
                dataPreview ? t('desktop.artifact.dataPreview') : t('desktop.artifact.runPreview')
              }
              onClick={() => switchMode('run')}
            >
              <Play size={16} aria-hidden="true" />
            </button>
          ) : null}
          {codeArtifact.mode === 'run' ? (
            <button
              type="button"
              aria-label={t('desktop.artifact.viewSource')}
              title={t('desktop.artifact.viewSource')}
              onClick={() => switchMode('view')}
            >
              <Eye size={16} aria-hidden="true" />
            </button>
          ) : null}
          {codeArtifact.mode === 'run' && runnable ? (
            <button
              type="button"
              className={isConsoleOpen ? 'is-active' : undefined}
              aria-label={t('desktop.artifact.output')}
              title={t('desktop.artifact.output')}
              onClick={() => setIsConsoleOpen((current) => !current)}
            >
              <Terminal size={16} aria-hidden="true" />
            </button>
          ) : null}
          <span className="artifact__mode">
            {codeArtifact.mode === 'run'
              ? dataPreview
                ? t('desktop.artifact.dataPreview')
                : t('desktop.artifact.runPreview')
              : t('desktop.artifact.codeView')}
          </span>
        </div>
      </header>
      <section
        className={
          codeArtifact.mode === 'run' && runnable
            ? 'artifact__content artifact__content--run'
            : 'artifact__content'
        }
      >
        {codeArtifact.mode === 'run' && dataPreview ? (
          <DataPreview lang={codeArtifact.lang} code={codeArtifact.code} />
        ) : codeArtifact.mode === 'run' ? (
          <>
            <iframe
              className="artifact__frame"
              sandbox="allow-scripts allow-forms"
              srcDoc={srcDoc}
              title={`${codeArtifact.title} ${t('desktop.artifact.preview')}`}
            />
            {isConsoleOpen ? (
              <aside className="artifact__console" aria-label={t('desktop.artifact.output')}>
                <header>
                  <span>{t('desktop.artifact.output')}</span>
                  <button
                    type="button"
                    disabled={consoleEntries.length === 0}
                    onClick={() => setConsoleEntries([])}
                  >
                    {t('desktop.artifact.clear')}
                  </button>
                </header>
                <div className="artifact__console-body">
                  {consoleEntries.length === 0 ? (
                    <span className="artifact__console-empty">
                      {t('desktop.artifact.noOutput')}
                    </span>
                  ) : (
                    consoleEntries.map((entry, index) => (
                      <p key={`${entry.level}-${index}`} data-level={entry.level}>
                        {entry.text}
                      </p>
                    ))
                  )}
                </div>
              </aside>
            ) : null}
          </>
        ) : (
          <CodeHighlight
            lang={codeArtifact.lang}
            code={codeArtifact.code}
            className="artifact__code"
            padding="16px"
            fontSize="13px"
            lineHeight={1.65}
          />
        )}
      </section>
      <footer className="artifact__footer">
        <button type="button" onClick={handleCopy}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied ? t('common.copied') : t('desktop.artifact.copyCode')}
        </button>
        <span>
          {codeArtifact.lang || 'Code'} ·{' '}
          {t('desktop.artifact.lines', { count: codeArtifact.code.split('\n').length })}
        </span>
      </footer>
    </main>
  )
}
