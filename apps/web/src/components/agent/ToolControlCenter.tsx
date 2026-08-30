'use client'

import {
  Blocks,
  Cable,
  Download,
  Loader2,
  Plug,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocale } from 'next-intl'
import { useState, type FormEvent, type JSX } from 'react'
import type {
  ArtifactMeta,
  ExecutionNode,
  ExecutionNodePairing,
  McpServer,
  ResourceGrant,
  ToolCatalogItem,
  ToolConnection,
  ToolConnectionKind,
  ToolExecution,
} from '@yuanai/types'
import {
  useCancelToolExecution,
  useCreateMcpServer,
  useCreateToolConnection,
  useDeleteArtifact,
  useDeleteToolConnection,
  useDiscoverMcpServer,
  useEnableMcpTools,
  useExecutionNodes,
  useMcpServers,
  usePairExecutionNode,
  useResourceGrants,
  useRevokeExecutionNode,
  useToolArtifacts,
  useToolCatalog,
  useToolConnections,
  useToolExecutions,
} from '@yuanai/core/hooks'
import { useTranslations } from '@/i18n/client'
import './tools.css'

type ToolCenterTab = 'catalog' | 'connections' | 'mcp' | 'nodes' | 'executions' | 'artifacts'

const TABS: readonly ToolCenterTab[] = [
  'catalog',
  'connections',
  'mcp',
  'nodes',
  'executions',
  'artifacts',
]

const CONNECTION_KINDS: readonly ToolConnectionKind[] = ['api_key', 'oauth']

function formatDate(value: string | null, locale: string): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value)
  )
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function riskKey(
  risk: string
):
  | 'read'
  | 'local_write'
  | 'reversible_write'
  | 'external_side_effect'
  | 'destructive'
  | 'financial'
  | 'privileged'
  | 'unknown' {
  return (
    [
      'read',
      'local_write',
      'reversible_write',
      'external_side_effect',
      'destructive',
      'financial',
      'privileged',
    ] as const
  ).includes(risk as never)
    ? (risk as 'read')
    : 'unknown'
}

/** 风险徽章色调：只读为安全色，破坏性/金融/特权为警示色，其余为进行中色。 */
function riskTone(risk: string): string {
  if (risk === 'read') return 'ok'
  if (['destructive', 'financial', 'privileged'].includes(risk)) return 'bad'
  return 'busy'
}

function formatResultPreview(result: ToolExecution['resultJson']): string {
  if (!result) return ''
  try {
    const text = JSON.stringify(result)
    return text.length > 400 ? `${text.slice(0, 400)}…` : text
  } catch {
    return ''
  }
}

function StatusBadge({ tone, label }: { tone: string; label: string }): JSX.Element {
  return <span className={`tools-badge tools-badge--${tone}`}>{label}</span>
}

/** 统一返回各状态对应的语义色徽章色调，颜色值只来自主题 token。 */
function statusTone(status: string): string {
  if (['active', 'online', 'succeeded'].includes(status)) return 'ok'
  if (['queued', 'running', 'pending', 'waiting'].includes(status)) return 'busy'
  if (['revoked', 'failed', 'error', 'cancelled', 'expired'].includes(status)) return 'bad'
  return 'muted'
}

function SectionError({ message }: { message: string | undefined }): JSX.Element | null {
  if (!message) return null
  return (
    <p className="tools-alert" role="alert">
      {message}
    </p>
  )
}

function CatalogTab(): JSX.Element {
  const t = useTranslations('tools')
  const locale = useLocale()
  const catalog = useToolCatalog()
  if (catalog.isLoading) {
    return (
      <p className="tools-loading">
        <Loader2 size={16} className="tools-spin" aria-hidden="true" />
      </p>
    )
  }
  const items = catalog.data ?? []
  if (items.length === 0) return <p className="tools-empty">{t('catalog.empty')}</p>
  return (
    <ul className="tools-grid">
      {items.map((item: ToolCatalogItem) => (
        <li key={item.name} className="tools-card">
          <div className="tools-card-head">
            <strong>{item.name}</strong>
            <StatusBadge
              tone={riskTone(item.riskLevel)}
              label={t(`risk.${riskKey(item.riskLevel)}`)}
            />
          </div>
          <p>{item.description}</p>
          <div className="tools-card-meta">
            <span>
              {t('catalog.location')}: {t(`location.${item.executionLocation ?? 'unknown'}`)}
            </span>
            {item.requiredScopes.length > 0 ? (
              <span>
                {t('connections.scopes')}: {item.requiredScopes.join(', ')}
              </span>
            ) : null}
            {item.tags.length > 0 ? (
              <span>
                {t('catalog.tags')}: {item.tags.join(', ')}
              </span>
            ) : null}
          </div>
          <span className="tools-muted">
            {locale === 'zh-CN' ? `版本 ${item.version}` : `Version ${item.version}`}
          </span>
        </li>
      ))}
    </ul>
  )
}

