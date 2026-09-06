import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { createResourceGrant, pairExecutionNode } from '@yuanai/core/api'
import type { DesktopExecutionNodeStatus } from '../../../shared/ipc-contract'

/** 执行节点向主进程声明并受后端策略约束的本地能力。 */
const NODE_CAPABILITIES = [
  'browser_open_url',
  'read_granted_file',
  'list_granted_directory',
  'write_workspace_file',
]

function formatExpiry(value: string | null, locale: string): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'zh-CN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

function describeJob(
  job: { toolName: string; arguments: Record<string, unknown> },
  t: (key: string) => string
): string {
  let argumentsText = ''
  try {
    argumentsText = JSON.stringify(job.arguments)
  } catch {
    argumentsText = ''
  }
  if (argumentsText.length > 200) argumentsText = `${argumentsText.slice(0, 200)}…`
  return `${job.toolName} · ${t('desktop.executionNode.arguments')}: ${argumentsText}`
}

/** 桌面执行节点的本机启用、任务审批与资源授权管理分区。 */
export function ExecutionNodeSection(): JSX.Element {
  const { t, i18n } = useTranslation()
  const [status, setStatus] = useState<DesktopExecutionNodeStatus | null>(null)
  const [name, setName] = useState('')
  const [enabling, setEnabling] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    const api = window.yuanai?.executionNode
    if (!api) return
    let active = true
    void api
      .getStatus()
      .then((snapshot) => {
        if (active) setStatus(snapshot)
      })
      .catch(() => {})
    const unsubscribe = window.yuanai.events.onExecutionNodeEvent((snapshot) => {
      if (active) setStatus(snapshot)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const enable = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault()
      setActionError(null)
      setEnabling(true)
      try {
        const appInfo = await window.yuanai.system.getInfo()
        const pairing = await pairExecutionNode({
          name: name.trim() || t('desktop.executionNode.nodeNamePlaceholder'),
          platform: window.yuanai.platform,
          appVersion: appInfo.version,
          capabilities: [...NODE_CAPABILITIES],
        })
        await window.yuanai.executionNode.register({
          pairingCode: pairing.pairingCode,
          name: name.trim() || t('desktop.executionNode.nodeNamePlaceholder'),
          capabilities: [...NODE_CAPABILITIES],
        })
        setName('')
      } catch {
        setActionError(t('desktop.executionNode.enableFailed'))
      } finally {
        setEnabling(false)
      }
    },
    [name, t]
  )

  const grant = useCallback(
    async (kind: 'file' | 'directory'): Promise<void> => {
      setActionError(null)
      try {
        const grantView = await window.yuanai.executionNode.createGrant({ kind })
        if (!grantView) return
        const currentNodeId = status?.nodeId
        if (!currentNodeId) return
        await createResourceGrant({
          nodeId: currentNodeId,
          kind,
          resourceId: grantView.resourceId,
          displayName: grantView.displayName,
        })
      } catch {
        setActionError(t('desktop.executionNode.grantCloudRegisterFailed'))
      }
    },
    [status?.nodeId, t]
  )

  const configured = status !== null && status.state !== 'idle'
  const stateLabel = t(`desktop.executionNode.state.${status?.state ?? 'idle'}`)

  return (
    <section className="settings-block">
      <h3>{t('desktop.executionNode.title')}</h3>
      <p className="settings-field-hint">{t('desktop.executionNode.description')}</p>
      {configured && status ? (
        <>
          <div className="settings-row">
            <div>
              <strong>{status.name}</strong>
              <p>
                {stateLabel}
                {status.tokenExpiresAt
                  ? ` · ${t('desktop.executionNode.tokenExpiresAt')} ${formatExpiry(
                      status.tokenExpiresAt,
                      i18n.language
                    )}`
                  : ''}
              </p>
            </div>
            <div className="settings-inline-field settings-inline-field--actions">
              <button
                type="button"
                className="settings-button settings-button--secondary"
                onClick={() => void window.yuanai.executionNode.disconnect()}
              >
                {t('desktop.executionNode.disconnect')}
              </button>
              <button
                type="button"
                className="settings-button settings-button--secondary"
                onClick={() => {
                  if (window.confirm(t('desktop.executionNode.removeConfirm'))) {
                    void window.yuanai.executionNode.removeNode()
                  }
                }}
              >
                {t('desktop.executionNode.remove')}
              </button>
            </div>
          </div>
          <p className="settings-field-hint">
            {t('desktop.executionNode.capabilities')}: {status.capabilities.join(', ')}
          </p>
          {status.lastError ? (
            <p className="settings-alert" role="alert">
              {t('desktop.executionNode.lastError', { code: status.lastError })}
            </p>
          ) : null}
          {status.pendingJob ? (
            <div className="settings-update-panel" role="alert">
              <div className="settings-update-panel__status">
                <strong>{t('desktop.executionNode.pendingJob')}</strong>
                <span>{describeJob(status.pendingJob, t)}</span>
                <span>
                  {t('desktop.executionNode.expiresAt')}{' '}
                  {formatExpiry(status.pendingJob.expiresAt, i18n.language)}
                </span>
              </div>
              <div className="settings-update-panel__actions">
                <button
                  type="button"
                  className="settings-button settings-button--primary"
                  onClick={() =>
                    void window.yuanai.executionNode.respondJob({
                      executionId: status.pendingJob?.executionId ?? '',
                      decision: 'accept',
                    })
                  }
                >
                  {t('desktop.executionNode.allow')}
                </button>
                <button
                  type="button"
                  className="settings-button settings-button--secondary"
                  onClick={() =>
                    void window.yuanai.executionNode.respondJob({
                      executionId: status.pendingJob?.executionId ?? '',
                      decision: 'reject',
                    })
                  }
                >
                  {t('desktop.executionNode.reject')}
                </button>
              </div>
            </div>
          ) : null}
          {status.currentJob ? (
            <div className="settings-update-panel" aria-live="polite">
              <div className="settings-update-panel__status">
                <strong>{t('desktop.executionNode.currentJob')}</strong>
                <span>
                  <Loader2 size={13} className="settings-spin" aria-hidden="true" />{' '}
                  {describeJob(status.currentJob, t)}
                </span>
              </div>
            </div>
          ) : null}
          <div className="settings-row">
            <div>
              <strong>{t('desktop.executionNode.grants')}</strong>
              <p>{t('desktop.executionNode.description')}</p>
            </div>
            <div className="settings-inline-field settings-inline-field--actions">
              <button
                type="button"
                className="settings-button settings-button--secondary"
                onClick={() => void grant('file')}
              >
                {t('desktop.executionNode.grantFile')}
              </button>
              <button
                type="button"
                className="settings-button settings-button--secondary"
                onClick={() => void grant('directory')}
              >
                {t('desktop.executionNode.grantDirectory')}
              </button>
            </div>
          </div>
          {status.grants.length === 0 ? (
            <p className="settings-field-hint">{t('desktop.executionNode.grantsEmpty')}</p>
          ) : (
            <ul className="settings-grant-list">
              {status.grants.map((grantView) => (
                <li key={grantView.resourceId}>
                  <span>{grantView.displayName}</span>
                  <span>{grantView.kind}</span>
                  <button
                    type="button"
                    className="settings-icon-button"
                    aria-label={`${t('desktop.executionNode.revokeGrant')} ${grantView.displayName}`}
                    onClick={() =>
                      void window.yuanai.executionNode.revokeGrant({
                        resourceId: grantView.resourceId,
                      })
                    }
                  >
                    {t('desktop.executionNode.revokeGrant')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <form className="settings-field" onSubmit={(event) => void enable(event)}>
          <label htmlFor="execution-node-name">{t('desktop.executionNode.nodeName')}</label>
          <div className="settings-inline-field">
            <input
              id="execution-node-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('desktop.executionNode.nodeNamePlaceholder')}
              maxLength={120}
            />
            <button
              type="submit"
              className="settings-button settings-button--primary"
              disabled={enabling}
            >
              {enabling ? t('desktop.executionNode.enabling') : t('desktop.executionNode.enable')}
            </button>
          </div>
        </form>
      )}
      {actionError ? (
        <p className="settings-alert" role="alert">
          {actionError}
        </p>
      ) : null}
    </section>
  )
}
