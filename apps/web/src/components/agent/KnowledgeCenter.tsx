'use client'

import { useState, type FormEvent, type JSX } from 'react'
import type { KnowledgeDocument } from '@yuanai/types'
import {
  useCreateKnowledgeBase,
  useCreateKnowledgeTextSource,
  useKnowledgeBases,
  useKnowledgeSources,
  useKnowledgeSearch,
  usePublishKnowledgeDocument,
} from '@yuanai/core/hooks'
import { useTranslations } from '@/i18n/client'
import './knowledge.css'

/** 提供知识库、纯文本来源、发布和测试检索的 Web 管理界面。 */
export default function KnowledgeCenter(): JSX.Element {
  const t = useTranslations('knowledge')
  const bases = useKnowledgeBases()
  const createBase = useCreateKnowledgeBase()
  const createSource = useCreateKnowledgeTextSource()
  const publish = usePublishKnowledgeDocument()
  const [baseName, setBaseName] = useState('')
  const [selectedBaseId, setSelectedBaseId] = useState('')
  const [sourceName, setSourceName] = useState('')
  const [sourceUri, setSourceUri] = useState('')
  const [content, setContent] = useState('')
  const [document, setDocument] = useState<KnowledgeDocument | null>(null)
  const [query, setQuery] = useState('')
  const [searchInput, setSearchInput] = useState<{ query: string } | null>(null)
  const sources = useKnowledgeSources(selectedBaseId)
  const search = useKnowledgeSearch(selectedBaseId, searchInput)

  const submitBase = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const name = baseName.trim()
    if (!name) return
    createBase.mutate({ name }, { onSuccess: (base) => setSelectedBaseId(base.id) })
    setBaseName('')
  }

  const submitSource = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const name = sourceName.trim()
    const text = content.trim()
    if (!selectedBaseId || !name || !text) return
    const sourceUriValue = sourceUri.trim()
    createSource.mutate(
      {
        knowledgeBaseId: selectedBaseId,
        input: sourceUriValue
          ? { name, content: text, sourceUri: sourceUriValue }
          : { name, content: text },
      },
      {
        onSuccess: (created) => {
          setDocument(created)
          setSourceName('')
          setSourceUri('')
          setContent('')
        },
      }
    )
  }

  const submitSearch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const value = query.trim()
    if (!selectedBaseId || !value) return
    setSearchInput({ query: value })
  }

  const publishDocument = (): void => {
    if (!document || !selectedBaseId) return
    publish.mutate(
      { knowledgeBaseId: selectedBaseId, sourceId: document.sourceId, documentId: document.id },
      { onSuccess: setDocument }
    )
  }

  return (
    <main className="knowledge-shell">
      <header className="knowledge-header">
        <div>
          <span className="knowledge-eyebrow">{t('agent')}</span>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
      </header>

      <section className="knowledge-section" aria-labelledby="knowledge-bases-title">
        <div className="knowledge-section-heading">
          <h2 id="knowledge-bases-title">{t('bases')}</h2>
          <form className="knowledge-inline-form" onSubmit={submitBase}>
            <input
              aria-label={t('baseName')}
              onChange={(event) => setBaseName(event.target.value)}
              placeholder={t('baseName')}
              required
              value={baseName}
            />
            <button
              className="knowledge-button knowledge-button--primary"
              disabled={createBase.isPending}
              type="submit"
            >
              {t('createBase')}
            </button>
          </form>
        </div>
        {bases.isLoading ? <p className="knowledge-muted">{t('loading')}</p> : null}
        {!bases.isLoading && (bases.data?.length ?? 0) === 0 ? (
          <p className="knowledge-muted">{t('empty')}</p>
        ) : null}
        <ul className="knowledge-base-list">
          {(bases.data ?? []).map((base) => (
            <li key={base.id}>
              <button
                aria-pressed={selectedBaseId === base.id}
                className={`knowledge-base ${selectedBaseId === base.id ? 'is-selected' : ''}`}
                onClick={() => {
                  setSelectedBaseId(base.id)
                  setDocument(null)
                  setSearchInput(null)
                }}
                type="button"
              >
                <strong>{base.name}</strong>
                <span>{base.spaceId ?? t('personal')}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="knowledge-section knowledge-workspace" aria-label={t('workspace')}>
        <form className="knowledge-form" onSubmit={submitSource}>
          <h2>{t('addTextSource')}</h2>
          <label>
            {t('sourceName')}
            <input
              disabled={!selectedBaseId}
              onChange={(event) => setSourceName(event.target.value)}
              required
              value={sourceName}
            />
          </label>
          <label>
            {t('sourceUri')}
            <input
              disabled={!selectedBaseId}
              onChange={(event) => setSourceUri(event.target.value)}
              value={sourceUri}
            />
          </label>
          <label>
            {t('content')}
            <textarea
              disabled={!selectedBaseId}
              onChange={(event) => setContent(event.target.value)}
              required
              value={content}
            />
          </label>
          <button
            className="knowledge-button knowledge-button--primary"
            disabled={!selectedBaseId || createSource.isPending}
            type="submit"
          >
            {t('stageSource')}
          </button>
        </form>

        <div className="knowledge-publish">
          <h2>{t('version')}</h2>
          {document ? (
            <>
              <p>{t(document.status)}</p>
              <p className="knowledge-muted">{t('versionNumber', { version: document.version })}</p>
              {document.status === 'staged' ? (
                <button
                  className="knowledge-button"
                  disabled={publish.isPending}
                  onClick={publishDocument}
                  type="button"
                >
                  {t('publish')}
                </button>
              ) : null}
            </>
          ) : (
            <p className="knowledge-muted">{t('noVersion')}</p>
          )}
          {(sources.data ?? []).flatMap((source) =>
            source.documents.map((version) => (
              <button
                className="knowledge-button"
                key={version.id}
                onClick={() => setDocument(version)}
                type="button"
              >
                {source.name} · {t('versionNumber', { version: version.version })} ·{' '}
                {t(version.status)}
              </button>
            ))
          )}
        </div>
      </section>

      <section className="knowledge-section" aria-labelledby="knowledge-search-title">
        <h2 id="knowledge-search-title">{t('testSearch')}</h2>
        <form className="knowledge-inline-form" onSubmit={submitSearch}>
          <input
            aria-label={t('searchPlaceholder')}
            disabled={!selectedBaseId}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            required
            value={query}
          />
          <button
            className="knowledge-button knowledge-button--primary"
            disabled={!selectedBaseId}
            type="submit"
          >
            {t('search')}
          </button>
        </form>
        {search.isFetching ? <p className="knowledge-muted">{t('searching')}</p> : null}
        {searchInput && !search.isFetching && (search.data?.length ?? 0) === 0 ? (
          <p className="knowledge-muted">{t('noResults')}</p>
        ) : null}
        <ul className="knowledge-citations">
          {(search.data ?? []).map((citation) => (
            <li key={`${citation.documentId}-${citation.chunkIndex}`}>
              <div>
                <strong>{citation.sourceName}</strong>
                <span>
                  {t('citationLocation', {
                    version: citation.documentVersion,
                    section: citation.section ?? t('body'),
                  })}
                </span>
              </div>
              <p>{citation.content}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