function ConnectionsTab(): JSX.Element {
  const t = useTranslations('tools')
  const locale = useLocale()
  const list = useToolConnections()
  const remove = useDeleteToolConnection()
  const create = useCreateToolConnection()
  const [kind, setKind] = useState<ToolConnectionKind>('api_key')
  const [provider, setProvider] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [secretRef, setSecretRef] = useState('')

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!provider.trim() || !displayName.trim()) return
    create.mutate(
      {
        kind,
        provider: provider.trim(),
        displayName: displayName.trim(),
        ...(secretRef.trim() ? { secretRef: secretRef.trim() } : {}),
      },
      {
        onSuccess: () => {
          setProvider('')
          setDisplayName('')
          setSecretRef('')
        },
      }
    )
  }

  return (
    <div className="tools-pane">
      <form className="tools-form" onSubmit={submit}>
        <h3>{t('connections.create')}</h3>
        <div className="tools-form-row">
          <label>
            {t('connections.kind')}
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as ToolConnectionKind)}
            >
              {CONNECTION_KINDS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('connections.provider')}
            <input
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              maxLength={80}
              required
            />
          </label>
        </div>
        <div className="tools-form-row">
          <label>
            {t('connections.displayName')}
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={120}
              required
            />
          </label>
          <label>
            {t('connections.secretRef')}
            <input
              value={secretRef}
              onChange={(event) => setSecretRef(event.target.value)}
              maxLength={200}
              autoComplete="off"
            />
          </label>
        </div>
        <button className="tools-btn tools-btn--primary" type="submit" disabled={create.isPending}>
          {create.isPending ? t('common.creating') : t('connections.create')}
        </button>
        <SectionError message={create.isError ? t('common.actionFailed') : undefined} />
      </form>
      {list.data?.length ? (
        <ul className="tools-grid">
          {list.data.map((item: ToolConnection) => (
            <li key={item.id} className="tools-card">
              <div className="tools-card-head">
                <strong>{item.displayName}</strong>
                <StatusBadge tone={statusTone(item.status)} label={t(`status.${item.status}`)} />
              </div>
              <p>
                {t('connections.provider')}: {item.provider} · {item.kind}
              </p>
              <div className="tools-card-meta">
                <span>
                  {t('connections.scopes')}:{' '}
                  {item.scopes.length ? item.scopes.join(', ') : t('common.none')}
                </span>
                <span>
                  {t('connections.createdAt')}: {formatDate(item.createdAt, locale)}
                </span>
              </div>
              <button
                className="tools-btn tools-btn--danger"
                type="button"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(t('connections.confirmDelete'))) {
                    remove.mutate(item.id)
                  }
                }}
              >
                <Trash2 size={14} aria-hidden="true" /> {t('connections.delete')}
              </button>
              <SectionError message={remove.isError ? t('common.actionFailed') : undefined} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="tools-empty">{t('connections.empty')}</p>
      )}
    </div>
  )
}

