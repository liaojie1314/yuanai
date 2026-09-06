import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ExecutionNodePairing, ToolConnection, ToolExecution } from '@yuanai/types'
import { useAuthStore } from '../stores/auth.store.js'
import type {
  McpEnableToolsInput,
  McpServerCreateInput,
  McpToolExecuteInput,
  ResourceGrantInput,
  ToolConnectionInput,
  ToolExecuteInput,
} from '../api/tools.js'
import {
  cancelToolExecution,
  createMcpServer,
  createResourceGrant,
  createToolConnection,
  deleteArtifact,
  deleteToolConnection,
  discoverMcpServer,
  enableMcpTools,
  executeMcpTool,
  executeTool,
  listArtifacts,
  listExecutionNodes,
  listMcpServers,
  listResourceGrants,
  listToolCatalog,
  listToolConnections,
  listToolExecutions,
  pairExecutionNode,
  revokeExecutionNode,
} from '../api/tools.js'

/** 仍会发生变化、需要轮询刷新的工具执行状态。 */
const ACTIVE_TOOL_EXECUTION_STATUSES = new Set<ToolExecution['status']>([
  'queued',
  'running',
  'waiting',
])

/** 判断工具执行是否已进入终态，用于时间线停止轮询与结果展示。 */
export function isTerminalToolExecution(status: ToolExecution['status']): boolean {
  return !ACTIVE_TOOL_EXECUTION_STATUSES.has(status)
}

/** 获取当前用户可用的内置与 MCP 工具目录（不含任何凭证）。 */
export function useToolCatalog() {
  const accessToken = useAuthStore((state) => state.accessToken)
  return useQuery({
    queryKey: ['tool-catalog'],
    queryFn: listToolCatalog,
    enabled: Boolean(accessToken),
    staleTime: 60_000,
  })
}

/** 获取当前用户的工具连接列表。 */
export function useToolConnections() {
  const accessToken = useAuthStore((state) => state.accessToken)
  return useQuery({
    queryKey: ['tool-connections'],
    queryFn: listToolConnections,
    enabled: Boolean(accessToken),
  })
}

/** 获取工具执行审计时间线；未终态的执行按受限频率轮询。 */
export function useToolExecutions(limit = 50) {
  const accessToken = useAuthStore((state) => state.accessToken)
  return useQuery({
    queryKey: ['tool-executions', limit],
    queryFn: () => listToolExecutions(limit),
    enabled: Boolean(accessToken),
    refetchInterval: (query) =>
      query.state.data?.some((execution) => !isTerminalToolExecution(execution.status))
        ? 2_500
        : false,
  })
}

/** 获取当前用户的 Artifact 元数据列表。 */
export function useToolArtifacts() {
  const accessToken = useAuthStore((state) => state.accessToken)
  return useQuery({
    queryKey: ['tool-artifacts'],
    queryFn: listArtifacts,
    enabled: Boolean(accessToken),
  })
}

/** 获取当前用户的桌面执行节点列表。 */
export function useExecutionNodes() {
  const accessToken = useAuthStore((state) => state.accessToken)
  return useQuery({
    queryKey: ['execution-nodes'],
    queryFn: listExecutionNodes,
    enabled: Boolean(accessToken),
  })
}

/** 获取当前用户的本机资源授权元数据（不含真实路径）。 */
export function useResourceGrants() {
  const accessToken = useAuthStore((state) => state.accessToken)
  return useQuery({
    queryKey: ['resource-grants'],
    queryFn: listResourceGrants,
    enabled: Boolean(accessToken),
  })
}

/** 获取当前用户的 MCP Server 列表及其 schema 快照状态。 */
export function useMcpServers() {
  const accessToken = useAuthStore((state) => state.accessToken)
  return useQuery({
    queryKey: ['mcp-servers'],
    queryFn: listMcpServers,
    enabled: Boolean(accessToken),
  })
}

/** 创建工具连接，成功后刷新连接列表。 */
export function useCreateToolConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ToolConnectionInput) => createToolConnection(input),
    onSuccess: (connection: ToolConnection) => {
      queryClient.invalidateQueries({ queryKey: ['tool-connections'] })
      queryClient.setQueryData<ToolConnection[]>(['tool-connections'], (previous) => {
        const existing = previous ?? []
        return existing.some((item) => item.id === connection.id)
          ? previous
          : [connection, ...existing]
      })
    },
  })
}

/** 撤销工具连接，成功后刷新连接列表。 */
export function useDeleteToolConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteToolConnection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tool-connections'] })
    },
  })
}

/** 手动执行工具，成功后刷新执行时间线。 */
export function useExecuteTool() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ToolExecuteInput) => executeTool(input),
    onSuccess: (execution) => {
      queryClient.invalidateQueries({ queryKey: ['tool-executions'] })
      queryClient.setQueryData<ToolExecution[]>(['tool-executions', 50], (previous) => {
        const existing = previous ?? []
        return existing.some((item) => item.id === execution.id)
          ? previous
          : [execution, ...existing]
      })
    },
  })
}

/** 取消尚未完成的工具执行，成功后以最新快照替换缓存。 */
export function useCancelToolExecution() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => cancelToolExecution(id),
    onSuccess: (execution) => {
      queryClient.invalidateQueries({ queryKey: ['tool-executions'] })
      queryClient.setQueryData<ToolExecution[]>(['tool-executions', 50], (previous) =>
        previous?.map((item) => (item.id === execution.id ? execution : item))
      )
    },
  })
}

/** 删除 Artifact 及其存储对象，成功后刷新 Artifact 列表。 */
export function useDeleteArtifact() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteArtifact(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tool-artifacts'] })
    },
  })
}

/** 创建桌面节点配对挑战；配对码只在本次结果中出现一次，由调用方展示。 */
export function usePairExecutionNode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; platform: string; appVersion: string }) =>
      pairExecutionNode(input),
    onSuccess: (_pairing: ExecutionNodePairing) => {
      queryClient.invalidateQueries({ queryKey: ['execution-nodes'] })
    },
  })
}

/** 撤销桌面节点并使其未执行任务失效。 */
export function useRevokeExecutionNode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => revokeExecutionNode(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['execution-nodes'] })
      queryClient.invalidateQueries({ queryKey: ['resource-grants'] })
    },
  })
}

/** 记录桌面资源授权元数据，成功后刷新授权列表。 */
export function useCreateResourceGrant() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ResourceGrantInput) => createResourceGrant(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resource-grants'] })
    },
  })
}

/** 添加远程 MCP Server，成功后刷新 MCP 列表。 */
export function useCreateMcpServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: McpServerCreateInput) => createMcpServer(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-servers'] })
    },
  })
}

/** 触发 MCP schema 重新发现；schema 变化时后端会自动暂停服务器。 */
export function useDiscoverMcpServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => discoverMcpServer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-servers'] })
    },
  })
}

/** 仅启用 schema 快照中明确选择的 MCP 工具。 */
export function useEnableMcpTools() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ serverId, input }: { serverId: string; input: McpEnableToolsInput }) =>
      enableMcpTools(serverId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-servers'] })
    },
  })
}

/** 调用已启用的 MCP 工具，成功后刷新执行时间线。 */
export function useExecuteMcpTool() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ serverId, input }: { serverId: string; input: McpToolExecuteInput }) =>
      executeMcpTool(serverId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tool-executions'] })
    },
  })
}
