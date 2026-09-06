'use client'

import { useMemo, useState, type FormEvent, type JSX } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from '@/i18n/client'
import {
  Bot,
  Check,
  ChevronRight,
  Clock3,
  Loader2,
  MessageCircleQuestion,
  RefreshCw,
  ShieldAlert,
  Square,
  X,
} from 'lucide-react'
import type { AdminAgentRun, AgentEvent, AgentRun, AgentStep, ApprovalRequest } from '@yuanai/types'
import {
  decideAgentApproval,
  listAdminAgentRuns,
  listAgentApprovals,
  listAgentRuns,
  listAssistants,
} from '@yuanai/core/api'
import {
  useAgentEvents,
  useAgentRun,
  useAgentRunStream,
  useAgentSteps,
  useCancelAgentRun,
  useCreateAgentRun,
  useDecideAgentApproval,
  useSubmitAgentInput,
} from '@yuanai/core/hooks'
import './agent.css'

type AgentWorkspaceMode = 'runs' | 'approvals' | 'admin'

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled'])

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: '排队中',
    running: '执行中',
    waiting_approval: '等待审批',
    waiting_input: '等待补充信息',
    succeeded: '已完成',
    failed: '失败',
    cancelled: '已取消',
  }
  return labels[status] ?? status
}

function eventLabel(event: AgentEvent): string {
  const labels: Record<string, string> = {
    run_queued: '已排队',
    run_started: '开始执行',
    step_started: '步骤开始',
    model_delta: '模型输出',
    tool_call: '工具调用',
    tool_result: '工具结果',
    approval_requested: '需要审批',
    approval_required: '需要审批',
    input_requested: '需要补充信息',
    run_completed: '执行完成',
    run_failed: '执行失败',
    run_cancelled: '已取消',
  }
  return labels[event.eventType] ?? event.eventType
}

function formatDate(value: string | null): string {
  if (!value) return '尚未发生'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value)
  )
}