function McpTab(): JSX.Element {
  const t = useTranslations('tools')
  const servers = useMcpServers()
  const connections = useToolConnections()
  const create = useCreateMcpServer()
  const discover = useDiscoverMcpServer()
  const enable = useEnableMcpTools()
  const [name, setName] = useState('')
  const [endpointUrl, setEndpointUrl] = useState('')
  const [connectionId, setConnectionId] = useState('')
  const [selectedTools, setSelectedTools] = useState<Record<string, boolean>>({})

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!name.trim() || !endpointUrl.trim() || !connectionId) return
    create.mutate(
      { name: name.trim(), endpointUrl: endpointUrl.trim(), connectionId },
      {
        onSuccess: () => {
          setName('')
          setEndpointUrl('')
        },
      }
    )
  }

  return (
    <div className="tools-pane">
      <form className="tools-form" onSubmit={submit}>
        <h3>{t('mcp.create')}</h3>
        <div className="tools-form-row">
          <label>
            {t('mcp.name')}
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              required
            />
          </label>
          <label>
            {t('mcp.endpointUrl')}
            <input
              value={endpointUrl}
              onChange={(event) => setEndpointUrl(event.target.value)}
              type="url"
              maxLength={500}
              required
            />
          </label>
        </div>
        <label>
          {t('mcp.connection')}
          <select
            value={connectionId}
            onChange={(event) => setConnectionId(event.target.value)}
            required
          >
            <option value="">—</option>
            {(connections.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName}
              </option>
            ))}
          </select>
        </label>
        <button className="tools-btn tools-btn--primary" type="submit" disabled={create.isPending}>
          {create.isPending ? t('common.creating') : t('mcp.create')}
        </button>
        <SectionError message={create.isError ? t('common.actionFailed') : undefined} />
      </form>
      {servers.data?.length ? (
        <ul className="tools-grid">
          {servers.data.map((server: McpServer) => {
            const snapshotTools = server.schemaSnapshot?.tools ?? []
            return (
              <li key={server.id} className="tools-card">
                <div className="tools-card-head">
                  <strong>{server.name}</strong>
                  <StatusBadge
                    tone={statusTone(server.status)}
                    label={t(`status.${server.status}`)}
                  />
                </div>
                <p className="tools-break">{server.endpointUrl}</p>
                <div className="tools-card-meta">
                  <span>
                    {t('mcp.availableTools')}:{' '}
                    {snapshotTools.length
                      ? snapshotTools.map((tool) => tool.name).join(', ')
                      : t('mcp.noSnapshot')}
                  </span>
                  <span>
                    {t('mcp.enabledTools')}:{' '}
                    {server.enabledTools.length ? server.enabledTools.join(', ') : t('common.none')}
                  </span>
                </div>
                {snapshotTools.length > 0 ? (
                  <fieldset className="tools-tool-picker">
                    <legend>{t('mcp.availableTools')}</legend>
                    {snapshotTools.map((tool) => (
                      <label key={tool.name} className="tools-tool-option">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedTools[`${server.id}:${tool.name}`])}
                          onChange={(event) =>
                            setSelectedTools((previous) => ({
                              ...previous,
                              [`${server.id}:${tool.name}`]: event.target.checked,
                            }))
                          }
                        />
                        {tool.name}
                      </label>
                    ))}
                  </fieldset>
                ) : null}
                <div className="tools-actions">
                  <button
                    className="tools-btn"
                    type="button"
                    disabled={discover.isPending}
                    onClick={() => discover.mutate(server.id)}
                  >
                    <RefreshCw size={14} aria-hidden="true" /> {t('mcp.discover')}
                  </button>
                  {snapshotTools.length > 0 ? (
                    <button
                      className="tools-btn tools-btn--primary"
                      type="button"
                      disabled={enable.isPending}
                      onClick={() =>
                        enable.mutate({
                          serverId: server.id,
                          input: {
                            enabledTools: snapshotTools
                              .map((tool) => tool.name)
                              .filter((toolName) => selectedTools[`${server.id}:${toolName}`]),
                          },
                        })
                      }
                    >
                      {t('mcp.enable')}
                    </button>
                  ) : null}
                </div>
                <SectionError
                  message={
                    discover.isError || enable.isError ? t('common.actionFailed') : undefined
                  }
                />
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="tools-empty">{t('mcp.empty')}</p>
      )}
    </div>
  )
}

