import { join } from 'node:path'
import type { JsonWebKey as CryptoJsonWebKey } from 'node:crypto'

import {
  quarantineCorruptFile,
  readEncryptedFile,
  removeFileQuietly,
  writeEncryptedFile,
} from './encrypted-file'
import type { EncryptedFileDeps, SafeStorageLike } from './encrypted-file'
import type { NodeTerminalMessage } from './protocol'

/** 加密节点身份文件在 userData 下的文件名。 */
export const EXECUTION_NODE_IDENTITY_FILE = 'execution-node.enc'
/** 加密身份明文的大小上限。 */
export const MAX_IDENTITY_BYTES = 512 * 1024

/** 节点离线暂存的终态结果，重连后等待服务端确认。 */
export interface SpooledTerminalMessage {
  /** 服务端执行 ID。 */
  executionId: string
  /** 已签名的终态消息原文。 */
  message: NodeTerminalMessage
}

/** 持久化的执行节点身份；私钥与令牌绝不离开主进程。 */
export interface ExecutionNodeIdentity {
  /** 服务端分配的节点 ID。 */
  nodeId: string
  /** 配对时使用的节点名称。 */
  name: string
  /** 配对时上报的平台。 */
  platform: string
  /** 配对时上报的应用版本。 */
  appVersion: string
  /** 节点声明的能力白名单。 */
  capabilities: string[]
  /** 可持久化的 JWK 私钥。 */
  privateKeyJwk: CryptoJsonWebKey
  /** 无填充 Base64URL 公钥。 */
  publicKeyBase64Url: string
  /** 当前节点令牌。 */
  nodeToken: string
  /** 令牌过期时间 ISO 字符串。 */
  tokenExpiresAt: string
  /** 等待服务端确认的终态暂存。 */
  spool: SpooledTerminalMessage[]
}

/** 节点身份存储所需的 Electron 依赖。 */
export interface ExecutionNodeIdentityStoreOptions {
  /** Electron app，仅用于解析 userData 目录。 */
  app: { getPath(name: 'userData'): string }
  /** Electron safeStorage 能力。 */
  safeStorage: SafeStorageLike
  /** 当前平台；缺省取 process.platform。 */
  platform?: NodeJS.Platform
}

const TERMINAL_TYPES = new Set(['completed', 'failed', 'cancelled'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : null
}

function parseSpoolEntry(value: unknown): SpooledTerminalMessage | null {
  if (!isRecord(value)) return null
  const executionId = readString(value['executionId'], 64)
  const message = value['message']
  if (!executionId || !isRecord(message)) return null
  const type = message['type']
  if (typeof type !== 'string' || !TERMINAL_TYPES.has(type)) return null
  if (!readString(message['execution_id'], 64)) return null
  if (!readString(message['signature'], 200)) return null
  if (!('result' in message) || !('error_code' in message)) return null
  return { executionId, message: message as unknown as NodeTerminalMessage }
}

/**
 * 校验解密出的身份载荷结构；结构不符视为损坏数据。
 * @param value 待校验载荷
 * @returns 严格类型化的身份；不合法时为 null
 */
export function parseIdentity(value: unknown): ExecutionNodeIdentity | null {
  if (!isRecord(value)) return null
  const nodeId = readString(value['nodeId'], 64)
  const name = typeof value['name'] === 'string' ? value['name'] : null
  const platform = readString(value['platform'], 40)
  const appVersion = readString(value['appVersion'], 40)
  const publicKeyBase64Url = readString(value['publicKeyBase64Url'], 100)
  const nodeToken = readString(value['nodeToken'], 2048)
  const tokenExpiresAt = readString(value['tokenExpiresAt'], 60)
  const capabilities = value['capabilities']
  if (
    !nodeId ||
    name === null ||
    !platform ||
    !appVersion ||
    !publicKeyBase64Url ||
    !nodeToken ||
    !tokenExpiresAt ||
    !Array.isArray(capabilities) ||
    !capabilities.every((item) => typeof item === 'string')
  ) {
    return null
  }
  const privateKeyJwk = value['privateKeyJwk']
  if (
    !isRecord(privateKeyJwk) ||
    privateKeyJwk['kty'] !== 'OKP' ||
    privateKeyJwk['crv'] !== 'Ed25519' ||
    typeof privateKeyJwk['d'] !== 'string'
  ) {
    return null
  }
  if (Number.isNaN(Date.parse(tokenExpiresAt))) return null
  const spoolValue = value['spool']
  if (!Array.isArray(spoolValue)) return null
  const spool: SpooledTerminalMessage[] = []
  for (const entry of spoolValue) {
    const parsed = parseSpoolEntry(entry)
    if (!parsed) return null
    spool.push(parsed)
  }
  return {
    nodeId,
    name,
    platform,
    appVersion,
    capabilities: [...capabilities],
    privateKeyJwk: privateKeyJwk as unknown as CryptoJsonWebKey,
    publicKeyBase64Url,
    nodeToken,
    tokenExpiresAt,
    spool,
  }
}

/** 基于 Electron safeStorage 的节点身份加密存储。 */
export class ExecutionNodeIdentityStore {
  private readonly filePath: string
  private readonly deps: EncryptedFileDeps
  private cached: ExecutionNodeIdentity | null = null

  public constructor(options: ExecutionNodeIdentityStoreOptions) {
    this.filePath = join(options.app.getPath('userData'), EXECUTION_NODE_IDENTITY_FILE)
    this.deps = { safeStorage: options.safeStorage, platform: options.platform ?? process.platform }
  }

  /**
   * 从磁盘读取并缓存节点身份；文件缺失或损坏时返回 null 并隔离损坏文件。
   * @returns 已持久化的节点身份；未配对时为 null
   */
  public async load(): Promise<ExecutionNodeIdentity | null> {
    const plainText = await readEncryptedFile({
      filePath: this.filePath,
      deps: this.deps,
      maxBytes: MAX_IDENTITY_BYTES,
    })
    if (plainText === null) {
      this.cached = null
      return null
    }
    try {
      const parsed: unknown = JSON.parse(plainText)
      const identity = parseIdentity(parsed)
      if (!identity) {
        await this.quarantine()
        return null
      }
      this.cached = identity
      return identity
    } catch {
      await this.quarantine()
      return null
    }
  }

  /**
   * 加密并原子保存节点身份，同时刷新内存缓存。
   * @param identity 待持久化的完整身份
   * @throws SAFE_STORAGE_UNAVAILABLE 当加密不可用
   * @throws EXECUTION_NODE_STORE_VALUE_TOO_LARGE 当载荷超过 512KB
   */
  public async save(identity: ExecutionNodeIdentity): Promise<void> {
    const plainText = JSON.stringify(identity)
    const validated = parseIdentity(JSON.parse(plainText))
    if (!validated) throw new Error('EXECUTION_NODE_IDENTITY_INVALID')
    await writeEncryptedFile({
      filePath: this.filePath,
      deps: this.deps,
      plainText,
      maxBytes: MAX_IDENTITY_BYTES,
    })
    this.cached = validated
  }

  /** 删除持久化身份并清空内存缓存。 */
  public async clear(): Promise<void> {
    await removeFileQuietly(this.filePath)
    this.cached = null
  }

  /** 同步读取最近一次 load/save 后的内存身份，不触发磁盘访问。 */
  public getCached(): ExecutionNodeIdentity | null {
    return this.cached
  }

  private async quarantine(): Promise<void> {
    await quarantineCorruptFile(this.filePath)
    this.cached = null
  }
}
