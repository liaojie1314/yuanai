import type {
  DesktopExecutionNodeGrantView,
  DesktopExecutionNodeJobView,
  DesktopExecutionNodeStatus,
} from '../../shared/ipc-contract'
import { ExecutionNodeClient } from './client'
import type {
  ExecutionNodeClientState,
  ExecutionNodeJobExecutor,
  NodeFetchLike,
  NodeWebSocketConstructor,
} from './client'
import { DesktopJobsExecutor } from './jobs'
import type { ExecutionNodeGrantStore, ExecutionNodeGrantKind } from './grants'
import type { ExecutionNodeIdentityStore } from './identity-store'

/** 允许节点声明的固定能力白名单。 */
export const EXECUTION_NODE_CAPABILITIES = [
  'browser_open_url',
  'read_granted_file',
  'list_granted_directory',
  'write_workspace_file',
] as const

/** 原生文件/目录选择器的最小能力。 */
export interface ExecutionNodeFileDialog {
  /** 展示仅允许选择文件或目录的原生对话框。 */
  showOpenDialog(options: {
    title?: string
    properties: Array<'openFile' | 'openDirectory'>
  }): Promise<{ canceled: boolean; filePaths: string[] }>
}

/** 服务所需的 Electron app 最小能力。 */
export interface ExecutionNodeServiceApp {
  /** 读取 userData 等系统目录。 */
  getPath(name: 'userData'): string
  /** 当前应用版本，用于配对登记。 */
  getVersion(): string
}

/** 服务端的显式依赖；client 由服务内部组装。 */
export interface ExecutionNodeServiceOptions {
  /** 加密身份存储。 */
  identityStore: ExecutionNodeIdentityStore
  /** 资源授权表。 */
  grants: ExecutionNodeGrantStore
  /** 已校验的运行时配置。 */
  runtimeConfig: { apiBaseUrl: string }
  /** Electron app 能力。 */
  app: ExecutionNodeServiceApp
  /** 构建期注入的 package.json 版本号，配对与注册必须使用同一来源。 */
  appVersion: string
  /** 原生文件与目录选择器。 */
  dialog: ExecutionNodeFileDialog
  /** 系统默认浏览器调用能力。 */
  shell: { openExternal(url: string): Promise<void> }
  /** 状态广播回调，把净化快照发给各 renderer。 */
  onStatus(status: DesktopExecutionNodeStatus): void
  /** 测试可注入的 WebSocket 构造器。 */
  webSocketCtor?: NodeWebSocketConstructor
  /** 测试可注入的 fetch 实现。 */
  fetchFn?: NodeFetchLike
  /** 测试可注入的任务执行器；缺省由服务内部构造。 */
  jobsExecutor?: ExecutionNodeJobExecutor
  /** 测试可注入的时间源；缺省取 Date.now。 */
  now?(): number
}

/** 用户对任务审批的决定。 */
export type ExecutionNodeJobDecision = 'accept' | 'reject'

/**
 * 执行节点服务：组合身份、授权表、任务执行器与客户端，
 * 只向 renderer 暴露净化状态与受限动作。
 */
export class ExecutionNodeService {
  private readonly identityStore: ExecutionNodeIdentityStore
  private readonly grants: ExecutionNodeGrantStore
  private readonly app: ExecutionNodeServiceApp
  private readonly appVersion: string
  private readonly dialog: ExecutionNodeFileDialog
  private readonly onStatus: (status: DesktopExecutionNodeStatus) => void
  private readonly client: ExecutionNodeClient
  private pendingJob: DesktopExecutionNodeJobView | null = null
  private currentJob: DesktopExecutionNodeJobView | null = null

  public constructor(options: ExecutionNodeServiceOptions) {
    this.identityStore = options.identityStore
    this.grants = options.grants
    this.app = options.app
    this.appVersion = options.appVersion
    this.dialog = options.dialog
    this.onStatus = options.onStatus
    const jobsExecutor =
      options.jobsExecutor ??
      new DesktopJobsExecutor({
        grants: options.grants,
        shell: options.shell,
        app: options.app,
      })
    this.client = new ExecutionNodeClient({
      identityStore: options.identityStore,
      jobs: jobsExecutor,
      runtimeConfig: options.runtimeConfig,
      onStateChange: () => this.broadcast(),
      onJobOffer: (job) => {
        this.pendingJob = {
          executionId: job.executionId,
          toolName: job.toolName,
          arguments: job.arguments,
          expiresAt: job.expiresAt,
        }
        this.broadcast()
      },
      onJobStarted: (executionId) => {
        if (this.pendingJob?.executionId === executionId) {
          this.currentJob = this.pendingJob
        }
        this.pendingJob = null
        this.broadcast()
      },
      onJobSettled: (executionId) => {
        if (this.currentJob?.executionId === executionId) this.currentJob = null
        this.broadcast()
      },
      onJobCancelled: (executionId) => {
        if (this.pendingJob?.executionId === executionId) this.pendingJob = null
        this.broadcast()
      },
      ...(options.webSocketCtor ? { webSocketCtor: options.webSocketCtor } : {}),
      ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
      ...(options.now ? { now: options.now } : {}),
    })
  }

