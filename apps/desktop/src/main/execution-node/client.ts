import WebSocket from 'ws'

import {
  EXECUTION_NODE_PROTOCOL_VERSION,
  buildSignedTerminalMessage,
  canonicalJson,
  encodeBase64Url,
  generateEd25519KeyPair,
  parseServerMessage,
  signBytes,
} from './protocol'
import type { NodeMessage, NodeTerminalMessage } from './protocol'
import { JobCancelledError, ToolExecutionFailure } from './jobs'
import type { ExecuteJobInput } from './jobs'
import type { ExecutionNodeIdentity } from './identity-store'

export { JobCancelledError, ToolExecutionFailure }

/** 客户端所需的节点身份持久化最小接口。 */
export interface ExecutionNodeIdentityPersistence {
  /** 读取并缓存节点身份。 */
  load(): Promise<ExecutionNodeIdentity | null>
  /** 保存节点身份。 */
  save(identity: ExecutionNodeIdentity): Promise<void>
  /** 同步读取内存身份。 */
  getCached(): ExecutionNodeIdentity | null
}

/** 客户端状态机的全部状态。 */
export type ExecutionNodeClientState =
  'idle' | 'registering' | 'connecting' | 'online' | 'reconnecting' | 'error' | 'stopped'

/** 服务端投递、等待本地用户审批的任务。 */
export interface PendingJob {
  /** 服务端执行 ID。 */
  executionId: string
  /** 工具名。 */
  toolName: string
  /** 工具版本。 */
  toolVersion: string
  /** 解密后的工具参数。 */
  arguments: Record<string, unknown>
  /** 服务端提供的参数预览。 */
  argumentsPreview: string
  /** 任务有效期 ISO 字符串。 */
  expiresAt: string
}

/** 任务执行器的最小能力。 */
export interface ExecutionNodeJobExecutor {
  /** 执行一个本地工具任务。 */
  executeJob(input: ExecuteJobInput): Promise<{ result: Record<string, unknown> }>
}

/** 节点客户端使用的最小 WebSocket 接口，兼容 Node 与浏览器的全局实现。 */
export interface NodeWebSocket {
  /** 当前连接状态；1 表示已打开。 */
  readonly readyState: number
  /** 发送一帧文本。 */
  send(data: string): void
  /** 关闭连接。 */
  close(code?: number, reason?: string): void
  /** 立即释放底层连接，不等待远端完成关闭握手。 */
  terminate?(): void
  addEventListener(type: 'open', listener: () => void): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  addEventListener(type: 'close', listener: () => void): void
  addEventListener(type: 'error', listener: () => void): void
  removeEventListener(type: string, listener: (...args: unknown[]) => void): void
}

/** WebSocket 构造器签名。 */
export type NodeWebSocketConstructor = new (url: string) => NodeWebSocket

/** 注册与续期共用的最小 HTTP 响应。 */
export interface NodeHttpResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

/** 最小 fetch 签名，便于测试注入。 */
export type NodeFetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }
) => Promise<NodeHttpResponse>

/** 注册节点所需的输入。 */
export interface ExecutionNodeRegisterInput {
  /** 一次性配对码。 */
  pairingCode: string
  /** 节点显示名称。 */
  name: string
  /** 平台标识。 */
  platform: string
  /** 应用版本。 */
  appVersion: string
  /** 能力白名单子集。 */
  capabilities: string[]
}

