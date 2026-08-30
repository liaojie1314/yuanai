import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'

import { readEncryptedFile, removeFileQuietly, writeEncryptedFile } from './encrypted-file'
import type { EncryptedFileDeps, SafeStorageLike } from './encrypted-file'

/** 加密授权表文件在 userData 下的文件名。 */
export const EXECUTION_NODE_GRANTS_FILE = 'execution-node-grants.enc'
/** 加密授权表明文的大小上限。 */
export const MAX_GRANTS_BYTES = 512 * 1024

/** 允许授予的本地资源类型。 */
export type ExecutionNodeGrantKind = 'file' | 'directory'

/** 含真实路径的本地授权记录；仅存在于主进程。 */
export interface ExecutionNodeGrantRecord {
  /** 稳定资源 ID，对云端与工具参数可见。 */
  resourceId: string
  /** 资源类型。 */
  kind: ExecutionNodeGrantKind
  /** 本机绝对路径，绝不回传给服务端。 */
  path: string
  /** 不含路径的展示名称。 */
  displayName: string
  /** 创建时间 ISO 字符串。 */
  createdAt: string
}

/** 对 renderer 与服务端都安全的授权视图。 */
export interface ExecutionNodeGrantView {
  /** 稳定资源 ID。 */
  resourceId: string
  /** 资源类型。 */
  kind: ExecutionNodeGrantKind
  /** 不含路径的展示名称。 */
  displayName: string
  /** 创建时间 ISO 字符串。 */
  createdAt: string
}

/** 资源授权存储所需的 Electron 依赖。 */
export interface ExecutionNodeGrantStoreOptions {
  /** Electron app，仅用于解析 userData 目录。 */
  app: { getPath(name: 'userData'): string }
  /** Electron safeStorage 能力。 */
  safeStorage: SafeStorageLike
  /** 当前平台；缺省取 process.platform。 */
  platform?: NodeJS.Platform
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseGrantRecord(value: unknown): ExecutionNodeGrantRecord | null {
  if (!isRecord(value)) return null
  const resourceId =
    typeof value['resourceId'] === 'string' && value['resourceId'].length <= 200
      ? value['resourceId']
      : null
  const kind = value['kind'] === 'file' || value['kind'] === 'directory' ? value['kind'] : null
  const path = typeof value['path'] === 'string' && value['path'].length > 0 ? value['path'] : null
  const displayName =
    typeof value['displayName'] === 'string' && value['displayName'].length <= 200
      ? value['displayName']
      : null
  const createdAt =
    typeof value['createdAt'] === 'string' && !Number.isNaN(Date.parse(value['createdAt']))
      ? value['createdAt']
      : null
  if (!resourceId || !kind || !path || displayName === null || !createdAt) return null
  return { resourceId, kind, path, displayName, createdAt }
}

/** 资源授权表：safeStorage 加密保存真实路径，对外只暴露稳定 resource_id。 */
export class ExecutionNodeGrantStore {
  private readonly filePath: string
  private readonly deps: EncryptedFileDeps
  private readonly grants = new Map<string, ExecutionNodeGrantRecord>()

  public constructor(options: ExecutionNodeGrantStoreOptions) {
    this.filePath = join(options.app.getPath('userData'), EXECUTION_NODE_GRANTS_FILE)
    this.deps = { safeStorage: options.safeStorage, platform: options.platform ?? process.platform }
  }

  /**
   * 启动时从磁盘恢复授权表；缺失或损坏数据按空表处理。
   */
  public async hydrate(): Promise<void> {
    this.grants.clear()
    const plainText = await readEncryptedFile({
      filePath: this.filePath,
      deps: this.deps,
      maxBytes: MAX_GRANTS_BYTES,
    })
    if (plainText === null) return
    let parsed: unknown
    try {
      parsed = JSON.parse(plainText)
    } catch {
      return
    }
    if (!isRecord(parsed) || !Array.isArray(parsed['grants'])) return
    for (const entry of parsed['grants']) {
      const record = parseGrantRecord(entry)
      if (record) this.grants.set(record.resourceId, record)
    }
  }

  /**
   * 记录一次用户通过原生选择器授予的资源。
   * @param input 资源类型、真实路径与可选展示名称
   * @returns 不含真实路径的授权视图
   * @throws GRANT_INPUT_INVALID 当类型或路径不合法
   */
  public async createGrant(input: {
    kind: ExecutionNodeGrantKind
    path: string
    displayName?: string
  }): Promise<ExecutionNodeGrantView> {
    if (input.kind !== 'file' && input.kind !== 'directory') {
      throw new Error('GRANT_INPUT_INVALID')
    }
    const trimmedPath = input.path.trim().replace(/[\\/]+$/, '')
    if (trimmedPath.length === 0 || trimmedPath.length > 4096) {
      throw new Error('GRANT_INPUT_INVALID')
    }
    const now = new Date().toISOString()
    const record: ExecutionNodeGrantRecord = {
      resourceId: randomUUID(),
      kind: input.kind,
      path: trimmedPath,
      displayName:
        input.displayName && input.displayName.trim().length > 0
          ? input.displayName.trim().slice(0, 200)
          : basename(trimmedPath).slice(0, 200) || trimmedPath.slice(0, 200),
      createdAt: now,
    }
    this.grants.set(record.resourceId, record)
    await this.persist()
    return {
      resourceId: record.resourceId,
      kind: record.kind,
      displayName: record.displayName,
      createdAt: record.createdAt,
    }
  }

  /**
   * 把稳定 resource_id 解析为真实本机路径，仅供任务执行器使用。
   * @param resourceId 资源 ID
   * @returns 本机绝对路径
   * @throws EXECUTION_NODE_GRANT_NOT_FOUND 当资源不存在
   */
  public resolvePath(resourceId: string): string {
    const record = this.grants.get(resourceId)
    if (!record) throw new Error('EXECUTION_NODE_GRANT_NOT_FOUND')
    return record.path
  }

  /** 列出当前有效的授权视图，不包含真实路径。 */
  public list(): ExecutionNodeGrantView[] {
    return Array.from(this.grants.values())
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((record) => ({
        resourceId: record.resourceId,
        kind: record.kind,
        displayName: record.displayName,
        createdAt: record.createdAt,
      }))
  }

  /**
   * 撤销指定授权并持久化。
   * @param resourceId 资源 ID
   * @throws EXECUTION_NODE_GRANT_NOT_FOUND 当资源不存在
   */
  public async revoke(resourceId: string): Promise<void> {
    if (!this.grants.delete(resourceId)) {
      throw new Error('EXECUTION_NODE_GRANT_NOT_FOUND')
    }
    await this.persist()
  }

  /** 清空全部授权（注销节点时调用）并删除持久化文件。 */
  public async clear(): Promise<void> {
    this.grants.clear()
    await removeFileQuietly(this.filePath)
  }

  private async persist(): Promise<void> {
    const payload = JSON.stringify({ grants: Array.from(this.grants.values()) })
    await writeEncryptedFile({
      filePath: this.filePath,
      deps: this.deps,
      plainText: payload,
      maxBytes: MAX_GRANTS_BYTES,
    })
  }
}
