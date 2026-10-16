'use client'

import { useState, type FormEvent, type JSX } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Bot } from 'lucide-react'
import type { Assistant } from '@yuanai/types'
import { createAssistant, deleteAssistant, updateAssistant } from '@yuanai/core/api'
import { useAssistants, useModels } from '@yuanai/core/hooks'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useTranslations } from '@/i18n/client'
import { resolveApiErrorMessage } from '@/lib/apiError'
import PersonaEditor from './PersonaEditor'
import './persona.css'

/** 助理列表、创建与删除，并在选中的助理下方挂出人格编辑器。 */
export default function AssistantCenter(): JSX.Element {
  const t = useTranslations('assistants')
  // 错误文案挂在语言包根的 errors 命名空间，与记忆中心共用一份
  const tRoot = useTranslations()
  const queryClient = useQueryClient()
  const assistants = useAssistants()
  const models = useModels()
  const [name, setName] = useState('')
  const [model, setModel] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Assistant | null>(null)

  const items = assistants.data ?? []
  const defaultModel =
    model || models.data?.find((item) => item.isDefault)?.id || models.data?.[0]?.id || ''
  // 落地即选中默认助理：不选中就要多点一次才看得到人格编辑器，
  // 新用户容易以为这个页面只能改名字
  const selected =
    items.find((item) => item.id === selectedId) ?? items.find((i) => i.isDefault) ?? items[0]

  const refresh = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ['assistants'] }).then(() => undefined)

  const create = useMutation({
    mutationFn: (input: { name: string; defaultModel: string }) => createAssistant(input),
    onSuccess: async (assistant) => {
      setName('')
      setSelectedId(assistant.id)
      await refresh()
    },
  })
  const setDefault = useMutation({
    mutationFn: (id: string) => updateAssistant(id, { isDefault: true }),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteAssistant(id),
    onSuccess: async (_result, id) => {
      if (selectedId === id) setSelectedId(null)
      await refresh()
    },
  })

  const failure = create.error ?? setDefault.error ?? remove.error

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const value = name.trim()
    if (!value || !defaultModel) return
    create.mutate({ name: value, defaultModel })
  }

  return (
    <main className="persona-shell">
      <header className="persona-header">
        <div>
          <span className="persona-eyebrow">{t('agent')}</span>
          <h1>{t('title')}</h1>
          <p className="persona-muted">{t('subtitle')}</p>
        </div>
        <Bot aria-hidden="true" size={28} />
      </header>
      <div className="persona-panel">
        <section className="persona-section">
          <h2>{t('createSection')}</h2>
          <form className="persona-create" onSubmit={submit}>
            <input
              aria-label={t('name')}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('namePlaceholder')}
              value={name}
            />
            <select
              aria-label={t('defaultModel')}
              onChange={(event) => setModel(event.target.value)}
              value={defaultModel}
            >
              {(models.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <button
              className="persona-btn persona-btn--primary"
              disabled={!name.trim() || !defaultModel || create.isPending}
              type="submit"
            >
              {create.isPending ? t('creating') : t('create')}
            </button>
          </form>
        </section>
      </div>
      {failure ? (
        <p className="persona-alert" role="alert">
          {resolveApiErrorMessage(failure, tRoot)}
        </p>
      ) : null}
      {assistants.isLoading ? <p className="persona-muted">{t('loading')}</p> : null}
      {!assistants.isLoading && items.length === 0 ? (
        <div className="persona-empty">
          <Bot aria-hidden="true" size={28} />
          <p className="persona-empty-title">{t('empty')}</p>
          <p className="persona-muted">{t('emptyHint')}</p>
        </div>
      ) : null}
      <ul className="persona-list">
        {items.map((assistant) => (
          <li
            className={assistant.id === selected?.id ? 'persona-card is-active' : 'persona-card'}
            key={assistant.id}
          >
            <div className="persona-card-head">
              <strong>{assistant.name}</strong>
              {assistant.isDefault ? <span className="persona-badge">{t('isDefault')}</span> : null}
              <span className="persona-muted">{assistant.defaultModel}</span>
            </div>
            <div className="persona-card-actions">
              <button
                aria-label={t('editOf', { name: assistant.name })}
                className={assistant.id === selected?.id ? 'persona-btn is-active' : 'persona-btn'}
                onClick={() => setSelectedId(assistant.id)}
                type="button"
              >
                {assistant.id === selected?.id ? t('editing') : t('edit')}
              </button>
              {assistant.isDefault ? null : (
                <button
                  aria-label={t('setDefaultOf', { name: assistant.name })}
                  className="persona-btn"
                  disabled={setDefault.isPending}
                  onClick={() => setDefault.mutate(assistant.id)}
                  type="button"
                >
                  {t('setDefault')}
                </button>
              )}
              <button
                aria-label={t('deleteOf', { name: assistant.name })}
                className="persona-btn persona-btn--danger"
                onClick={() => setPendingDelete(assistant)}
                type="button"
              >
                {t('delete')}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {selected ? <PersonaEditor assistantId={selected.id} /> : null}
      <ConfirmDialog
        cancelText={tRoot('common.cancel')}
        confirmText={t('delete')}
        danger
        message={t('deleteMessage')}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.id)
          setPendingDelete(null)
        }}
        open={pendingDelete !== null}
        title={t('deleteTitle')}
      />
    </main>
  )
}