function NodesTab(): JSX.Element {
  const t = useTranslations('tools')
  const locale = useLocale()
  const nodes = useExecutionNodes()
  const grants = useResourceGrants()
  const revoke = useRevokeExecutionNode()
  const pair = usePairExecutionNode()
  const [nodeName, setNodeName] = useState('')
  const [platform, setPlatform] = useState<'linux' | 'win32' | 'darwin'>('linux')
  const [appVersion, setAppVersion] = useState('')
  const [pairing, setPairing] = useState<ExecutionNodePairing | null>(null)

  const startPairing = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!nodeName.trim() || !appVersion.trim()) return
    // 注册协议要求配对记录与节点自报的 name/platform/appVersion 完全一致，
    // 因此这里必须填写目标 Desktop 将要上报的原始值。
    pair.mutate(
      { name: nodeName.trim(), platform, appVersion: appVersion.trim() },
      {
        onSuccess: (result) => {
          setPairing(result)
          setNodeName('')
          setAppVersion('')
        },
      }
    )
  }

  return (
    <div className="tools-pane">
      <form className="tools-form" onSubmit={startPairing}>
        <h3>{t('nodes.pair')}</h3>
        <div className="tools-form-row">
          <label>
            {t('connections.displayName')}
            <input
              value={nodeName}
              onChange={(event) => setNodeName(event.target.value)}
              maxLength={120}
              required
            />
          </label>
          <label>
            {t('nodes.platform')}
            <select
              value={platform}
              onChange={(event) => setPlatform(event.target.value as 'linux' | 'win32' | 'darwin')}
            >
              <option value="linux">linux</option>
              <option value="win32">win32</option>
              <option value="darwin">darwin</option>
            </select>
          </label>
          <label>
            {t('nodes.version')}
            <input
              value={appVersion}
              onChange={(event) => setAppVersion(event.target.value)}
              maxLength={40}
              required
            />
          </label>
        </div>
        <button className="tools-btn tools-btn--primary" type="submit" disabled={pair.isPending}>
          {pair.isPending ? t('common.working') : t('nodes.pair')}
        </button>
        <SectionError message={pair.isError ? t('common.actionFailed') : undefined} />
        {pairing ? (
          <div className="tools-pairing" role="alert">
            <strong>{t('nodes.pairingCode')}</strong>
            <code>{pairing.pairingCode}</code>
            <p>{t('nodes.pairingHint')}</p>
          </div>
        ) : null}
      </form>
      {nodes.data?.length ? (
        <ul className="tools-grid">
          {nodes.data.map((node: ExecutionNode) => (
            <li key={node.id} className="tools-card">
              <div className="tools-card-head">
                <strong>{node.name}</strong>
                <StatusBadge tone={statusTone(node.status)} label={t(`status.${node.status}`)} />
              </div>
              <p>
                {t('nodes.platform')}: {node.platform} · {t('nodes.version')}: {node.appVersion}
              </p>
              <div className="tools-card-meta">
                <span>
                  {t('nodes.capabilities')}: {node.capabilities.join(', ') || t('common.none')}
                </span>
                <span>
                  {t('nodes.lastSeenAt')}: {formatDate(node.lastSeenAt, locale)}
                </span>
                <span>
                  {t('nodes.policy')}:{' '}
                  {(node.policy.allowed_tools ?? []).join(', ') || t('common.none')}
                </span>
              </div>
              <button
                className="tools-btn tools-btn--danger"
                type="button"
                disabled={revoke.isPending}
                onClick={() => {
                  if (window.confirm(t('nodes.confirmRevoke'))) {
                    revoke.mutate(node.id)
                  }
                }}
              >
                <Trash2 size={14} aria-hidden="true" /> {t('nodes.revoke')}
              </button>
              <SectionError message={revoke.isError ? t('common.actionFailed') : undefined} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="tools-empty">{t('nodes.empty')}</p>
      )}
      <section className="tools-grants">
        <h3>{t('nodes.grants')}</h3>
        {grants.data?.length ? (
          <ul className="tools-grid">
            {grants.data.map((grant: ResourceGrant) => (
              <li key={grant.id} className="tools-card">
                <div className="tools-card-head">
                  <strong>{grant.displayName}</strong>
                  <StatusBadge tone="muted" label={grant.kind} />
                </div>
                <div className="tools-card-meta">
                  <span>
                    {t('nodes.grantResource')}: {grant.resourceId}
                  </span>
                  <span>{formatDate(grant.createdAt, locale)}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="tools-empty">{t('nodes.grantsEmpty')}</p>
        )}
      </section>
    </div>
  )
}

function ExecutionsTab(): JSX.Element {
  const t = useTranslations('tools')
  const locale = useLocale()
  const executions = useToolExecutions()
  const cancel = useCancelToolExecution()
  const rows = executions.data ?? []
  return (
    <div className="tools-pane">
      {rows.length ? (
        <ul className="tools-list">
          {rows.map((item: ToolExecution) => (
            <li key={item.id} className="tools-row">
              <div className="tools-row-main">
                <strong>{item.toolName}</strong>
                <StatusBadge
                  tone={statusTone(item.status)}
                  label={
                    item.status === 'waiting' ? t('status.pending') : t(`status.${item.status}`)
                  }
                />
                <span className="tools-muted">{t(`location.${item.executionLocation}`)}</span>
              </div>
              <div className="tools-card-meta">
                <span>
                  {t('executions.startedAt')}: {formatDate(item.startedAt, locale)}
                </span>
                <span>
                  {t('executions.finishedAt')}: {formatDate(item.finishedAt, locale)}
                </span>
                {item.errorMessage ? (
                  <span className="tools-error-text">
                    {t('executions.error')}: {item.errorMessage}
                  </span>
                ) : null}
                {formatResultPreview(item.resultJson) ? (
                  <span className="tools-break">{formatResultPreview(item.resultJson)}</span>
                ) : null}
              </div>
              {['queued', 'running', 'waiting'].includes(item.status) ? (
                <button
                  className="tools-btn"
                  type="button"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(item.id)}
                >
                  <X size={14} aria-hidden="true" /> {t('executions.cancel')}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="tools-empty">{t('executions.empty')}</p>
      )}
      <SectionError message={cancel.isError ? t('common.actionFailed') : undefined} />
    </div>
  )
}

function ArtifactsTab(): JSX.Element {
  const t = useTranslations('tools')
  const locale = useLocale()
  const artifacts = useToolArtifacts()
  const remove = useDeleteArtifact()
  const rows = artifacts.data ?? []
  return (
    <div className="tools-pane">
      {rows.length ? (
        <ul className="tools-list">
          {rows.map((item: ArtifactMeta) => (
            <li key={item.id} className="tools-row">
              <div className="tools-row-main">
                <strong>{item.name}</strong>
                <span className="tools-muted">
                  {t('artifacts.kind')}: {item.kind} · {item.mimeType}
                </span>
              </div>
              <div className="tools-card-meta">
                <span>
                  {t('artifacts.size')}: {formatBytes(item.sizeBytes)}
                </span>
                <span>
                  {t('artifacts.expiresAt')}: {formatDate(item.expiresAt, locale)}
                </span>
              </div>
              <div className="tools-actions">
                {item.downloadUrl ? (
                  <a className="tools-btn" href={item.downloadUrl} download>
                    <Download size={14} aria-hidden="true" /> {t('artifacts.download')}
                  </a>
                ) : null}
                <button
                  className="tools-btn tools-btn--danger"
                  type="button"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(t('artifacts.confirmDelete'))) {
                      remove.mutate(item.id)
                    }
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" /> {t('artifacts.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="tools-empty">{t('artifacts.empty')}</p>
      )}
      <SectionError message={remove.isError ? t('common.actionFailed') : undefined} />
    </div>
  )
}

/** 用户工具控制中心：只呈现后端事实，不在前端复制策略判断。 */
export default function ToolControlCenter(): JSX.Element {
  const t = useTranslations('tools')
  const [tab, setTab] = useState<ToolCenterTab>('catalog')
  const queryClient = useQueryClient()

  const tabIcons: Record<ToolCenterTab, JSX.Element> = {
    catalog: <Blocks size={15} aria-hidden="true" />,
    connections: <Cable size={15} aria-hidden="true" />,
    mcp: <Server size={15} aria-hidden="true" />,
    nodes: <Plug size={15} aria-hidden="true" />,
    executions: <ShieldCheck size={15} aria-hidden="true" />,
    artifacts: <Download size={15} aria-hidden="true" />,
  }

  return (
    <main className="tools-shell">
      <header className="agent-page-header">
        <div>
          <span className="agent-eyebrow">Tool Control Center</span>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
        <button type="button" className="tools-btn" onClick={() => queryClient.invalidateQueries()}>
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </header>
      <nav className="tools-tabs" aria-label={t('title')}>
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            className={tab === item ? 'tools-tab is-active' : 'tools-tab'}
            aria-current={tab === item ? 'page' : undefined}
            onClick={() => setTab(item)}
          >
            {tabIcons[item]}
            {t(`tabs.${item}`)}
          </button>
        ))}
      </nav>
      {tab === 'catalog' ? <CatalogTab /> : null}
      {tab === 'connections' ? <ConnectionsTab /> : null}
      {tab === 'mcp' ? <McpTab /> : null}
      {tab === 'nodes' ? <NodesTab /> : null}
      {tab === 'executions' ? <ExecutionsTab /> : null}
      {tab === 'artifacts' ? <ArtifactsTab /> : null}
    </main>
  )
}
