'use client'

import { useEffect, useRef, useState, type JSX } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Persona, PersonaInput, PersonaTone, PersonaVerbosity } from '@yuanai/types'
import {
  acceptPersonaCandidate,
  getPersona,
  getPersonaPreview,
  listPersonaCandidates,
  listPersonaVersions,
  rejectPersonaCandidate,
  rollbackPersona,
  updatePersona,
} from '@yuanai/core/api'
import { useTranslations } from '@/i18n/client'
import { resolveApiErrorMessage } from '@/lib/apiError'
import './persona.css'

const TONES: readonly PersonaTone[] = ['concise', 'patient', 'lively', 'rigorous']
const VERBOSITIES: readonly PersonaVerbosity[] = ['brief', 'balanced', 'detailed']
const LANGUAGES: readonly string[] = ['zh-CN', 'en']

/** 与后端 `ForbiddenTopic` / `MAX_FORBIDDEN_TOPICS` 对齐，前端先拦住以免白跑一次 422。 */
const MAX_FORBIDDEN_TOPICS = 20
const MAX_FORBIDDEN_TOPIC_LENGTH = 40
/** 表单改动到发预览请求的间隔，避免每敲一个字符就打一次后端。 */
const PREVIEW_DEBOUNCE_MS = 300

/** 编辑器内部的表单形状；禁止话题在界面上是多行文本，保存前才拆成数组。 */
interface PersonaForm {
  addressUser: string
  selfName: string
  tone: PersonaTone
  verbosity: PersonaVerbosity
  greeting: string
  refusalStyle: string
  forbiddenTopicsText: string
  language: string
}

/** 把后端人格铺进表单。 */
function toForm(persona: Persona): PersonaForm {
  return {
    addressUser: persona.addressUser,
    selfName: persona.selfName,
    tone: persona.tone,
    verbosity: persona.verbosity,
    greeting: persona.greeting,
    refusalStyle: persona.refusalStyle,
    forbiddenTopicsText: persona.forbiddenTopics.join('\n'),
    language: persona.language,
  }
}

