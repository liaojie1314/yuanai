'use client'

import { useState, type FormEvent, type JSX } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Skill, SkillInstallationScope, SkillRiskCeiling, SkillVersion } from '@yuanai/types'
import { listAssistants } from '@yuanai/core/api'
import {
  useActivateSkillVersion,
  useCreateSkill,
  useCreateSkillVersion,
  useRollbackSkillVersion,
  useSkills,
  useUpdateSkillInstallation,
  useValidateSkillVersion,
} from '@yuanai/core/hooks'
import { useTranslations } from '@/i18n/client'
import './skills.css'

const RISK_CEILINGS: readonly SkillRiskCeiling[] = [
  'read',
  'local_write',
  'reversible_write',
  'external_side_effect',
  'destructive',
  'financial',
  'privileged',
]

/** 提供草稿、版本、验证和安装范围的 Web 管理界面。 */
export default function SkillCenter(): JSX.Element {
  const t = useTranslations('skills')
  const skills = useSkills()
  const assistants = useQuery({ queryKey: ['assistants'], queryFn: listAssistants })
  const create = useCreateSkill()
  const createVersion = useCreateSkillVersion()
  const validate = useValidateSkillVersion()
  const activate = useActivateSkillVersion()
  const rollback = useRollbackSkillVersion()
  const install = useUpdateSkillInstallation()
  const [target, setTarget] = useState<Skill | null>(null)
  const [slug, setSlug] = useState('')
  const [version, setVersion] = useState('1.0.0')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [requiredTools, setRequiredTools] = useState('calculate@^1')
  const [riskCeiling, setRiskCeiling] = useState<SkillRiskCeiling>('read')
  const [skillMd, setSkillMd] = useState('')
  const [scope, setScope] = useState<SkillInstallationScope>('global')
  const [assistantId, setAssistantId] = useState('')

  const isMutating =
    create.isPending ||
    createVersion.isPending ||
    validate.isPending ||
    activate.isPending ||
    rollback.isPending ||
    install.isPending
  const mutationError =
    create.isError ||
    createVersion.isError ||
    validate.isError ||
    activate.isError ||
    rollback.isError ||
    install.isError

  const resetDraft = (): void => {
    setTarget(null)
    setSlug('')
    setVersion('1.0.0')
    setName('')
    setDescription('')
    setRequiredTools('calculate@^1')
    setRiskCeiling('read')
    setSkillMd('')
  }

  const startVersion = (skill: Skill): void => {
    const current = currentVersion(skill)
    setTarget(skill)
    setSlug(skill.slug)
    setVersion('')
    setName(skill.name)
    setDescription(skill.description)
    setRequiredTools(current?.requiredTools.join('\n') ?? '')
    setRiskCeiling(current?.riskCeiling ?? 'read')
    setSkillMd(current?.skillMd ?? '')
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const manifest = buildManifest({ slug, version, name, description, requiredTools, riskCeiling })
    const input = { manifest, skillMd }
    if (target) {
      createVersion.mutate({ skillId: target.id, input }, { onSuccess: resetDraft })
    } else {
      create.mutate(input, { onSuccess: resetDraft })
    }
  }

  const installSkill = (skillId: string): void => {
    install.mutate({
      skillId,
      input: scope === 'assistant' && assistantId ? { scope, assistantId } : { scope },
    })
  }

  return (
    <main className="skill-shell">
      <header className="skill-header">
        <div>
          <span className="skill-eyebrow">{t('agent')}</span>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
        {target ? (
          <button className="skill-button" onClick={resetDraft} type="button">
            {t('cancelVersion')}
          </button>
        ) : null}
      </header>

      <form className="skill-draft" onSubmit={submit}>
        <h2>{target ? t('newVersion', { name: target.name }) : t('newSkill')}</h2>
        <div className="skill-fields skill-fields--split">
          <label>
            {t('id')}
            <input
              disabled={Boolean(target)}
              onChange={(event) => setSlug(event.target.value)}
              required
              value={slug}
            />
          </label>
          <label>
            {t('version')}
            <input
              onChange={(event) => setVersion(event.target.value)}
              pattern="^\d+\.\d+\.\d+$"
              required
              value={version}
            />
          </label>
          <label>
            {t('name')}
            <input onChange={(event) => setName(event.target.value)} required value={name} />
          </label>
          <label>
            {t('riskCeiling')}
            <select
              onChange={(event) => setRiskCeiling(event.target.value as SkillRiskCeiling)}
              value={riskCeiling}
            >
              {RISK_CEILINGS.map((item) => (
                <option key={item} value={item}>
                  {t(item)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          {t('description')}
          <input
            onChange={(event) => setDescription(event.target.value)}
            required
            value={description}
          />
        </label>
        <label>
          {t('requiredTools')}
          <textarea
            onChange={(event) => setRequiredTools(event.target.value)}
            value={requiredTools}
          />
        </label>
        <label>
          {t('instructions')}
          <textarea onChange={(event) => setSkillMd(event.target.value)} required value={skillMd} />
        </label>
        <button className="skill-button skill-button--primary" disabled={isMutating} type="submit">
          {target ? t('createVersion') : t('create')}
        </button>
      </form>

      <section className="skill-installation" aria-label={t('installationScope')}>
        <label>
          {t('installationScope')}
          <select
            onChange={(event) => setScope(event.target.value as SkillInstallationScope)}
            value={scope}
          >
            <option value="global">{t('global')}</option>
            <option value="assistant">{t('assistant')}</option>
          </select>
        </label>
        {scope === 'assistant' ? (
          <label>
            {t('assistant')}
            <select
              onChange={(event) => setAssistantId(event.target.value)}
              required
              value={assistantId}
            >
              <option value="">{t('selectAssistant')}</option>
              {(assistants.data ?? []).map((assistant) => (
                <option key={assistant.id} value={assistant.id}>
                  {assistant.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </section>

      {skills.isLoading ? <p className="skill-muted">{t('loading')}</p> : null}
      {mutationError ? (
        <p className="skill-error" role="alert">
          {t('actionFailed')}
        </p>
      ) : null}
      {!skills.isLoading && (skills.data?.length ?? 0) === 0 ? (
        <p className="skill-muted">{t('empty')}</p>
      ) : null}
      <ul className="skill-list">
        {(skills.data ?? []).map((skill) => (
          <li className="skill-card" key={skill.id}>
            <div className="skill-card-head">
              <div>
                <h2>{skill.name}</h2>
                <p>{skill.description}</p>
              </div>
              <button className="skill-button" onClick={() => startVersion(skill)} type="button">
                {t('addVersion')}
              </button>
            </div>
            <p className="skill-muted">{skill.slug}</p>
            <div className="skill-versions">
              {skill.versions.map((item) => (
                <SkillVersionRow
                  key={item.id}
                  installDisabled={scope === 'assistant' && !assistantId}
                  isMutating={isMutating}
                  item={item}
                  onActivate={() => activate.mutate({ skillId: skill.id, versionId: item.id })}
                  onInstall={() => installSkill(skill.id)}
                  onRollback={() => rollback.mutate({ skillId: skill.id, versionId: item.id })}
                  onValidate={() => validate.mutate({ skillId: skill.id, versionId: item.id })}
                  showInstall={skill.currentVersionId === item.id}
                  t={t}
                />
              ))}
            </div>
            {skill.installations.length ? (
              <p className="skill-muted">
                {t('installed')}: {skill.installations.map((item) => t(item.scope)).join(', ')}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </main>
  )
}

/** 展示单个不可变版本及允许的生命周期操作。 */
function SkillVersionRow({
  item,
  t,
  isMutating,
  installDisabled,
  showInstall,
  onValidate,
  onActivate,
  onRollback,
  onInstall,
}: {
  item: SkillVersion
  t: (key: string) => string
  isMutating: boolean
  installDisabled: boolean
  showInstall: boolean
  onValidate: () => void
  onActivate: () => void
  onRollback: () => void
  onInstall: () => void
}): JSX.Element {
  return (
    <article className="skill-version">
      <div className="skill-version-meta">
        <strong>v{item.version}</strong>
        <span className="skill-status">{t(item.status)}</span>
        <span className="skill-muted">
          {t('riskCeiling')}: {t(item.riskCeiling)}
        </span>
      </div>
      {item.requiredTools.length ? (
        <p className="skill-tools">{item.requiredTools.join(', ')}</p>
      ) : null}
      {item.validationErrors.length ? (
        <p className="skill-error">{item.validationErrors.join(', ')}</p>
      ) : null}
      <div className="skill-actions">
        {item.status === 'draft' || item.status === 'rejected' ? (
          <button className="skill-button" disabled={isMutating} onClick={onValidate} type="button">
            {t('validate')}
          </button>
        ) : null}
        {item.status === 'validated' ? (
          <button
            className="skill-button skill-button--primary"
            disabled={isMutating}
            onClick={onActivate}
            type="button"
          >
            {t('activate')}
          </button>
        ) : null}
        {item.status === 'deprecated' ? (
          <button className="skill-button" disabled={isMutating} onClick={onRollback} type="button">
            {t('rollback')}
          </button>
        ) : null}
        {showInstall ? (
          <button
            className="skill-button"
            disabled={isMutating || installDisabled}
            onClick={onInstall}
            type="button"
          >
            {t('install')}
          </button>
        ) : null}
      </div>
    </article>
  )
}

/** 从字段化输入生成后端唯一接受的受限 YAML manifest。 */
function buildManifest({
  slug,
  version,
  name,
  description,
  requiredTools,
  riskCeiling,
}: {
  slug: string
  version: string
  name: string
  description: string
  requiredTools: string
  riskCeiling: SkillRiskCeiling
}): string {
  const tools = requiredTools
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => `  - ${JSON.stringify(item)}`)
    .join('\n')
  return [
    `id: ${JSON.stringify(slug.trim())}`,
    `version: ${JSON.stringify(version.trim())}`,
    `name: ${JSON.stringify(name.trim())}`,
    `description: ${JSON.stringify(description.trim())}`,
    'entrypoint: SKILL.md',
    'required_tools:',
    tools,
    `risk_ceiling: ${riskCeiling}`,
  ].join('\n')
}

/** 返回当前活动版本；旧数据缺失时回退到列表首项。 */
function currentVersion(skill: Skill): SkillVersion | undefined {
  return skill.versions.find((item) => item.id === skill.currentVersionId) ?? skill.versions[0]
}