/** 客户端的显式依赖与可调参数。 */
export interface ExecutionNodeClientOptions {
  /** 加密身份存储。 */
  identityStore: ExecutionNodeIdentityPersistence
  /** 本地任务执行器。 */
  jobs: ExecutionNodeJobExecutor
  /** 已校验的运行时配置。 */
  runtimeConfig: { apiBaseUrl: string }
  /** 连接状态变化回调。 */
  onStateChange?(state: ExecutionNodeClientState): void
  /** 收到待审批任务时回调。 */
  onJobOffer?(job: PendingJob): void
  /** 任务被本地接受并开始执行时回调。 */
  onJobStarted?(executionId: string): void
  /** 任务终态已发送并暂存时回调。 */
  onJobSettled?(executionId: string): void
  /** 服务端取消任务时回调，用于清除本地审批状态。 */
  onJobCancelled?(executionId: string): void
  /** 时间源，毫秒。 */
  now?(): number
  /** WebSocket 构造器；缺省使用主进程的 Node WebSocket 实现。 */
  webSocketCtor?: NodeWebSocketConstructor
  /** fetch 实现；缺省使用全局 fetch。 */
  fetchFn?: NodeFetchLike
  /** 心跳间隔毫秒；缺省 25000。 */
  heartbeatIntervalMs?: number
  /** 挑战超时毫秒；缺省 10000。 */
  challengeTimeoutMs?: number
  /** 令牌提前刷新余量毫秒；缺省 120000。 */
  tokenRefreshLeadMs?: number
  /** 注册请求超时毫秒；缺省 10000。 */
  registerTimeoutMs?: number
}

interface RegisterResponse {
  nodeId: string
  nodeToken: string
  expiresAt: string
}

interface RenewalResponse {
  nodeToken: string
  expiresAt: string
}

interface ActiveJob {
  controller: AbortController
  lastProgress: number | null
  lastProgressAt: number
}

const WEB_SOCKET_OPEN = 1
const HEARTBEAT_INTERVAL_MS = 25_000
const CHALLENGE_TIMEOUT_MS = 10_000
const TOKEN_REFRESH_LEAD_MS = 120_000
const REGISTER_TIMEOUT_MS = 10_000
const RECONNECT_BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 30_000] as const
const RECONNECT_JITTER_MS = 500
const PROGRESS_THROTTLE_MS = 500
const MAX_ERROR_CODE_LENGTH = 100
const MAX_ERROR_MESSAGE_LENGTH = 500

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** 解析 FastAPI 错误体中的 detail 字段作为错误前缀码。 */
async function extractErrorDetail(response: NodeHttpResponse): Promise<string> {
  let detail = ''
  try {
    const body: unknown = await response.json()
    if (isRecord(body) && typeof body['detail'] === 'string') {
      detail = truncate(body['detail'], 120)
    }
  } catch {
    // 响应体不可解析时退回 HTTP 状态码。
  }
  return detail.length > 0 ? `${detail} (HTTP ${response.status})` : `HTTP ${response.status}`
}

/**
 * 执行节点主进程客户端：负责注册、challenge 握手、任务生命周期、
 * 断线重连与未确认终态重放。私钥与令牌只在主进程内使用。
 */
export class ExecutionNodeClient {
  private readonly identityStore: ExecutionNodeIdentityPersistence
  private readonly jobs: ExecutionNodeJobExecutor
  private readonly apiBaseUrl: string
  private readonly now: () => number
  private readonly webSocketCtor: NodeWebSocketConstructor
  private readonly fetchFn: NodeFetchLike
  private readonly heartbeatIntervalMs: number
  private readonly challengeTimeoutMs: number
  private readonly tokenRefreshLeadMs: number
  private readonly registerTimeoutMs: number
  private readonly pendingOffers = new Map<string, PendingJob>()
  private readonly activeJobs = new Map<string, ActiveJob>()

  private state: ExecutionNodeClientState = 'idle'
  private lastError: string | undefined
  private lastActiveAt = 0
  private socket: NodeWebSocket | undefined
  private socketGeneration = 0
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined
  private challengeTimer: ReturnType<typeof setTimeout> | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private backoffIndex = 0
  private readonly onStateChange: ((state: ExecutionNodeClientState) => void) | undefined
  private readonly onJobOffer: ((job: PendingJob) => void) | undefined
  private readonly onJobStarted: ((executionId: string) => void) | undefined
  private readonly onJobSettled: ((executionId: string) => void) | undefined
  private readonly onJobCancelled: ((executionId: string) => void) | undefined

