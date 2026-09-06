import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { apiClient } from '../client.js'
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
  getArtifact,
  listArtifacts,
  listExecutionNodes,
  listMcpServers,
  listResourceGrants,
  listToolCatalog,
  listToolConnections,
  listToolExecutions,
  pairExecutionNode,
  registerExecutionNode,
  renewExecutionNodeToken,
  revokeExecutionNode,
} from '../tools.js'

const catalogItem = {
  name: 'calculate',
  version: '1.0.0',
  description: '安全计算数学表达式',
  inputSchema: { type: 'object' },
  outputSchema: null,
  riskLevel: 'read',
  sideEffect: 'none',
  executionLocation: 'either',
  executionLocations: ['cloud'],
  requiredScopes: [],
  timeoutSeconds: 30,
  maxOutputBytes: 32768,
  idempotent: true,
  supportsCancel: true,
  tags: ['math'],
}

const toolConnection = {
  id: 'conn-1',
  userId: 'user-1',
  kind: 'api_key',
  provider: 'brave',
  displayName: 'Brave Search',
  secretRef: 'vault://brave',
  scopes: ['search'],
  status: 'active',
  metadata: { region: 'cn' },
  lastVerifiedAt: null,
  createdAt: '2026-08-30T00:00:00Z',
  updatedAt: '2026-08-30T00:00:00Z',
}

const toolExecution = {
  id: 'exec-1',
  userId: 'user-1',
  runId: null,
  stepId: null,
  toolName: 'calculate',
  toolVersion: '1.0.0',
  connectionId: null,
  mcpServerId: null,
  executionLocation: 'cloud',
  nodeId: null,
  riskLevel: 'read',
  sideEffect: 'none',
  argumentsPreview: { expression: '1 + 1' },
  argumentsHash: 'hash-1',
  idempotencyKey: null,
  status: 'succeeded',
  resultSummary: '计算完成',
  resultJson: {
    status: 'succeeded',
    summary: '计算完成',
    data: null,
    artifacts: [],
    citations: [],
    metrics: { duration_ms: 3, output_bytes: 12 },
    error: null,
  },
  artifactIds: [],
  errorCode: null,
  errorMessage: null,
  startedAt: '2026-08-30T00:00:00Z',
  finishedAt: '2026-08-30T00:00:00Z',
  nodeDeliveryStatus: null,
  nodeProgress: null,
  nodeLastDeliveredAt: null,
  nodeAcknowledgedAt: null,
  createdAt: '2026-08-30T00:00:00Z',
}

const cancelledExecution = { ...toolExecution, status: 'cancelled' }

const artifact = {
  id: 'artifact-1',
  userId: 'user-1',
  runId: null,
  toolExecutionId: 'exec-1',
  kind: 'document',
  name: 'result.txt',
  mimeType: 'text/plain',
  sizeBytes: 12,
  sha256: 'deadbeef',
  sensitivity: 'normal',
  retentionPolicy: 'standard',
  expiresAt: null,
  preview: null,
  downloadUrl: 'https://api.example.com/api/v1/artifacts/artifact-1/content?expires=1&signature=s',
  createdAt: '2026-08-30T00:00:00Z',
}

const executionNode = {
  id: 'node-1',
  userId: 'user-1',
  name: '工作台',
  platform: 'linux',
  appVersion: '0.4.0',
  capabilities: ['calculate'],
  status: 'offline',
  lastSeenAt: null,
  policy: { allowed_tools: ['calculate'], allowed_resource_ids: [] },
  createdAt: '2026-08-30T00:00:00Z',
  updatedAt: '2026-08-30T00:00:00Z',
}

const pairing = { ...executionNode, pairingCode: 'pair-code-1', expiresAt: '2026-08-30T01:00:00Z' }

const revokedExecutionNode = { ...executionNode, status: 'revoked' }

const registration = {
  nodeId: 'node-1',
  userId: 'user-1',
  nodeToken: 'node-token-1',
  expiresAt: '2026-08-30T01:00:00Z',
  protocolVersion: '1',
}

