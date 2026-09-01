import type {
  ArtifactMeta,
  ExecutionNode,
  ExecutionNodePairing,
  ExecutionNodeRegistration,
  ExecutionNodeTokenRenewal,
  McpServer,
  ResourceGrant,
  ToolCatalogItem,
  ToolConnection,
  ToolConnectionKind,
  ToolExecution,
  ToolExecutionLocation,
} from '@yuanai/types'

import { apiClient } from './client.js'

/** 创建工具连接的请求参数；服务端只保存 secret_ref，不接受明文 secret。 */
export interface ToolConnectionInput {
  kind: ToolConnectionKind
  provider: string
  displayName: string
  secretRef?: string | null
  scopes?: string[]
  metadata?: Record<string, unknown>
}

/** 手动执行工具的请求参数；有副作用的工具只会进入 waiting，不会绕过审批。 */
export interface ToolExecuteInput {
  toolName: string
  arguments: Record<string, unknown>
  executionLocation?: ToolExecutionLocation
  idempotencyKey?: string
  runId?: string
  nodeId?: string
}

/** 创建桌面节点配对挑战的请求参数。 */
export interface ExecutionNodePairInput {
  name: string
  platform: string
  appVersion: string
  capabilities?: string[]
}

/** 使用一次性配对码登记 Desktop 节点的请求参数。 */
export interface ExecutionNodeRegisterInput {
  pairingCode: string
  publicKey: string
  name: string
  platform: string
  appVersion: string
  capabilities?: string[]
  protocolVersion: string
}

/** 节点令牌续期的请求参数；由 Desktop 节点用登记私钥签署旧令牌后自行调用。 */
export interface ExecutionNodeTokenRenewalInput {
  nodeId: string
  token: string
  signature: string
}

/** 创建本机资源授权的请求参数；真实路径只保存在节点本地。 */
export interface ResourceGrantInput {
  nodeId: string
  kind: 'file' | 'directory' | 'browser_profile' | 'application'
  resourceId: string
  displayName: string
  scopes?: string[]
}

/** 添加远程 HTTP 或受控 stdio MCP Server 的请求参数。 */
export interface McpServerCreateInput {
  name: string
  transport?: 'streamable_http' | 'stdio'
  endpointUrl?: string
  command?: string
  commandArgs?: string[]
  connectionId: string
}

/** 明确启用 MCP 工具列表的请求参数。 */
export interface McpEnableToolsInput {
  enabledTools: string[]
}

/** 调用已启用 MCP 工具的请求参数。 */
export interface McpToolExecuteInput {
  toolName: string
  arguments: Record<string, unknown>
  runId?: string
  approvalId?: string
}

/** 获取不含凭证的内置工具目录。 */
export async function listToolCatalog(): Promise<ToolCatalogItem[]> {
  return (await apiClient.get<ToolCatalogItem[]>('/tools/catalog')).data
}

/** 创建工具连接；仅保存 secret_ref，后端返回 201。 */
export async function createToolConnection(input: ToolConnectionInput): Promise<ToolConnection> {
  return (await apiClient.post<ToolConnection>('/tool-connections', input)).data
}

/** 列出当前用户的工具连接，永不跨租户返回。 */
export async function listToolConnections(): Promise<ToolConnection[]> {
  return (await apiClient.get<ToolConnection[]>('/tool-connections')).data
}

/** 撤销工具连接并保留审计记录；后端返回 204。 */
export async function deleteToolConnection(id: string): Promise<void> {
  await apiClient.delete(`/tool-connections/${id}`)
}

/** 手动执行工具；后端以 202 接受并返回执行审计快照。 */
export async function executeTool(input: ToolExecuteInput): Promise<ToolExecution> {
  return (await apiClient.post<ToolExecution>('/tool-executions', input)).data
}

/** 列出当前用户的工具执行审计记录。 */
export async function listToolExecutions(limit?: number): Promise<ToolExecution[]> {
  return (await apiClient.get<ToolExecution[]>('/tool-executions', { params: { limit } })).data
}