  public constructor(options: ExecutionNodeClientOptions) {
    this.identityStore = options.identityStore
    this.jobs = options.jobs
    this.apiBaseUrl = options.runtimeConfig.apiBaseUrl
    this.now = options.now ?? (() => Date.now())
    this.webSocketCtor = options.webSocketCtor ?? (WebSocket as unknown as NodeWebSocketConstructor)
    this.fetchFn = options.fetchFn ?? ((url, init) => fetch(url, init) as Promise<NodeHttpResponse>)
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS
    this.challengeTimeoutMs = options.challengeTimeoutMs ?? CHALLENGE_TIMEOUT_MS
    this.tokenRefreshLeadMs = options.tokenRefreshLeadMs ?? TOKEN_REFRESH_LEAD_MS
    this.registerTimeoutMs = options.registerTimeoutMs ?? REGISTER_TIMEOUT_MS
    this.onStateChange = options.onStateChange
    this.onJobOffer = options.onJobOffer
    this.onJobStarted = options.onJobStarted
    this.onJobSettled = options.onJobSettled
    this.onJobCancelled = options.onJobCancelled
  }

  /** 当前状态机状态。 */
  public getState(): ExecutionNodeClientState {
    return this.state
  }

  /** 最近一次错误码或消息；供净化状态展示。 */
  public getLastError(): string | undefined {
    return this.lastError
  }

  /** 最近一次收到服务端消息的时间戳；0 表示尚未收到。 */
  public getLastActiveAt(): number {
    return this.lastActiveAt
  }

  /**
   * 使用一次性配对码注册节点，成功后立即建立连接。
   * @param input 配对码、名称、平台、版本与能力子集
   * @throws 注册失败或响应不合法时抛错，状态进入 error
   */
  public async register(input: ExecutionNodeRegisterInput): Promise<void> {
    if (this.state === 'stopped') throw new Error('EXECUTION_NODE_STOPPED')
    this.setState('registering')
    try {
      const existing = this.identityStore.getCached() ?? (await this.identityStore.load())
      const keyPair = existing
        ? {
            privateKeyJwk: existing.privateKeyJwk,
            publicKeyBase64Url: existing.publicKeyBase64Url,
          }
        : generateEd25519KeyPair()
      const response = await this.requestJson(`${this.apiBaseUrl}/execution-nodes/register`, {
        pairing_code: input.pairingCode,
        public_key: keyPair.publicKeyBase64Url,
        name: input.name,
        platform: input.platform,
        app_version: input.appVersion,
        capabilities: input.capabilities,
        protocol_version: EXECUTION_NODE_PROTOCOL_VERSION,
      })
      const payload = parseRegisterResponse(response)
      const identity: ExecutionNodeIdentity = {
        nodeId: payload.nodeId,
        name: input.name,
        platform: input.platform,
        appVersion: input.appVersion,
        capabilities: [...input.capabilities],
        privateKeyJwk: keyPair.privateKeyJwk,
        publicKeyBase64Url: keyPair.publicKeyBase64Url,
        nodeToken: payload.nodeToken,
        tokenExpiresAt: new Date(payload.expiresAt).toISOString(),
        spool: existing?.spool ?? [],
      }
      await this.identityStore.save(identity)
      await this.connect()
    } catch (error: unknown) {
      this.fail(normalizeError(error))
      throw error
    }
  }

  /**
   * 建立或重建 WebSocket 连接；令牌临期时先签名续期。
   * @throws 无身份或续期失败时抛错
   */
  public async connect(): Promise<void> {
    if (this.state === 'stopped') return
    if (this.state === 'connecting' || this.state === 'online') return
    this.clearReconnectTimer()
    this.clearHeartbeatTimer()
    const identity = this.identityStore.getCached() ?? (await this.identityStore.load())
    if (!identity) throw new Error('EXECUTION_NODE_NOT_REGISTERED')
    const fresh = await this.ensureFreshToken(identity)
    this.setState('connecting')
    const generation = this.socketGeneration + 1
    this.socketGeneration = generation
    const socket = new this.webSocketCtor(this.buildWebSocketUrl(fresh.nodeToken))
    this.socket = socket
    socket.addEventListener('open', () => {
      if (generation !== this.socketGeneration) return
      this.startChallengeTimer(socket)
    })
    socket.addEventListener('message', (event) => {
      if (generation !== this.socketGeneration) return
      this.handleRawMessage(event.data)
    })
    const handleDisconnect = (): void => {
      if (generation !== this.socketGeneration) return
      this.handleDisconnect()
    }
    socket.addEventListener('close', handleDisconnect)
    socket.addEventListener('error', handleDisconnect)
  }