function valuePreview(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

type AgentListRun = AgentRun | AdminAgentRun

function RunCard({
  run,
  active,
  onClick,
  redacted = false,
}: {
  run: AgentListRun
  active: boolean
  onClick: () => void
  redacted?: boolean
}): JSX.Element {
  return (
    <button
      className={`agent-run-card ${active ? 'is-active' : ''}`}
      onClick={onClick}
      type="button"
    >
      <div className="agent-run-card-icon">
        <Bot size={17} />
      </div>
      <div className="agent-run-card-copy">
        <strong>
          {redacted
            ? `Run ${run.id.slice(0, 8)}`
            : 'goal' in run
              ? run.goal || '未命名任务'
              : '脱敏任务'}
        </strong>
        <span>{formatDate(run.createdAt)}</span>
      </div>
      <span className={`agent-status agent-status-${run.status}`}>{statusLabel(run.status)}</span>
      <ChevronRight size={16} className="agent-run-card-chevron" />
    </button>
  )
}

function Timeline({ steps, events }: { steps: AgentStep[]; events: AgentEvent[] }): JSX.Element {
  const rows =
    steps.length > 0
      ? steps.map((step) => ({
          key: step.id,
          title: `步骤 ${step.sequence}: ${step.kind}`,
          status: step.status,
          detail: step.outputJson ?? step.inputJson ?? step.errorMessage,
          time: step.finishedAt ?? step.startedAt,
        }))
      : events.map((event) => ({
          key: `${event.sequence}-${event.eventType}`,
          title: eventLabel(event),
          status: event.eventType.includes('failed') ? 'failed' : 'done',
          detail: event.payload,
          time: event.createdAt,
        }))
  return (
    <div className="agent-timeline">
      {rows.length === 0 ? (
        <p className="agent-muted">暂无执行记录</p>
      ) : (
        rows.map((row) => (
          <details className="agent-timeline-row" key={row.key} open={row.status === 'running'}>
            <summary>
              <span className={`agent-step-dot agent-step-${row.status}`} />
              <span className="agent-timeline-title">{row.title}</span>
              <span className="agent-timeline-status">{statusLabel(row.status)}</span>
              <time>{formatDate(row.time)}</time>
            </summary>
            {row.detail !== null && row.detail !== undefined ? (
              <pre className="agent-tool-detail">{valuePreview(row.detail)}</pre>
            ) : null}
          </details>
        ))
      )}
    </div>
  )
}

function ApprovalCard({
  approval,
  onDecision,
}: {
  approval: ApprovalRequest
  onDecision: (decision: 'approve' | 'deny') => void
}): JSX.Element {
  const expired = new Date(approval.expiresAt).getTime() <= Date.now()
  const decided = approval.status !== 'pending'
  return (
    <section className={`agent-approval-card ${decided || expired ? 'is-resolved' : ''}`}>
      <div className="agent-approval-heading">
        <ShieldAlert size={18} />
        <strong>工具执行需要确认</strong>
      </div>
      <p>{approval.actionSummary || approval.toolName}</p>
      <dl>
        <div>
          <dt>工具</dt>
          <dd>{approval.toolName}</dd>
        </div>
        <div>
          <dt>位置</dt>
          <dd>{approval.executionLocation}</dd>
        </div>
        <div>
          <dt>参数摘要</dt>
          <dd>
            <code>{valuePreview(approval.argumentsPreview)}</code>
          </dd>
        </div>
        <div>
          <dt>有效期</dt>
          <dd>{formatDate(approval.expiresAt)}</dd>
        </div>
      </dl>
      {!decided && !expired ? (
        <div className="agent-approval-actions">
          <button
            type="button"
            className="agent-btn agent-btn-primary"
            onClick={() => onDecision('approve')}
          >
            <Check size={15} />
            批准
          </button>
          <button
            type="button"
            className="agent-btn agent-btn-danger"
            onClick={() => onDecision('deny')}
          >
            <X size={15} />
            拒绝
          </button>
        </div>
      ) : (
        <span className="agent-muted">
          {expired ? '审批已过期' : `已${approval.status === 'approved' ? '批准' : '处理'}`}
        </span>
      )}
    </section>
  )
}

function RunDetail({ runId }: { runId: string }): JSX.Element {
  const runQuery = useAgentRun(runId)
  const stepsQuery = useAgentSteps(runId)
  const eventsQuery = useAgentEvents(runId)
  const approvalsQuery = useQuery({
    queryKey: ['agent-approvals', runId],
    queryFn: listAgentApprovals,
  })
  const cancelMutation = useCancelAgentRun()
  const inputMutation = useSubmitAgentInput()
  const approvalMutation = useDecideAgentApproval()
  const [input, setInput] = useState('')

  useAgentRunStream(runId)

  const run = runQuery.data
  const events = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data])
  const approval = useMemo(
    () =>
      approvalsQuery.data?.find((item) => item.runId === runId && item.status === 'pending') ??
      null,
    [approvalsQuery.data, runId]
  )

  if (runQuery.isLoading || !run)
    return (
      <div className="agent-detail agent-loading">
        <Loader2 className="agent-spin" size={20} />
        正在加载任务
      </div>
    )
  return (
    <section className="agent-detail">
      <header className="agent-detail-header">
        <div>
          <span className="agent-eyebrow">Agent Run</span>
          <h2>{run.goal}</h2>
          <p>
            {run.model} · {run.currentStep}/{run.maxSteps} 步
          </p>
        </div>
        <div className="agent-detail-actions">
          <span className={`agent-status agent-status-${run.status}`}>
            {statusLabel(run.status)}
          </span>
          {!TERMINAL_STATUSES.has(run.status) ? (
            <button
              type="button"
              className="agent-icon-btn"
              title="取消任务"
              onClick={() => cancelMutation.mutate(run.id)}
            >
              <Square size={15} />
            </button>
          ) : null}
          <button
            type="button"
            className="agent-icon-btn"
            title="刷新"
            onClick={() => {
              void runQuery.refetch()
              void stepsQuery.refetch()
              void eventsQuery.refetch()
              void approvalsQuery.refetch()
            }}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </header>
      {run.status === 'waiting_input' ? (
        <form
          className="agent-input-card"
          onSubmit={(event) => {
            event.preventDefault()
            if (input.trim())
              inputMutation.mutate(
                { id: run.id, input: input.trim() },
                { onSuccess: () => setInput('') }
              )
          }}
        >
          <div>
            <MessageCircleQuestion size={18} />
            <strong>需要你的补充信息</strong>
          </div>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="输入补充信息"
            rows={3}
          />
          <button
            type="submit"
            className="agent-btn agent-btn-primary"
            disabled={!input.trim() || inputMutation.isPending}
          >
            提交并继续
          </button>
        </form>
      ) : null}
      {approval ? (
        <ApprovalCard
          approval={approval}
          onDecision={(decision) =>
            approvalMutation.mutate(
              { id: approval.id, decision },
              {
                onSuccess: () => {
                  void approvalsQuery.refetch()
                  void runQuery.refetch()
                },
              }
            )
          }
        />
      ) : null}
      <Timeline steps={stepsQuery.data ?? []} events={events} />
      {run.errorMessage ? (
        <div className="agent-error">
          {run.errorCode ? `${run.errorCode}: ` : ''}
          {run.errorMessage}
        </div>
      ) : null}
    </section>
  )
}