/** 逐行拆出禁止话题，丢掉空行。 */
function parseForbiddenTopics(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/** 把表单折回接口入参，保存与预览共用同一份，避免两处漂移。 */
function toInput(form: PersonaForm): PersonaInput {
  return {
    addressUser: form.addressUser,
    selfName: form.selfName,
    tone: form.tone,
    verbosity: form.verbosity,
    greeting: form.greeting,
    refusalStyle: form.refusalStyle,
    forbiddenTopics: parseForbiddenTopics(form.forbiddenTopicsText),
    language: form.language,
  }
}

/** 编辑单个助理的人格：表单、后端装配的预览、版本回滚与候选收件箱。 */
export default function PersonaEditor({ assistantId }: { assistantId: string }): JSX.Element {
  const t = useTranslations('assistants.persona')
  // 错误文案挂在语言包根的 errors 命名空间，与记忆中心共用一份
  const tRoot = useTranslations()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<PersonaForm | null>(null)
  const [previewDraft, setPreviewDraft] = useState<PersonaInput | null>(null)

  const personaQuery = useQuery({
    queryKey: ['persona', assistantId],
    queryFn: () => getPersona(assistantId),
  })
  const versionsQuery = useQuery({
    queryKey: ['persona-versions', assistantId],
    queryFn: () => listPersonaVersions(assistantId),
  })
  const candidatesQuery = useQuery({
    queryKey: ['persona-candidates', 'pending'],
    queryFn: () => listPersonaCandidates('pending'),
  })
  const previewQuery = useQuery({
    queryKey: ['persona-preview', assistantId, previewDraft],
    queryFn: () => getPersonaPreview(assistantId, previewDraft ?? undefined),
    enabled: previewDraft !== null,
    // 留住上一次片段：预览空一帧读起来像人格被清空了
    placeholderData: keepPreviousData,
  })

  const persona = personaQuery.data
  // 只在换助理或服务端版本变化（保存、回滚、采用候选）后重置表单，
  // 否则任何一次普通 refetch 都会把用户正在编辑的内容冲掉
  const loadedKey = `${assistantId}:${String(persona?.version ?? '')}`
  const loadedRef = useRef('')
  useEffect(() => {
    if (!persona || loadedRef.current === loadedKey) return
    loadedRef.current = loadedKey
    setForm(toForm(persona))
  }, [persona, loadedKey])

  // 首次加载立刻出预览，之后每次表单改动防抖再请求
  const primedRef = useRef(false)
  useEffect(() => {
    if (form === null) return undefined
    const draft = toInput(form)
    if (!primedRef.current) {
      primedRef.current = true
      setPreviewDraft(draft)
      return undefined
    }
    const timer = setTimeout(() => setPreviewDraft(draft), PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [form])

  const invalidatePersona = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['persona', assistantId] }),
      queryClient.invalidateQueries({ queryKey: ['persona-versions', assistantId] }),
      queryClient.invalidateQueries({ queryKey: ['persona-candidates'] }),
    ])
  }

  const save = useMutation({
    mutationFn: (input: PersonaInput) => updatePersona(assistantId, input),
    onSuccess: invalidatePersona,
  })
  const rollback = useMutation({
    mutationFn: (version: number) => rollbackPersona(assistantId, version),
    onSuccess: invalidatePersona,
  })
  const accept = useMutation({
    mutationFn: (id: string) => acceptPersonaCandidate(id),
    onSuccess: invalidatePersona,
  })
  const reject = useMutation({
    mutationFn: (id: string) => rejectPersonaCandidate(id),
    onSuccess: invalidatePersona,
  })

  const failure = save.error ?? rollback.error ?? accept.error ?? reject.error
  const candidates = (candidatesQuery.data ?? []).filter(
    (candidate) => candidate.assistantId === assistantId
  )

  if (!form) return <p className="persona-muted">{t('loading')}</p>

  const topics = parseForbiddenTopics(form.forbiddenTopicsText)
  const topicError =
    topics.length > MAX_FORBIDDEN_TOPICS
      ? t('forbiddenTopicsTooMany')
      : topics.some((topic) => topic.length > MAX_FORBIDDEN_TOPIC_LENGTH)
        ? t('forbiddenTopicsTooLong')
        : null
  const patch = (next: Partial<PersonaForm>): void => setForm({ ...form, ...next })
  const preview = previewQuery.data

  return (
    <section className="persona-editor">
      <header className="persona-editor-head">
        <h2>{t('title')}</h2>
        <p className="persona-muted">{t('subtitle')}</p>
      </header>
      {failure ? (
        <p className="persona-alert" role="alert">
          {resolveApiErrorMessage(failure, tRoot)}
        </p>
      ) : null}
      <div className="persona-editor-body">
        <form
          className="persona-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (topicError === null) save.mutate(toInput(form))
          }}
        >
          <label className="persona-field">
            {t('addressUser')}
            <input
              maxLength={40}
              onChange={(event) => patch({ addressUser: event.target.value })}
              value={form.addressUser}
            />
          </label>
          <label className="persona-field">
            {t('selfName')}
            <input
              maxLength={40}
              onChange={(event) => patch({ selfName: event.target.value })}
              value={form.selfName}
            />
          </label>
          <label className="persona-field">
            {t('tone')}
            <select
              onChange={(event) => patch({ tone: event.target.value as PersonaTone })}
              value={form.tone}
            >
              {TONES.map((tone) => (
                <option key={tone} value={tone}>
                  {t(`tone.${tone}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="persona-field">
            {t('verbosity')}
            <select
              onChange={(event) => patch({ verbosity: event.target.value as PersonaVerbosity })}
              value={form.verbosity}
            >
              {VERBOSITIES.map((verbosity) => (
                <option key={verbosity} value={verbosity}>
                  {t(`verbosity.${verbosity}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="persona-field">
            {t('language')}
            <select
              onChange={(event) => patch({ language: event.target.value })}
              value={form.language}
            >
              {LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {t(`language.${language}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="persona-field persona-field--wide">
            {t('greeting')}
            <textarea
              maxLength={500}
              onChange={(event) => patch({ greeting: event.target.value })}
              rows={2}
              value={form.greeting}
            />
          </label>
          <label className="persona-field persona-field--wide">
            {t('refusalStyle')}
            <textarea
              maxLength={500}
              onChange={(event) => patch({ refusalStyle: event.target.value })}
              rows={2}
              value={form.refusalStyle}
            />
          </label>
          <label className="persona-field persona-field--wide">
            {t('forbiddenTopics')}
            <textarea
              onChange={(event) => patch({ forbiddenTopicsText: event.target.value })}
              rows={3}
              value={form.forbiddenTopicsText}
            />
          </label>
          <p className="persona-field-hint persona-field--wide">{t('forbiddenTopicsHint')}</p>
          {topicError !== null ? (
            <p className="persona-alert persona-field--wide">{topicError}</p>
          ) : null}
          <div className="persona-form-actions">
            <button
              className="persona-btn persona-btn--primary"
              disabled={save.isPending || topicError !== null}
              type="submit"
            >
              {save.isPending ? t('saving') : t('save')}
            </button>
            {save.isSuccess && !save.isPending ? (
              <span className="persona-muted" role="status">
                {t('saved', { version: save.data.version })}
              </span>
            ) : null}
          </div>
        </form>
        <aside className="persona-preview">
          <h3>{t('preview')}</h3>
          <p className="persona-field-hint">{t('previewHint')}</p>
          {/* 预览只渲染后端返回的 fragment：前端自己重拼就要复制一份截断规则，
              两边一旦漂移，预览就在对用户撒谎 */}
          {preview === undefined ? (
            <p className="persona-muted">{t('previewLoading')}</p>
          ) : preview.fragment === '' ? (
            <p className="persona-muted">{t('previewEmpty')}</p>
          ) : (
            <pre className="persona-fragment">{preview.fragment}</pre>
          )}
          {preview?.truncated === true ? (
            <p className="persona-alert">{t('truncated', { budget: preview.characterBudget })}</p>
          ) : preview ? (
            <p className="persona-field-hint">{t('budget', { budget: preview.characterBudget })}</p>
          ) : null}
        </aside>
      </div>
      <section className="persona-section">
        <h3>{t('candidates')}</h3>
        <p className="persona-field-hint">{t('candidatesHint')}</p>
        {candidates.length === 0 ? (
          <p className="persona-muted">{t('candidatesEmpty')}</p>
        ) : (
          <ul className="persona-list">
            {candidates.map((candidate) => (
              <li className="persona-card" key={candidate.id}>
                <div className="persona-card-head">
                  <span className="persona-badge">{candidate.field}</span>
                  <strong>{candidate.suggestedValue}</strong>
                </div>
                <p>{candidate.evidence}</p>
                <div className="persona-card-actions">
                  <button
                    className="persona-btn"
                    disabled={accept.isPending}
                    onClick={() => accept.mutate(candidate.id)}
                    type="button"
                  >
                    {t('accept')}
                  </button>
                  <button
                    className="persona-btn"
                    disabled={reject.isPending}
                    onClick={() => reject.mutate(candidate.id)}
                    type="button"
                  >
                    {t('reject')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="persona-section">
        <h3>{t('versions')}</h3>
        {(versionsQuery.data ?? []).length === 0 ? (
          <p className="persona-muted">{t('versionsEmpty')}</p>
        ) : (
          <ul className="persona-list">
            {(versionsQuery.data ?? []).map((item) => (
              <li className="persona-card persona-card--row" key={item.version}>
                <span className="persona-badge">{t('version', { version: item.version })}</span>
                <span className="persona-muted">{item.changeReason}</span>
                <button
                  aria-label={t('rollbackTo', { version: item.version })}
                  className="persona-btn"
                  disabled={rollback.isPending}
                  onClick={() => rollback.mutate(item.version)}
                  type="button"
                >
                  {t('rollback')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  )
}