  /**
   * 接受一个待审批任务并开始本地执行。
   * @param executionId 服务端执行 ID
   * @throws 任务不存在或已不在待审批状态时抛错
   */
  public acceptJob(executionId: string): void {
    const pending = this.pendingOffers.get(executionId)
    if (!pending || this.activeJobs.has(executionId)) {
      throw new Error('EXECUTION_NODE_JOB_UNKNOWN')
    }
    this.pendingOffers.delete(executionId)
    const controller = new AbortController()
    this.activeJobs.set(executionId, {
      controller,
      lastProgress: null,
      lastProgressAt: 0,
    })
    this.send({ type: 'accepted', execution_id: executionId })
    this.onJobStarted?.(executionId)
    this.runJob(pending, controller).catch((error: unknown) => {
      console.error('Execution node job runner failed', normalizeError(error))
    })
  }

  /**
   * 拒绝一个待审批任务。
   * @param executionId 服务端执行 ID
   * @throws 任务不存在时抛错
   */
  public rejectJob(executionId: string): void {
    if (!this.pendingOffers.delete(executionId)) {
      throw new Error('EXECUTION_NODE_JOB_UNKNOWN')
    }
    this.send({ type: 'rejected', execution_id: executionId })
  }

  /**
   * 主动断开连接但保留身份与重连能力；之后可再次 connect。
   */
  public disconnect(): void {
    this.clearHeartbeatTimer()
    this.clearChallengeTimer()
    this.clearReconnectTimer()
    this.socketGeneration += 1
    const socket = this.socket
    this.socket = undefined
    try {
      socket?.close(1000, 'node disconnect')
    } catch {
      // 连接可能已经关闭。
    }
    if (this.state !== 'stopped') this.setState('idle')
  }

  /** 停止客户端：清理定时器、断开连接并中止正在执行的任务。 */
  public stop(): void {
    this.setState('stopped')
    this.clearHeartbeatTimer()
    this.clearChallengeTimer()
    this.clearReconnectTimer()
    for (const [executionId, active] of Array.from(this.activeJobs.entries())) {
      active.controller.abort()
      this.activeJobs.delete(executionId)
    }
    this.pendingOffers.clear()
    this.socketGeneration += 1
    const socket = this.socket
    this.socket = undefined
    if (!socket) return
    try {
      socket.terminate?.()
      if (!socket.terminate) socket.close(1000, 'node stopped')
    } catch {
      // 强制关闭失败时仍尝试发送正常关闭帧。
      try {
        socket.close(1000, 'node stopped')
      } catch {
        // 连接可能已经关闭。
      }
    }
  }

  private async runJob(pending: PendingJob, controller: AbortController): Promise<void> {
    const executionId = pending.executionId
    try {
      const outcome = await this.jobs.executeJob({
        toolName: pending.toolName,
        arguments: pending.arguments,
        signal: controller.signal,
        onProgress: (progress) => this.reportProgress(executionId, progress),
      })
      await this.sendTerminal({
        type: 'completed',
        executionId,
        result: outcome.result,
        errorCode: null,
        errorMessage: null,
        progress: 100,
      })
    } catch (error: unknown) {
      if (error instanceof JobCancelledError || controller.signal.aborted) {
        await this.sendTerminal({
          type: 'cancelled',
          executionId,
          result: null,
          errorCode: 'TOOL_CANCELLED',
          errorMessage: '任务已被本地用户取消',
          progress: this.activeJobs.get(executionId)?.lastProgress ?? null,
        })
      } else if (error instanceof ToolExecutionFailure) {
        await this.sendTerminal({
          type: 'failed',
          executionId,
          result: null,
          errorCode: truncate(error.code, MAX_ERROR_CODE_LENGTH),
          errorMessage: truncate(error.message, MAX_ERROR_MESSAGE_LENGTH),
          progress: this.activeJobs.get(executionId)?.lastProgress ?? null,
        })
      } else {
        await this.sendTerminal({
          type: 'failed',
          executionId,
          result: null,
          errorCode: 'TOOL_EXECUTION_FAILED',
          errorMessage: truncate(normalizeError(error), MAX_ERROR_MESSAGE_LENGTH),
          progress: this.activeJobs.get(executionId)?.lastProgress ?? null,
        })
      }
    } finally {
      this.activeJobs.delete(executionId)
      this.onJobSettled?.(executionId)
    }
  }