  /**
   * 应用启动时调用：恢复授权表并在已有身份时自动重连。
   * 启动过程不因节点错误中断。
   */
  public async start(): Promise<void> {
    await this.grants.hydrate()
    const identity = this.identityStore.getCached() ?? (await this.identityStore.load())
    if (!identity) return
    try {
      await this.client.connect()
    } catch (error: unknown) {
      console.error('Execution node auto reconnect failed', error)
    }
  }

  /** 组装当前净化状态快照。 */
  public async getStatus(): Promise<DesktopExecutionNodeStatus> {
    return this.buildStatus()
  }

  /**
   * 使用一次性配对码注册节点。
   * @param input 配对码、名称与可选能力子集（缺省声明全部能力）
   * @returns 注册后的净化状态快照
   */
  public async register(input: {
    pairingCode: string
    name: string
    capabilities?: string[]
  }): Promise<DesktopExecutionNodeStatus> {
    const requested = input.capabilities ?? [...EXECUTION_NODE_CAPABILITIES]
    const invalid = requested.filter(
      (capability) => !EXECUTION_NODE_CAPABILITIES.some((item) => item === capability)
    )
    if (invalid.length > 0) {
      throw new Error(`EXECUTION_NODE_CAPABILITY_INVALID: ${invalid.join(',')}`)
    }
    this.pendingJob = null
    this.currentJob = null
    await this.client.register({
      pairingCode: input.pairingCode,
      name: input.name,
      platform: process.platform,
      appVersion: this.appVersion,
      capabilities: requested,
    })
    return this.buildStatus()
  }

  /** 主动断开连接但保留配对身份。 */
  public async disconnect(): Promise<void> {
    this.client.disconnect()
    this.pendingJob = null
    this.currentJob = null
    this.broadcast()
  }

  /**
   * 注销节点：断开连接并清除身份、令牌、离线暂存与全部本地授权。
   */
  public async removeNode(): Promise<void> {
    this.client.disconnect()
    this.pendingJob = null
    this.currentJob = null
    await this.identityStore.clear()
    await this.grants.clear()
    this.broadcast()
  }

  /**
   * 转发用户对任务的决定。
   * @param input 执行 ID 与 accept/reject 决定
   */
  public async respondJob(input: {
    executionId: string
    decision: ExecutionNodeJobDecision
  }): Promise<void> {
    if (input.decision === 'accept') {
      this.client.acceptJob(input.executionId)
      return
    }
    this.client.rejectJob(input.executionId)
    if (this.pendingJob?.executionId === input.executionId) this.pendingJob = null
    this.broadcast()
  }

  /**
   * 打开原生选择器让用户授予文件或目录。
   * @param input 资源类型
   * @returns 净化授权视图；用户取消时为 null
   */
  public async createGrant(input: {
    kind: ExecutionNodeGrantKind
  }): Promise<DesktopExecutionNodeGrantView | null> {
    const result = await this.dialog.showOpenDialog({
      title: input.kind === 'directory' ? '选择要授权的目录' : '选择要授权的文件',
      properties: input.kind === 'directory' ? ['openDirectory'] : ['openFile'],
    })
    const selectedPath = result.canceled ? undefined : result.filePaths[0]
    if (!selectedPath) return null
    const view = await this.grants.createGrant({ kind: input.kind, path: selectedPath })
    this.broadcast()
    return view
  }

  /**
   * 撤销一个本地资源授权。
   * @param input 资源 ID
   */
  public async revokeGrant(input: { resourceId: string }): Promise<void> {
    await this.grants.revoke(input.resourceId)
    this.broadcast()
  }

  /** 应用退出前调用，彻底停止客户端。 */
  public stop(): void {
    this.client.stop()
  }

  private broadcast(): void {
    this.onStatus(this.buildStatus())
  }

  private buildStatus(): DesktopExecutionNodeStatus {
    const identity = this.identityStore.getCached()
    const state: ExecutionNodeClientState = this.client.getState()
    return {
      state,
      ...(identity ? { nodeId: identity.nodeId, name: identity.name } : {}),
      capabilities: identity ? [...identity.capabilities] : [],
      currentJob: this.currentJob,
      pendingJob: this.pendingJob,
      lastError: this.client.getLastError() ?? null,
      tokenExpiresAt: identity?.tokenExpiresAt ?? null,
      grants: this.grants.list(),
    }
  }
}