const renewal = {
  nodeId: 'node-1',
  nodeToken: 'node-token-2',
  expiresAt: '2026-08-30T02:00:00Z',
  protocolVersion: '1',
}

const resourceGrant = {
  id: 'grant-1',
  userId: 'user-1',
  nodeId: 'node-1',
  kind: 'directory',
  resourceId: 'local://projects',
  displayName: '项目目录',
  scopes: ['read'],
  revokedAt: null,
  createdAt: '2026-08-30T00:00:00Z',
}

const mcpServer = {
  id: 'mcp-1',
  userId: 'user-1',
  connectionId: 'conn-1',
  name: 'docs',
  endpointUrl: 'https://mcp.example.com/mcp',
  command: null,
  commandArgs: [],
  transport: 'streamable_http',
  status: 'pending',
  schemaSnapshot: null,
  schemaHash: null,
  enabledTools: [],
  metadata: {},
  lastVerifiedAt: null,
  createdAt: '2026-08-30T00:00:00Z',
  updatedAt: '2026-08-30T00:00:00Z',
}

const discoveredServer = {
  ...mcpServer,
  status: 'active',
  schemaHash: 'hash-2',
  schemaSnapshot: {
    tools: [
      {
        name: 'fetch_docs',
        description: '抓取文档',
        inputSchema: { type: 'object' },
        annotations: { readOnlyHint: true },
      },
    ],
  },
}

let requests: InternalAxiosRequestConfig[]
let originalAdapter: typeof apiClient.defaults.adapter

function respond(config: InternalAxiosRequestConfig, data: unknown, status = 200): AxiosResponse {
  return { config, data, headers: {}, status, statusText: 'OK' }
}

function httpError(status: number, data: unknown): unknown {
  return {
    isAxiosError: true,
    message: `Request failed with status code ${status}`,
    response: { data, status },
  }
}

const successAdapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
  requests.push(config)
  const url = config.url ?? ''
  if (url === '/tools/catalog') return respond(config, [catalogItem])
  if (url === '/tool-connections') {
    return respond(config, config.method === 'post' ? toolConnection : [toolConnection], 201)
  }
  if (url === '/tool-connections/conn-1') return respond(config, null, 204)
  if (url === '/tool-executions') {
    return respond(config, config.method === 'post' ? toolExecution : [toolExecution], 202)
  }
  if (url === '/tool-executions/exec-1/cancel') return respond(config, cancelledExecution)
  if (url === '/artifacts') return respond(config, [artifact])
  if (url === '/artifacts/artifact-1') {
    return config.method === 'delete' ? respond(config, null, 204) : respond(config, artifact)
  }
  if (url === '/execution-nodes/pair') return respond(config, pairing, 201)
  if (url === '/execution-nodes/register') return respond(config, registration, 201)
  if (url === '/execution-nodes/token') return respond(config, renewal)
  if (url === '/execution-nodes') return respond(config, [executionNode])
  if (url === '/execution-nodes/node-1/revoke') return respond(config, revokedExecutionNode)
  if (url === '/resource-grants') {
    return respond(config, config.method === 'post' ? resourceGrant : [resourceGrant], 201)
  }
  if (url === '/mcp-servers') {
    return respond(config, config.method === 'post' ? mcpServer : [mcpServer], 201)
  }
  if (url === '/mcp-servers/mcp-1/discover') return respond(config, discoveredServer)
  if (url === '/mcp-servers/mcp-1/tools') return respond(config, mcpServer)
  if (url === '/mcp-servers/mcp-1/execute') return respond(config, toolExecution, 202)
  throw new Error(`Unexpected request: ${config.method?.toUpperCase()} ${url}`)
}