  private reportProgress(executionId: string, progress: number): void {
    const active = this.activeJobs.get(executionId)
    if (!active) return
    active.lastProgress = progress
    const now = this.now()
    if (now - active.lastProgressAt < PROGRESS_THROTTLE_MS) return
    active.lastProgressAt = now
    this.send({ type: 'progress', execution_id: executionId, progress })
  }

  private async sendTerminal(input: {
    type: NodeTerminalMessage['type']
    executionId: string
    result: Record<string, unknown> | null
    errorCode: string | null
    errorMessage: string | null
    progress: number | null
  }): Promise<void> {
    const identity = this.identityStore.getCached() ?? (await this.identityStore.load())
    if (!identity) throw new Error('EXECUTION_NODE_NOT_REGISTERED')
    const message = buildSignedTerminalMessage(
      {
        type: input.type,
        executionId: input.executionId,
        result: input.result,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        progress: input.progress,
      },
      identity.privateKeyJwk
    )
    await this.spoolTerminal(input.executionId, message)
    this.send(message)
  }

  private async spoolTerminal(executionId: string, message: NodeTerminalMessage): Promise<void> {
    const identity = this.identityStore.getCached()
    if (!identity) return
    const filtered = identity.spool.filter((entry) => entry.executionId !== executionId)
    filtered.push({ executionId, message })
    try {
      await this.identityStore.save({ ...identity, spool: filtered })
    } catch (error: unknown) {
      console.error('Execution node spool persistence failed', error)
    }
  }

  private async clearSpool(executionId: string): Promise<void> {
    const identity = this.identityStore.getCached()
    if (!identity) return
    const filtered = identity.spool.filter((entry) => entry.executionId !== executionId)
    if (filtered.length === identity.spool.length) return
    try {
      await this.identityStore.save({ ...identity, spool: filtered })
    } catch (error: unknown) {
      console.error('Execution node spool cleanup failed', error)
    }
  }

  private async resendSpooled(executionId: string): Promise<boolean> {
    const identity = this.identityStore.getCached()
    const entry = identity?.spool.find((item) => item.executionId === executionId)
    if (!entry) return false
    this.send(entry.message)
    return true
  }