function AdminRunDetail({ run }: { run: AdminAgentRun }): JSX.Element {
  return (
    <section className="agent-detail">
      <header className="agent-detail-header">
        <div>
          <span className="agent-eyebrow">Redacted Run</span>
          <h2>Run {run.id.slice(0, 8)}</h2>
          <p>
            {run.model} · 已执行 {run.currentStep} 步
          </p>
        </div>
        <span className={`agent-status agent-status-${run.status}`}>{statusLabel(run.status)}</span>
      </header>
      <dl className="agent-admin-summary">
        <div>
          <dt>状态</dt>
          <dd>{statusLabel(run.status)}</dd>
        </div>
        <div>
          <dt>创建时间</dt>
          <dd>{formatDate(run.createdAt)}</dd>
        </div>
        <div>
          <dt>更新时间</dt>
          <dd>{formatDate(run.updatedAt ?? null)}</dd>
        </div>
        <div>
          <dt>错误</dt>
          <dd>{run.errorCode ?? '无'}</dd>
        </div>
      </dl>
      <p className="agent-muted">
        管理页面仅展示任务状态和统计信息，不返回提示词、文件内容、工具参数或凭证。
      </p>
    </section>
  )
}

/** Agent 任务、审批和脱敏运营摘要的统一工作区。 */
export default function AgentWorkspace({
  mode = 'runs',
  embedded = false,
  initialRunId,
}: {
  mode?: AgentWorkspaceMode
  embedded?: boolean
  initialRunId?: string
}): JSX.Element {
  const router = useRouter()
  const runsQuery = useQuery({
    queryKey: ['agent-runs'],
    queryFn: listAgentRuns,
    enabled: mode === 'runs',
  })
  const approvalQuery = useQuery({
    queryKey: ['agent-approvals'],
    queryFn: listAgentApprovals,
    enabled: mode === 'approvals',
  })
  const adminQuery = useQuery({
    queryKey: ['admin-agent-runs'],
    queryFn: listAdminAgentRuns,
    enabled: mode === 'admin',
  })
  const assistantsQuery = useQuery({ queryKey: ['assistants'], queryFn: listAssistants })
  const createMutation = useCreateAgentRun()
  const [goal, setGoal] = useState('')
  const [selectedRunId, setSelectedRunId] = useState(initialRunId ?? '')
  const toolsT = useTranslations('tools')
  const runs = mode === 'admin' ? (adminQuery.data ?? []) : (runsQuery.data ?? [])
  const selected = selectedRunId || runs[0]?.id || ''
  const approvals = approvalQuery.data ?? []

  const createRun = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const assistant =
      assistantsQuery.data?.find((item) => item.isDefault) ?? assistantsQuery.data?.[0]
    if (!assistant || !goal.trim()) return
    createMutation.mutate(
      { assistantId: assistant.id, goal: goal.trim(), model: assistant.defaultModel },
      {
        onSuccess: (run) => {
          setGoal('')
          setSelectedRunId(run.id)
          router.replace(`/agent/runs?run=${run.id}`)
        },
      }
    )
  }

  return (
    <main className={`agent-shell ${embedded ? 'agent-shell-embedded' : ''}`}>
      <header className="agent-page-header">
        <div>
          <span className="agent-eyebrow">Agent Workspace</span>
          <h1>
            {mode === 'admin' ? '运行监控' : mode === 'approvals' ? '审批中心' : 'Agent 任务'}
          </h1>
          <p>
            {mode === 'admin'
              ? '仅显示脱敏摘要，避免暴露提示词、文件和凭证。'
              : '查看任务进度、工具调用和需要你确认的动作。'}
          </p>
        </div>
        <div className="agent-header-side">
          <Link className="agent-btn" href="/agent/tools">
            {toolsT('title')}
          </Link>
          <Bot size={28} />
        </div>
      </header>
      {mode === 'runs' ? (
        <form className="agent-create-form" onSubmit={createRun}>
          <textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="描述你希望 Agent 完成的任务"
            rows={2}
          />
          <button
            className="agent-btn agent-btn-primary"
            type="submit"
            disabled={!goal.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? (
              <Loader2 className="agent-spin" size={16} />
            ) : (
              <Bot size={16} />
            )}
            启动任务
          </button>
        </form>
      ) : null}
      <div className="agent-layout">
        <aside className="agent-run-list">
          {mode === 'approvals' ? (
            approvals.length === 0 ? (
              <p className="agent-muted">暂无待处理审批</p>
            ) : (
              approvals.map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  onDecision={(decision) => {
                    void decideAgentApproval(approval.id, decision).then(() =>
                      approvalQuery.refetch()
                    )
                  }}
                />
              ))
            )
          ) : runs.length === 0 ? (
            <p className="agent-muted">暂无任务</p>
          ) : (
            runs.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                redacted={mode === 'admin'}
                active={selected === run.id}
                onClick={() => setSelectedRunId(run.id)}
              />
            ))
          )}
        </aside>
        {mode === 'runs' && selected ? (
          <RunDetail runId={selected} />
        ) : mode === 'admin' && selected && runs.find((item) => item.id === selected) ? (
          <AdminRunDetail run={runs.find((item) => item.id === selected) as AdminAgentRun} />
        ) : (
          <div className="agent-empty">
            <Clock3 size={28} />
            <p>选择一个任务查看详情</p>
          </div>
        )}
      </div>
    </main>
  )
}