/** 取消尚未完成的工具执行；执行器在安全检查点读取此状态。 */
export async function cancelToolExecution(id: string): Promise<ToolExecution> {
  return (await apiClient.post<ToolExecution>(`/tool-executions/${id}/cancel`)).data
}

/** 列出当前用户的 Artifact 元数据。 */
export async function listArtifacts(): Promise<ArtifactMeta[]> {
  return (await apiClient.get<ArtifactMeta[]>('/artifacts')).data
}

/** 按租户返回 Artifact 详情。 */
export async function getArtifact(id: string): Promise<ArtifactMeta> {
  return (await apiClient.get<ArtifactMeta>(`/artifacts/${id}`)).data
}

/** 删除 Artifact 及其存储对象；后端返回 204。 */
export async function deleteArtifact(id: string): Promise<void> {
  await apiClient.delete(`/artifacts/${id}`)
}

/** 创建桌面节点配对挑战，返回仅显示一次的配对码；后端返回 201。 */
export async function pairExecutionNode(
  input: ExecutionNodePairInput
): Promise<ExecutionNodePairing> {
  return (await apiClient.post<ExecutionNodePairing>('/execution-nodes/pair', input)).data
}

/** 使用一次性配对码登记 Desktop 节点，返回短期会话凭证；后端返回 201。 */
export async function registerExecutionNode(
  input: ExecutionNodeRegisterInput
): Promise<ExecutionNodeRegistration> {
  return (await apiClient.post<ExecutionNodeRegistration>('/execution-nodes/register', input)).data
}

/** 节点用登记私钥签署旧令牌换取新的短期会话凭证。 */
export async function renewExecutionNodeToken(
  input: ExecutionNodeTokenRenewalInput
): Promise<ExecutionNodeTokenRenewal> {
  return (await apiClient.post<ExecutionNodeTokenRenewal>('/execution-nodes/token', input)).data
}

/** 列出当前用户的桌面执行节点。 */
export async function listExecutionNodes(): Promise<ExecutionNode[]> {
  return (await apiClient.get<ExecutionNode[]>('/execution-nodes')).data
}

/** 撤销桌面节点并使未执行任务失效。 */
export async function revokeExecutionNode(id: string): Promise<ExecutionNode> {
  return (await apiClient.post<ExecutionNode>(`/execution-nodes/${id}/revoke`)).data
}

/** 记录 Desktop 原生选择器授予的资源授权；后端返回 201。 */
export async function createResourceGrant(input: ResourceGrantInput): Promise<ResourceGrant> {
  return (await apiClient.post<ResourceGrant>('/resource-grants', input)).data
}

/** 列出当前用户的资源授权。 */
export async function listResourceGrants(): Promise<ResourceGrant[]> {
  return (await apiClient.get<ResourceGrant[]>('/resource-grants')).data
}

/** 添加尚未发现 schema 的远程 MCP Server；后端返回 201。 */
export async function createMcpServer(input: McpServerCreateInput): Promise<McpServer> {
  return (await apiClient.post<McpServer>('/mcp-servers', input)).data
}

/** 列出当前用户的 MCP Server。 */
export async function listMcpServers(): Promise<McpServer[]> {
  return (await apiClient.get<McpServer[]>('/mcp-servers')).data
}

/** 触发 MCP schema 发现；schema 变更时后端会自动暂停并清空已启用工具。 */
export async function discoverMcpServer(id: string): Promise<McpServer> {
  return (await apiClient.post<McpServer>(`/mcp-servers/${id}/discover`)).data
}

/** 仅启用 schema 快照中用户明确选择的 MCP 工具。 */
export async function enableMcpTools(id: string, input: McpEnableToolsInput): Promise<McpServer> {
  return (await apiClient.post<McpServer>(`/mcp-servers/${id}/tools`, input)).data
}

/** 调用明确启用的 MCP 工具；后端以 202 接受并返回执行审计快照。 */
export async function executeMcpTool(
  serverId: string,
  input: McpToolExecuteInput
): Promise<ToolExecution> {
  return (await apiClient.post<ToolExecution>(`/mcp-servers/${serverId}/execute`, input)).data
}
