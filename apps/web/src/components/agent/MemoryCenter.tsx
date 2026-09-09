'use client'

import { useState, type FormEvent, type JSX } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Memory } from '@yuanai/types'
import { listAssistants } from '@yuanai/core/api'
import { useCreateMemory, useDeleteMemory, useMemories, useUpdateMemory } from '@yuanai/core/hooks'
import { useTranslations } from '@/i18n/client'
import './memories.css'

const STATUSES: readonly Memory['status'][] = [
  'candidate',
  'active',
  'rejected',
  'superseded',
  'expired',
]

/** 展示并管理当前用户的记忆及其生命周期。 */
export default function MemoryCenter(): JSX.Element {
  const t = useTranslations('memories')
  const [status, setStatus] = useState<Memory['status'] | undefined>()
  const [content, setContent] = useState('')
  const assistants = useQuery({ queryKey: ['assistants'], queryFn: listAssistants })
  const assistant = assistants.data?.find((item) => item.isDefault) ?? assistants.data?.[0]
  const memories = useMemories(status)
  const create = useCreateMemory()
  const update = useUpdateMemory()
  const remove = useDeleteMemory()

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const value = content.trim()
    if (!value) return
    if (!assistant) return
    create.mutate({
      assistantId: assistant.id,
      content: value,
      memoryType: 'preference',
      sourceType: 'user_input',
    })
    setContent('')
  }

  return (
    <main className="memory-shell">
      <header className="memory-header">
        <div>
          <span className="memory-eyebrow">Agent</span>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
      </header>
      <form className="memory-create" onSubmit={submit}>
        <input
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder={t('createPlaceholder')}
          aria-label={t('createPlaceholder')}
        />
        <button
          className="memory-btn memory-btn--primary"
          type="submit"
          disabled={create.isPending || !assistant}
        >
          {t('create')}
        </button>
      </form>
      <nav className="memory-filters" aria-label={t('status')}>
        <button
          className={!status ? 'is-active' : ''}
          onClick={() => setStatus(undefined)}
          type="button"
        >
          {t('status')}
        </button>
        {STATUSES.map((item) => (
          <button
            key={item}
            className={status === item ? 'is-active' : ''}
            onClick={() => setStatus(item)}
            type="button"
          >
            {t(item)}
          </button>
        ))}
      </nav>
      {memories.isLoading ? <p className="memory-muted">{t('loading')}</p> : null}
      {!memories.isLoading && (memories.data?.length ?? 0) === 0 ? (
        <p className="memory-muted">{t('empty')}</p>
      ) : null}
      <ul className="memory-list">
        {(memories.data ?? []).map((memory) => (
          <li className="memory-card" key={memory.id}>
            <div className="memory-card-head">
              <span className="memory-badge">{t(memory.status)}</span>
              <span className="memory-muted">{t(memory.memoryType)}</span>
            </div>
            <p>{memory.content}</p>
            <small>
              {t('source')}: {memory.sourceType}
            </small>
            <div className="memory-actions">
              {memory.status === 'candidate' ? (
                <>
                  <button
                    className="memory-btn"
                    onClick={() => update.mutate({ id: memory.id, input: { status: 'active' } })}
                    type="button"
                  >
                    {t('confirm')}
                  </button>
                  <button
                    className="memory-btn"
                    onClick={() => update.mutate({ id: memory.id, input: { status: 'rejected' } })}
                    type="button"
                  >
                    {t('reject')}
                  </button>
                </>
              ) : null}
              <button
                className="memory-btn memory-btn--danger"
                onClick={() => {
                  if (window.confirm(t('confirmDelete'))) remove.mutate(memory.id)
                }}
                type="button"
              >
                {t('delete')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  )
}
