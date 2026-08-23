import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import {
  cancelAgentRun,
  createAgentRun,
  decideAgentApproval,
  getAgentRun,
  listAgentEvents,
  listAgentSteps,
  openAgentEventStream,
  submitAgentInput,
  type AgentEventHandlers,
  type AgentRunInput,
} from '../api/agent.js'

/** 查询单个 Agent Run，并在刷新后恢复服务端状态。 */
export function useAgentRun(id: string | undefined) {
  return useQuery({
    queryKey: ['agent-run', id],
    queryFn: () => {
      if (!id) throw new Error('Agent run id is required')
      return getAgentRun(id)
    },
    enabled: id !== undefined,
  })
}

/** 查询 Run 的步骤时间线。 */
export function useAgentSteps(id: string | undefined) {
  return useQuery({
    queryKey: ['agent-steps', id],
    queryFn: () => {
      if (!id) throw new Error('Agent run id is required')
      return listAgentSteps(id)
    },
    enabled: id !== undefined,
  })
}

/** 查询指定游标之后的 Run 事件。 */
export function useAgentEvents(id: string | undefined, lastEventId = 0) {
  return useQuery({
    queryKey: ['agent-events', id, lastEventId],
    queryFn: () => {
      if (!id) throw new Error('Agent run id is required')
      return listAgentEvents(id, lastEventId)
    },
    enabled: id !== undefined,
  })
}

/** 创建 Run，并将 202 返回的 queued 状态立即写入缓存。 */
export function useCreateAgentRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AgentRunInput) => createAgentRun(input),
    onSuccess: (run) => {
      queryClient.setQueryData(['agent-run', run.id], run)
    },
  })
}

/** 取消 Run 并同步缓存。 */
export function useCancelAgentRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => cancelAgentRun(id),
    onSuccess: (run) => {
      queryClient.setQueryData(['agent-run', run.id], run)
    },
  })
}

/** 提交澄清输入并同步重新排队后的 Run。 */
export function useSubmitAgentInput() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: string }) => submitAgentInput(id, input),
    onSuccess: (run) => {
      queryClient.setQueryData(['agent-run', run.id], run)
    },
  })
}

/** 提交工具审批决定。 */
export function useDecideAgentApproval() {
  return useMutation({
    mutationFn: ({
      id,
      decision,
      note,
    }: {
      id: string
      decision: 'approve' | 'deny'
      note?: string
    }) => decideAgentApproval(id, decision, note),
  })
}

/**
 * 订阅 Run 的可重放 SSE，并把去重后的事件写入 Query 缓存。
 * @param id Run ID
 * @param handlers 可选的额外事件回调
 */
export function useAgentRunStream(
  id: string | undefined,
  handlers?: Partial<AgentEventHandlers>
): void {
  const queryClient = useQueryClient()
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!id) return undefined
    const stream = openAgentEventStream(id, {
      onEvent: (event) => {
        const existing =
          queryClient.getQueryData<readonly (typeof event)[]>(['agent-events', id, 0]) ?? []
        if (existing.some((item) => item.sequence === event.sequence)) return
        queryClient.setQueryData(['agent-events', id, 0], [...existing, event])
        handlersRef.current?.onEvent?.(event)
      },
      onTerminal: (run) => {
        queryClient.setQueryData(['agent-run', id], run)
        handlersRef.current?.onTerminal?.(run)
      },
      onError: (error) => handlersRef.current?.onError?.(error),
    })
    return () => stream.close()
  }, [id, queryClient])
}