describe('tool runtime API', () => {
  beforeEach(() => {
    requests = []
    originalAdapter = apiClient.defaults.adapter
    apiClient.defaults.adapter = successAdapter
  })

  afterEach(() => {
    if (originalAdapter === undefined) delete apiClient.defaults.adapter
    else apiClient.defaults.adapter = originalAdapter
  })

  it('lists the builtin tool catalog without exposing credentials', async () => {
    await expect(listToolCatalog()).resolves.toEqual([catalogItem])

    expect(requests[0]?.method).toBe('get')
    expect(requests[0]?.url).toBe('/tools/catalog')
  })

  it('creates, lists and deletes tool connections with camelCase bodies', async () => {
    await expect(
      createToolConnection({
        kind: 'api_key',
        provider: 'brave',
        displayName: 'Brave Search',
        secretRef: 'vault://brave',
        scopes: ['search'],
        metadata: { region: 'cn' },
      })
    ).resolves.toEqual(toolConnection)

    expect(requests[0]?.url).toBe('/tool-connections')
    expect(JSON.parse(String(requests[0]?.data))).toEqual({
      kind: 'api_key',
      provider: 'brave',
      displayName: 'Brave Search',
      secretRef: 'vault://brave',
      scopes: ['search'],
      metadata: { region: 'cn' },
    })

    await expect(listToolConnections()).resolves.toEqual([toolConnection])
    await expect(deleteToolConnection('conn-1')).resolves.toBeUndefined()

    expect(requests[2]?.method).toBe('delete')
    expect(requests[2]?.url).toBe('/tool-connections/conn-1')
  })

  it('executes and cancels tools with the audit snapshot contract', async () => {
    await expect(
      executeTool({
        toolName: 'calculate',
        arguments: { expression: '1 + 1' },
        executionLocation: 'cloud',
        idempotencyKey: 'idem-1',
      })
    ).resolves.toEqual(toolExecution)

    expect(requests[0]?.url).toBe('/tool-executions')
    expect(JSON.parse(String(requests[0]?.data))).toEqual({
      toolName: 'calculate',
      arguments: { expression: '1 + 1' },
      executionLocation: 'cloud',
      idempotencyKey: 'idem-1',
    })

    await expect(listToolExecutions(20)).resolves.toEqual([toolExecution])
    expect(requests[1]?.params).toEqual({ limit: 20 })

    await expect(cancelToolExecution('exec-1')).resolves.toEqual(cancelledExecution)
    expect(requests[2]?.url).toBe('/tool-executions/exec-1/cancel')
  })

  it('lists, fetches and deletes artifacts', async () => {
    await expect(listArtifacts()).resolves.toEqual([artifact])
    await expect(getArtifact('artifact-1')).resolves.toEqual(artifact)
    await expect(deleteArtifact('artifact-1')).resolves.toBeUndefined()

    expect(requests.map((request) => request.url)).toEqual([
      '/artifacts',
      '/artifacts/artifact-1',
      '/artifacts/artifact-1',
    ])
    expect(requests[2]?.method).toBe('delete')
  })

  it('pairs, registers and renews desktop nodes with camelCase bodies', async () => {
    await expect(
      pairExecutionNode({ name: '工作台', platform: 'linux', appVersion: '0.4.0' })
    ).resolves.toEqual(pairing)

    expect(requests[0]?.url).toBe('/execution-nodes/pair')
    expect(JSON.parse(String(requests[0]?.data))).toEqual({
      name: '工作台',
      platform: 'linux',
      appVersion: '0.4.0',
    })

    await expect(
      registerExecutionNode({
        pairingCode: 'pair-code-1',
        publicKey: 'k'.repeat(40),
        name: '工作台',
        platform: 'linux',
        appVersion: '0.4.0',
        protocolVersion: '1',
      })
    ).resolves.toEqual(registration)

    expect(requests[1]?.url).toBe('/execution-nodes/register')
    expect(JSON.parse(String(requests[1]?.data))).toEqual({
      pairingCode: 'pair-code-1',
      publicKey: 'k'.repeat(40),
      name: '工作台',
      platform: 'linux',
      appVersion: '0.4.0',
      protocolVersion: '1',
    })

    await expect(
      renewExecutionNodeToken({
        nodeId: 'node-1',
        token: 'node-token-1',
        signature: 's'.repeat(80),
      })
    ).resolves.toEqual(renewal)

    expect(requests[2]?.url).toBe('/execution-nodes/token')
    expect(JSON.parse(String(requests[2]?.data))).toEqual({
      nodeId: 'node-1',
      token: 'node-token-1',
      signature: 's'.repeat(80),
    })
  })

  it('lists and revokes execution nodes', async () => {
    await expect(listExecutionNodes()).resolves.toEqual([executionNode])
    await expect(revokeExecutionNode('node-1')).resolves.toEqual(revokedExecutionNode)

    expect(requests.map((request) => request.url)).toEqual([
      '/execution-nodes',
      '/execution-nodes/node-1/revoke',
    ])
  })

  it('records and lists resource grants with camelCase bodies', async () => {
    await expect(
      createResourceGrant({
        nodeId: 'node-1',
        kind: 'directory',
        resourceId: 'local://projects',
        displayName: '项目目录',
        scopes: ['read'],
      })
    ).resolves.toEqual(resourceGrant)

    expect(requests[0]?.url).toBe('/resource-grants')
    expect(JSON.parse(String(requests[0]?.data))).toEqual({
      nodeId: 'node-1',
      kind: 'directory',
      resourceId: 'local://projects',
      displayName: '项目目录',
      scopes: ['read'],
    })

    await expect(listResourceGrants()).resolves.toEqual([resourceGrant])
  })

  it('creates, discovers, enables and executes MCP tools', async () => {
    await expect(
      createMcpServer({
        name: 'docs',
        endpointUrl: 'https://mcp.example.com/mcp',
        connectionId: 'conn-1',
      })
    ).resolves.toEqual(mcpServer)

    expect(requests[0]?.url).toBe('/mcp-servers')
    expect(JSON.parse(String(requests[0]?.data))).toEqual({
      name: 'docs',
      endpointUrl: 'https://mcp.example.com/mcp',
      connectionId: 'conn-1',
    })

    await expect(listMcpServers()).resolves.toEqual([mcpServer])
    await expect(discoverMcpServer('mcp-1')).resolves.toEqual(discoveredServer)

    await expect(enableMcpTools('mcp-1', { enabledTools: ['fetch_docs'] })).resolves.toEqual(
      mcpServer
    )
    expect(requests[3]?.url).toBe('/mcp-servers/mcp-1/tools')
    expect(JSON.parse(String(requests[3]?.data))).toEqual({ enabledTools: ['fetch_docs'] })

    await expect(
      executeMcpTool('mcp-1', { toolName: 'fetch_docs', arguments: { url: 'https://x' } })
    ).resolves.toEqual(toolExecution)
    expect(requests[4]?.url).toBe('/mcp-servers/mcp-1/execute')
    expect(JSON.parse(String(requests[4]?.data))).toEqual({
      toolName: 'fetch_docs',
      arguments: { url: 'https://x' },
    })
  })

  it('propagates backend 4xx errors to callers', async () => {
    apiClient.defaults.adapter = async (config) => {
      requests.push(config)
      if (config.url?.endsWith('/cancel'))
        throw httpError(404, { detail: 'TOOL_EXECUTION_NOT_FOUND' })
      throw httpError(422, { detail: 'CONNECTION_KIND_INVALID' })
    }

    await expect(cancelToolExecution('missing')).rejects.toMatchObject({
      response: { status: 404, data: { detail: 'TOOL_EXECUTION_NOT_FOUND' } },
    })
    await expect(
      createToolConnection({ kind: 'api_key', provider: 'brave', displayName: 'Brave Search' })
    ).rejects.toMatchObject({
      response: { status: 422, data: { detail: 'CONNECTION_KIND_INVALID' } },
    })

    expect(requests.map((request) => request.url)).toEqual([
      '/tool-executions/missing/cancel',
      '/tool-connections',
    ])
  })
})
