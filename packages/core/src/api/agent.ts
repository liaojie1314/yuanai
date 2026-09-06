import type {
  AdminAgentRun,
  AgentEvent,
  AgentRun,
  AgentStep,
  ApprovalRequest,
  Assistant,
} from '@yuanai/types'

import { getPlatformAdapter, type StreamHandle } from '../platform/index.js'
import { apiClient, getAccessToken, getApiBaseUrl } from './client.js'

/** 创建 Agent Run 的请求参数。 */
export interface AgentRunInput {
  assistantId: string
  goal: string
  model?: string
  conversationId?: string
  parentRunId?: string
  maxSteps?: number
  idempotencyKey?: string
}

/** 创建或更新 Assistant 的请求参数。 */
export interface AssistantInput {
  name: string
  description?: string
  instructions?: string
  defaultModel: string
  autonomyLevel?: string
  isDefault?: boolean
}

/** Agent SSE 事件处理器。 */
export interface AgentEventHandlers {
  onEvent: (event: AgentEvent) => void
  onTerminal?: (run: AgentRun) => void
  onError?: (error: Error) => void
}

/** 列出当前用户的 Assistant。 */
export async function listAssistants(): Promise<Assistant[]> {
  return (await apiClient.get<Assistant[]>('/agent/assistants')).data
}

/** 创建 Assistant。 */
export async function createAssistant(input: AssistantInput): Promise<Assistant> {
  return (await apiClient.post<Assistant>('/agent/assistants', input)).data
}

/** 更新 Assistant。 */
export async function updateAssistant(
  id: string,
  input: Partial<AssistantInput>
): Promise<Assistant> {
  return (await apiClient.patch<Assistant>(`/agent/assistants/${id}`, input)).data
}

/** 删除 Assistant。 */
export async function deleteAssistant(id: string): Promise<void> {
  await apiClient.delete(`/agent/assistants/${id}`)
}

/** 创建 Agent Run；后端以 202 接受并异步排队。 */
export async function createAgentRun(input: AgentRunInput): Promise<AgentRun> {
  return (await apiClient.post<AgentRun>('/agent/runs', input)).data
}

/** 列出当前用户的 Agent Run。 */
export async function listAgentRuns(): Promise<AgentRun[]> {
  return (await apiClient.get<AgentRun[]>('/agent/runs')).data
}

/** 列出当前用户可见的审批请求。 */
export async function listAgentApprovals(): Promise<ApprovalRequest[]> {
  return (await apiClient.get<ApprovalRequest[]>('/agent/approvals')).data
}

/** 列出管理员可见的已脱敏 Agent Run 摘要。 */
export async function listAdminAgentRuns(): Promise<AdminAgentRun[]> {
  return (await apiClient.get<AdminAgentRun[]>('/admin/agent-runs')).data
}

/** 获取 Agent Run 详情。 */
export async function getAgentRun(id: string): Promise<AgentRun> {
  return (await apiClient.get<AgentRun>(`/agent/runs/${id}`)).data
}

/** 获取 Run 的步骤时间线。 */
export async function listAgentSteps(id: string): Promise<AgentStep[]> {
  return (await apiClient.get<AgentStep[]>(`/agent/runs/${id}/steps`)).data
}

/** 获取指定游标之后的已持久化事件。 */
export async function listAgentEvents(id: string, lastEventId = 0): Promise<AgentEvent[]> {
  return (
    await apiClient.get<AgentEvent[]>(`/agent/runs/${id}/events`, {
      headers: { 'Last-Event-ID': String(lastEventId) },
    })
  ).data
}

/** 取消 Agent Run。 */
export async function cancelAgentRun(id: string): Promise<AgentRun> {
  return (await apiClient.post<AgentRun>(`/agent/runs/${id}/cancel`)).data
}

/** 提交澄清输入并恢复 Run。 */
export async function submitAgentInput(id: string, input: string): Promise<AgentRun> {
  return (await apiClient.post<AgentRun>(`/agent/runs/${id}/input`, { input })).data
}

/** 提交一次审批决定。 */
export async function decideAgentApproval(
  id: string,
  decision: 'approve' | 'deny',
  note?: string
): Promise<ApprovalRequest> {
  return (await apiClient.post<ApprovalRequest>(`/agent/approvals/${id}`, { decision, note })).data
}

/**
 * 建立 Agent SSE 连接；事件按 sequence 去重，并把最新游标用于断线重连。
 * @param id Run ID
 * @param handlers 事件、终态和错误回调
 * @returns 可主动关闭的流句柄
 */
export function openAgentEventStream(id: string, handlers: AgentEventHandlers): StreamHandle {
  let lastEventId = 0
  const seen = new Set<number>()
  let handle: StreamHandle | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let closed = false
  let terminalNotified = false
  const terminalStatuses = new Set<AgentRun['status']>(['succeeded', 'failed', 'cancelled'])
  const scheduleReconnect = (): void => {
    if (closed || terminalNotified || reconnectTimer !== undefined) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      connect()
    }, 1000)
  }
  const connect = (): void => {
    if (closed || terminalNotified) return
    const token = getAccessToken()
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      'Last-Event-ID': String(lastEventId),
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    }
    handle = getPlatformAdapter().stream(
      {
        url: `${getApiBaseUrl()}/agent/runs/${id}/stream`,
        method: 'GET',
        headers,
      },
      {
        onMessage: (message) => {
          if (message.data === '[DONE]') {
            void getAgentRun(id)
              .then((run) => {
                if (terminalStatuses.has(run.status)) {
                  terminalNotified = true
                  handlers.onTerminal?.(run)
                } else {
                  scheduleReconnect()
                }
              })
              .catch((error: unknown) => {
                const normalized = error instanceof Error ? error : new Error(String(error))
                handlers.onError?.(normalized)
                scheduleReconnect()
              })
            return
          }
          try {
            const payload = JSON.parse(message.data) as Record<string, unknown>
            const sequence = Number(message.id ?? payload.sequence)
            if (!Number.isInteger(sequence) || seen.has(sequence)) return
            seen.add(sequence)
            lastEventId = Math.max(lastEventId, sequence)
            handlers.onEvent({
              id: sequence,
              runId: id,
              sequence,
              eventType: message.event,
              payload,
              createdAt: new Date().toISOString(),
            })
            if (
              message.event === 'run_completed' ||
              message.event === 'run_failed' ||
              message.event === 'run_cancelled'
            ) {
              void getAgentRun(id).then((run) => {
                if (terminalStatuses.has(run.status) && !terminalNotified) {
                  terminalNotified = true
                  handlers.onTerminal?.(run)
                }
              })
            }
          } catch (error) {
            handlers.onError?.(error instanceof Error ? error : new Error(String(error)))
          }
        },
        onError: (error) => {
          handlers.onError?.(error)
          scheduleReconnect()
        },
      }
    )
  }
  connect()
  return {
    close: () => {
      closed = true
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
      handle?.close()
    },
  }
}
