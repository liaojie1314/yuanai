'use client'

import { useState, type FormEvent, type JSX } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Memory, MemoryExport, MemoryType } from '@yuanai/types'
import { listAssistants, updateAssistant } from '@yuanai/core/api'
import {
  useCreateMemory,
  useDeleteMemory,
  useExportMemories,
  useMemories,
  useUpdateMemory,
} from '@yuanai/core/hooks'
import { useTranslations } from '@/i18n/client'
import { downloadBlob } from '@/lib/fileDownload'
import './memories.css'

const STATUSES: readonly Memory['status'][] = [
  'candidate',
  'active',
  'rejected',
  'superseded',
  'expired',
]

const MEMORY_TYPES: readonly MemoryType[] = ['profile', 'preference', 'semantic', 'episodic']

/** 把导出结果交给浏览器下载。 */
function downloadExport(payload: MemoryExport): void {
  downloadBlob(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    'memories.json'
  )
}

/** 展示并管理当前用户的记忆及其生命周期。 */
export default function MemoryCenter(): JSX.Element {
  const t = useTranslations('memories')
  const [status, setStatus] = useState<Memory['status'] | undefined>()
  const [content, setContent] = useState('')
  const queryClient = useQueryClient()
  const assistants = useQuery({ queryKey: ['assistants'], queryFn: listAssistants })
  const assistant = assistants.data?.find((item) => item.isDefault) ?? assistants.data?.[0]
  const memories = useMemories(status)
  const items = memories.data?.pages.flatMap((page) => page.items) ?? []
  const create = useCreateMemory()
  const update = useUpdateMemory()
  const remove = useDeleteMemory()
  const exportAll = useExportMemories()
  const disabledTypes = assistant?.disabledMemoryTypes ?? []
  // 本机节点记忆在云端只有元数据，光看 content 为空区分不出节点是离线还是正常——由后端判定
  const localUnavailable = memories.data?.pages.some((page) => page.localUnavailable) ?? false

  const patchAssistant = useMutation({
    mutationFn: (disabledMemoryTypes: MemoryType[]) =>
      updateAssistant(assistant?.id ?? '', { disabledMemoryTypes }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['assistants'] }),
  })

  const toggleType = (type: MemoryType): void => {
    if (!assistant) return
    patchAssistant.mutate(
      disabledTypes.includes(type)
        ? disabledTypes.filter((item) => item !== type)
        : [...disabledTypes, type]
    )
  }

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
      // 后端的 create_candidate 要求每条记忆都能回溯到来源，缺 sourceId 一律 422。
      // 手动添加没有上游产物可指，就为这一次录入生成一个唯一 id，让它至少能被指认。
      // 漏掉它的后果不是报错而是静默失败：前端不渲染后端 detail 码，用户点完什么都看不到。
      sourceId: crypto.randomUUID(),
    })
    setContent('')
  }

  return (
    <main className="memory-shell">
      <header className="memory-header">
        <div>
          <span className="memory-eyebrow">{t('agent')}</span>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
        <button
          className="memory-btn"
          disabled={exportAll.isPending}
          onClick={() => exportAll.mutate(undefined, { onSuccess: downloadExport })}
          type="button"
        >
          {exportAll.isPending ? t('exporting') : t('export')}
        </button>
      </header>
      <div className="memory-types" role="group" aria-label={t('typeToggles')}>
        {MEMORY_TYPES.map((type) => {
          const off = disabledTypes.includes(type)
          return (
            <button
              key={type}
              aria-pressed={!off}
              className={off ? 'memory-btn' : 'memory-btn is-active'}
              disabled={!assistant || patchAssistant.isPending}
              onClick={() => toggleType(type)}
              type="button"
            >
              {t(type)} · {off ? t('typeDisabled') : t('typeEnabled')}
            </button>
          )
        })}
      </div>
      {exportAll.isError || patchAssistant.isError ? (
        <p className="memory-alert" role="alert">
          {t('actionFailed')}
        </p>
      ) : null}
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
      {localUnavailable ? (
        <p className="memory-banner" role="status">
          {t('localUnavailable')}
        </p>
      ) : null}
      {!memories.isLoading && items.length === 0 ? (
        <p className="memory-muted">{t('empty')}</p>
      ) : null}
      <ul className="memory-list">
        {items.map((memory) => (
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
      {memories.hasNextPage ? (
        <div className="memory-more">
          <button
            className="memory-btn"
            disabled={memories.isFetchingNextPage}
            onClick={() => void memories.fetchNextPage()}
            type="button"
          >
            {t('loadMore')}
          </button>
        </div>
      ) : null}
    </main>
  )
}
