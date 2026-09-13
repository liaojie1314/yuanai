'use client'

import { useState, type FormEvent, type JSX } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AutomationCreateInput, AutomationTriggerType } from '@yuanai/types'
import { listAssistants } from '@yuanai/core/api'
import {
  useAutomationStatus,
  useAutomations,
  useCreateAutomation,
  useDeleteAutomation,
  useRunAutomationNow,
} from '@yuanai/core/hooks'

import { useTranslations } from '@/i18n/client'

import './automations.css'

/** 将本地日期时间输入转换为带时区的 API 时间。 */
function toScheduledAt(value: string): string | undefined {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** 提供自动化的创建、暂停、立即运行和历史查看控制。 */
export default function AutomationCenter(): JSX.Element {
  const t = useTranslations('automations')
  const automations = useAutomations()
  const create = useCreateAutomation()
  const changeStatus = useAutomationStatus()
  const runNow = useRunAutomationNow()
  const remove = useDeleteAutomation()
  const assistants = useQuery({ queryKey: ['assistants'], queryFn: listAssistants })
  const defaultAssistant =
    assistants.data?.find((assistant) => assistant.isDefault) ?? assistants.data?.[0]
  const [assistantId, setAssistantId] = useState('')
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>('once')
  const [scheduledAt, setScheduledAt] = useState('')
  const [cronExpression, setCronExpression] = useState('0 9 * * 1-5')

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const selectedAssistantId = assistantId || defaultAssistant?.id
    const trimmedName = name.trim()
    const trimmedGoal = goal.trim()
    if (!selectedAssistantId || !trimmedName || !trimmedGoal) return
    let trigger: AutomationCreateInput['trigger']
    if (triggerType === 'once') {
      const scheduled = toScheduledAt(scheduledAt)
      if (!scheduled) return
      trigger = { triggerType: 'once', scheduledAt: scheduled }
    } else {
      const cron = cronExpression.trim()
      if (!cron) return
      trigger = { triggerType: 'cron', cronExpression: cron }
    }
    create.mutate(
      {
        assistantId: selectedAssistantId,
        name: trimmedName,
        goal: trimmedGoal,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        trigger,
      },
      {
        onSuccess: () => {
          setName('')
          setGoal('')
          setScheduledAt('')
        },
      }
    )
  }

  return (
    <main className="automation-shell">
      <header className="automation-header">
        <span className="automation-eyebrow">{t('agent')}</span>
        <h1>{t('title')}</h1>
        <p>{t('subtitle')}</p>
      </header>

      <form className="automation-create" onSubmit={submit}>
        <label>
          {t('name')}
          <input onChange={(event) => setName(event.target.value)} required value={name} />
        </label>
        <label>
          {t('goal')}
          <textarea onChange={(event) => setGoal(event.target.value)} required value={goal} />
        </label>
        <label>
          {t('assistant')}
          <select onChange={(event) => setAssistantId(event.target.value)} value={assistantId}>
            {(assistants.data ?? []).map((assistant) => (
              <option key={assistant.id} value={assistant.id}>
                {assistant.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>{t('trigger')}</legend>
          <label>
            <input
              checked={triggerType === 'once'}
              name="triggerType"
              onChange={() => setTriggerType('once')}
              type="radio"
            />
            {t('once')}
          </label>
          <label>
            <input
              checked={triggerType === 'cron'}
              name="triggerType"
              onChange={() => setTriggerType('cron')}
              type="radio"
            />
            {t('cron')}
          </label>
        </fieldset>
        {triggerType === 'once' ? (
          <label>
            {t('scheduledAt')}
            <input
              onChange={(event) => setScheduledAt(event.target.value)}
              required
              type="datetime-local"
              value={scheduledAt}
            />
          </label>
        ) : (
          <label>
            {t('cronExpression')}
            <input
              onChange={(event) => setCronExpression(event.target.value)}
              required
              value={cronExpression}
            />
          </label>
        )}
        <button
          className="automation-button automation-button--primary"
          disabled={create.isPending || !defaultAssistant}
          type="submit"
        >
          {t('create')}
        </button>
      </form>

      <section aria-labelledby="automation-list-title" className="automation-list-section">
        <h2 id="automation-list-title">{t('list')}</h2>
        {automations.isLoading ? <p className="automation-muted">{t('loading')}</p> : null}
        {!automations.isLoading && (automations.data?.length ?? 0) === 0 ? (
          <p className="automation-muted">{t('empty')}</p>
        ) : null}
        <ul className="automation-list">
          {(automations.data ?? []).map((automation) => (
            <li className="automation-card" key={automation.id}>
              <div className="automation-card-head">
                <div>
                  <h3>{automation.name}</h3>
                  <p>{automation.goal}</p>
                </div>
                <span className="automation-status">{t(automation.status)}</span>
              </div>
              <dl className="automation-details">
                <div>
                  <dt>{t('nextRun')}</dt>
                  <dd>
                    {automation.trigger.nextRunAt
                      ? new Date(automation.trigger.nextRunAt).toLocaleString()
                      : t('none')}
                  </dd>
                </div>
                <div>
                  <dt>{t('timezone')}</dt>
                  <dd>{automation.timezone}</dd>
                </div>
                <div>
                  <dt>{t('trigger')}</dt>
                  <dd>
                    {automation.trigger.triggerType === 'cron'
                      ? automation.trigger.cronExpression
                      : t('once')}
                  </dd>
                </div>
              </dl>
              <div className="automation-actions">
                <button
                  className="automation-button"
                  disabled={changeStatus.isPending || automation.status === 'completed'}
                  onClick={() =>
                    changeStatus.mutate({
                      id: automation.id,
                      active: automation.status === 'paused',
                    })
                  }
                  type="button"
                >
                  {automation.status === 'paused' ? t('resume') : t('pause')}
                </button>
                <button
                  className="automation-button"
                  disabled={runNow.isPending || automation.status === 'completed'}
                  onClick={() => runNow.mutate(automation.id)}
                  type="button"
                >
                  {t('runNow')}
                </button>
                <button
                  className="automation-button automation-button--danger"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(t('confirmDelete'))) remove.mutate(automation.id)
                  }}
                  type="button"
                >
                  {t('delete')}
                </button>
              </div>
              <div className="automation-history">
                <h4>{t('history')}</h4>
                {automation.runs.length === 0 ? (
                  <p className="automation-muted">{t('noHistory')}</p>
                ) : null}
                {automation.runs.map((run) => (
                  <div key={run.id}>
                    <span>{t(run.status)}</span>
                    <time dateTime={run.scheduledFor}>
                      {new Date(run.scheduledFor).toLocaleString()}
                    </time>
                    {run.waitReason ? (
                      <span>{t('waiting', { reason: run.waitReason })}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