  private handleRawMessage(raw: unknown): void {
    let parsed: unknown
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw)
      } catch {
        console.warn('Execution node received a non-JSON frame')
        return
      }
    } else {
      parsed = raw
    }
    const message = parseServerMessage(parsed)
    if (!message) {
      console.warn('Execution node received an unknown message shape')
      return
    }
    this.lastActiveAt = this.now()
    switch (message.type) {
      case 'challenge':
        this.handleChallenge(message.challenge, message.protocol_version)
        break
      case 'job_offer':
        this.handleJobOffer(message).catch((error: unknown) => {
          console.warn('Execution node job offer handling failed', normalizeError(error))
        })
        break
      case 'job_status':
        this.handleJobStatus(message.execution_id).catch((error: unknown) => {
          console.warn('Execution node job status handling failed', normalizeError(error))
        })
        break
      case 'cancel_request':
        this.handleCancelRequest(message.execution_id)
        break
      case 'result_replay_request':
        this.handleResultReplay(message.execution_id).catch((error: unknown) => {
          console.warn('Execution node result replay failed', normalizeError(error))
        })
        break
      case 'ack':
        this.send({ type: 'ack', execution_id: message.execution_id })
        break
      case 'acknowledged':
        void this.clearSpool(message.execution_id)
        break
      default:
        // heartbeat_ack / accepted_ack / rejected_ack / progress_ack 无需动作。
        break
    }
  }

  private handleChallenge(challenge: string, protocolVersion: string): void {
    if (protocolVersion !== EXECUTION_NODE_PROTOCOL_VERSION) {
      this.fail('EXECUTION_NODE_UPDATE_REQUIRED')
      this.socket?.close(1000, 'protocol version mismatch')
      return
    }
    const identity = this.identityStore.getCached()
    if (!identity) {
      this.fail('EXECUTION_NODE_NOT_REGISTERED')
      return
    }
    this.clearChallengeTimer()
    this.backoffIndex = 0
    this.lastError = undefined
    const signature = encodeBase64Url(
      signBytes(identity.privateKeyJwk, new TextEncoder().encode(challenge))
    )
    this.send({ type: 'challenge_response', signature })
    this.setState('online')
    this.startHeartbeat()
  }

  private async handleJobOffer(message: {
    execution_id: string
    tool_name: string
    tool_version: string
    arguments: Record<string, unknown>
    arguments_preview: string
    expires_at: string
  }): Promise<void> {
    const executionId = message.execution_id
    if (await this.resendSpooled(executionId)) return
    const active = this.activeJobs.get(executionId)
    if (active) {
      // accepted 可能在断线时丢失；服务端仍视为 queued 时重发 accepted 以恢复。
      this.send({ type: 'accepted', execution_id: executionId })
      return
    }
    if (this.pendingOffers.has(executionId)) return
    const expiresAtMs = Date.parse(message.expires_at)
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= this.now()) {
      this.send({ type: 'rejected', execution_id: executionId })
      return
    }
    const pending: PendingJob = {
      executionId,
      toolName: message.tool_name,
      toolVersion: message.tool_version,
      arguments: message.arguments,
      argumentsPreview: message.arguments_preview,
      expiresAt: message.expires_at,
    }
    this.pendingOffers.set(executionId, pending)
    this.onJobOffer?.(pending)
  }

  private async handleJobStatus(executionId: string): Promise<void> {
    if (this.activeJobs.has(executionId)) return
    if (await this.resendSpooled(executionId)) return
    await this.sendTerminal({
      type: 'failed',
      executionId,
      result: null,
      errorCode: 'TOOL_NODE_STATE_LOST',
      errorMessage: '节点本地没有该执行的状态，已按失败回传',
      progress: null,
    })
  }

  private handleCancelRequest(executionId: string): void {
    if (this.pendingOffers.delete(executionId)) {
      this.send({ type: 'ack', execution_id: executionId })
      this.onJobCancelled?.(executionId)
      return
    }
    const active = this.activeJobs.get(executionId)
    if (active) {
      active.controller.abort()
      return
    }
    void this.resendSpooled(executionId)
  }

  private async handleResultReplay(executionId: string): Promise<void> {
    if (await this.resendSpooled(executionId)) return
    await this.sendTerminal({
      type: 'failed',
      executionId,
      result: null,
      errorCode: 'TOOL_NODE_STATE_LOST',
      errorMessage: '节点本地没有该执行的终态，已按失败回传',
      progress: null,
    })
  }

  private startHeartbeat(): void {
    this.clearHeartbeatTimer()
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'heartbeat' })
    }, this.heartbeatIntervalMs)
  }

  private startChallengeTimer(socket: NodeWebSocket): void {
    this.clearChallengeTimer()
    this.challengeTimer = setTimeout(() => {
      console.warn('Execution node challenge timed out')
      socket.close(1000, 'challenge timeout')
    }, this.challengeTimeoutMs)
  }

  private handleDisconnect(): void {
    this.socketGeneration += 1
    const socket = this.socket
    this.socket = undefined
    this.clearHeartbeatTimer()
    this.clearChallengeTimer()
    if (this.state === 'stopped') return
    try {
      socket?.close(1000, 'reconnecting')
    } catch {
      // 连接可能已经关闭。
    }
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.state === 'stopped') return
    const backoff =
      RECONNECT_BACKOFF_MS[Math.min(this.backoffIndex, RECONNECT_BACKOFF_MS.length - 1)]
    this.backoffIndex += 1
    const jitter = Math.floor(this.now() % RECONNECT_JITTER_MS)
    const delay = (backoff ?? RECONNECT_BACKOFF_MS[0]) + jitter
    this.setState('reconnecting')
    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error: unknown) => {
        console.warn('Execution node reconnect failed', normalizeError(error))
        this.scheduleReconnect()
      })
    }, delay)
  }

  private async ensureFreshToken(identity: ExecutionNodeIdentity): Promise<ExecutionNodeIdentity> {
    const expiresAtMs = Date.parse(identity.tokenExpiresAt)
    if (Number.isFinite(expiresAtMs) && expiresAtMs - this.now() >= this.tokenRefreshLeadMs) {
      return identity
    }
    await this.renewToken(identity)
    return this.identityStore.getCached() ?? identity
  }

  private async renewToken(identity: ExecutionNodeIdentity): Promise<void> {
    const payload = {
      type: 'token_renewal',
      node_id: identity.nodeId,
      token: identity.nodeToken,
    }
    const signature = encodeBase64Url(
      signBytes(identity.privateKeyJwk, new TextEncoder().encode(canonicalJson(payload)))
    )
    const response = await this.requestJson(`${this.apiBaseUrl}/execution-nodes/token`, {
      node_id: identity.nodeId,
      token: identity.nodeToken,
      signature,
    })
    const renewed = parseRenewalResponse(response)
    await this.identityStore.save({
      ...identity,
      nodeToken: renewed.nodeToken,
      tokenExpiresAt: new Date(renewed.expiresAt).toISOString(),
    })
  }

  private async requestJson(url: string, body: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.registerTimeoutMs)
    try {
      const response = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(await extractErrorDetail(response))
      return await response.json()
    } finally {
      clearTimeout(timeout)
    }
  }

  private buildWebSocketUrl(nodeToken: string): string {
    const base = this.apiBaseUrl
      .replace(/^http:\/\//, 'ws://')
      .replace(/^https:\/\//, 'wss://')
      .replace(/\/$/, '')
    return `${base}/execution-nodes/ws?token=${encodeURIComponent(nodeToken)}`
  }

  private send(message: NodeMessage): void {
    const socket = this.socket
    if (!socket || socket.readyState !== WEB_SOCKET_OPEN) return
    try {
      socket.send(JSON.stringify(message))
    } catch (error: unknown) {
      console.warn('Execution node send failed', normalizeError(error))
    }
  }

  private setState(state: ExecutionNodeClientState): void {
    if (this.state === state) return
    this.state = state
    this.onStateChange?.(state)
  }

  private fail(message: string): void {
    this.lastError = message
    this.setState('error')
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
  }

  private clearChallengeTimer(): void {
    if (this.challengeTimer) {
      clearTimeout(this.challengeTimer)
      this.challengeTimer = undefined
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
  }
}

function parseRegisterResponse(value: unknown): RegisterResponse {
  if (!isRecord(value)) throw new Error('EXECUTION_NODE_RESPONSE_INVALID')
  const nodeId = readString(value['nodeId'])
  const nodeToken = readString(value['nodeToken'])
  const expiresAt = readString(value['expiresAt'])
  if (!nodeId || !nodeToken || !expiresAt || Number.isNaN(Date.parse(expiresAt))) {
    throw new Error('EXECUTION_NODE_RESPONSE_INVALID')
  }
  return { nodeId, nodeToken, expiresAt }
}

function parseRenewalResponse(value: unknown): RenewalResponse {
  if (!isRecord(value)) throw new Error('EXECUTION_NODE_RESPONSE_INVALID')
  const nodeToken = readString(value['nodeToken'])
  const expiresAt = readString(value['expiresAt'])
  if (!nodeToken || !expiresAt || Number.isNaN(Date.parse(expiresAt))) {
    throw new Error('EXECUTION_NODE_RESPONSE_INVALID')
  }
  return { nodeToken, expiresAt }
}

function normalizeError(error: unknown): string {
  if (error instanceof Error && error.message) return truncate(error.message, 240)
  return 'EXECUTION_NODE_UNKNOWN_ERROR'
}
