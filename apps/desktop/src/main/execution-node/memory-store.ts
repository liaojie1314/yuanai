import { join } from 'node:path'

import { readEncryptedFile, removeFileQuietly, writeEncryptedFile } from './encrypted-file'
import type { EncryptedFileDeps, SafeStorageLike } from './encrypted-file'

/** 加密本地记忆文件在 userData 下的文件名。 */
export const EXECUTION_NODE_MEMORY_FILE = 'execution-node-memory.enc'
/** 加密本地记忆明文的大小上限。 */
export const MAX_LOCAL_MEMORY_BYTES = 512 * 1024
/** 单条本地记忆内容的字符上限。 */
export const MAX_LOCAL_MEMORY_CONTENT_CHARS = 8_000
/** 记忆 ID 与类型的字符上限。 */
const MAX_IDENTIFIER_CHARS = 200

/** 只存在于本机的一条记忆；云端只保留元数据。 */
export interface LocalMemoryRecord {
  /** 云端记忆行的稳定 ID。 */
  id: string
  /** 记忆正文，仅落在本机加密文件里。 */
  content: string
  /** 记忆类型，取值与后端 MemoryType 一致。 */
  memoryType: string
  /** 最近一次写入时间 ISO 字符串。 */
  updatedAt: string
}

/** 本地记忆存储所需的 Electron 依赖。 */
export interface LocalMemoryStoreOptions {
  /** Electron app，仅用于解析 userData 目录。 */
  app: { getPath(name: 'userData'): string }
  /** Electron safeStorage 能力。 */
  safeStorage: SafeStorageLike
  /** 当前平台；缺省取 process.platform。 */
  platform?: NodeJS.Platform
}

/**
 * 分词与归一化的分隔符：空白，以及 ASCII 标点（0021-002F、003A-0040、005B-0060、
 * 007B-007E）、CJK 标点（3001-303F，表意空格 3000 已由 \s 覆盖）与全角标点
 * （FF01-FF0F、FF1A-FF20、FF3B-FF40、FF5B-FF65）。编译目标不支持 \p{P}，
 * 故按码位区间显式列出，且刻意不吃掉全角字母与数字。
 */
const SEPARATOR_PATTERN = /[\s!-/:-@[-`{-~、-〿！-／：-＠［-｀｛-･]+/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseMemoryRecord(value: unknown): LocalMemoryRecord | null {
  if (!isRecord(value)) return null
  const id =
    typeof value['id'] === 'string' &&
    value['id'].length > 0 &&
    value['id'].length <= MAX_IDENTIFIER_CHARS
      ? value['id']
      : null
  const content =
    typeof value['content'] === 'string' &&
    value['content'].length <= MAX_LOCAL_MEMORY_CONTENT_CHARS
      ? value['content']
      : null
  const memoryType =
    typeof value['memoryType'] === 'string' &&
    value['memoryType'].length > 0 &&
    value['memoryType'].length <= MAX_IDENTIFIER_CHARS
      ? value['memoryType']
      : null
  const updatedAt =
    typeof value['updatedAt'] === 'string' && !Number.isNaN(Date.parse(value['updatedAt']))
      ? value['updatedAt']
      : null
  if (!id || content === null || !memoryType || !updatedAt) return null
  return { id, content, memoryType, updatedAt }
}

/** 去掉空白与标点后小写，使「杭州 西湖」与「杭州，西湖」等价。 */
function normalizeText(value: string): string {
  return value.toLowerCase().split(SEPARATOR_PATTERN).join('')
}

/** 把查询切成去重后的词项；中文不再细分，靠子串命中兜底。 */
function tokenizeQuery(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(SEPARATOR_PATTERN)
        .filter((term) => term.length > 0)
    )
  )
}

/**
 * 本地记忆存储：safeStorage 加密保存记忆正文，检索为同步的关键词打分。
 *
 * 节点上不做向量检索——向量臂由云端承担，把模型塞进 Electron 不在本批次范围内。
 */
export class LocalMemoryStore {
  private readonly filePath: string
  private readonly deps: EncryptedFileDeps
  private readonly memories = new Map<string, LocalMemoryRecord>()

  public constructor(options: LocalMemoryStoreOptions) {
    this.filePath = join(options.app.getPath('userData'), EXECUTION_NODE_MEMORY_FILE)
    this.deps = { safeStorage: options.safeStorage, platform: options.platform ?? process.platform }
  }

  /**
   * 启动时从磁盘恢复本地记忆；缺失或损坏数据按空集合处理。
   */
  public async hydrate(): Promise<void> {
    this.memories.clear()
    const plainText = await readEncryptedFile({
      filePath: this.filePath,
      deps: this.deps,
      maxBytes: MAX_LOCAL_MEMORY_BYTES,
    })
    if (plainText === null) return
    let parsed: unknown
    try {
      parsed = JSON.parse(plainText)
    } catch {
      return
    }
    if (!isRecord(parsed) || !Array.isArray(parsed['memories'])) return
    for (const entry of parsed['memories']) {
      const record = parseMemoryRecord(entry)
      if (record) this.memories.set(record.id, record)
    }
  }

  /**
   * 写入或更新一条本地记忆，同一 ID 覆盖而非追加。
   * @param record 记忆 ID、正文、类型与更新时间
   * @throws EXECUTION_NODE_STORE_VALUE_TOO_LARGE 当全部记忆超过文件上限
   */
  public async put(record: LocalMemoryRecord): Promise<void> {
    this.memories.set(record.id, { ...record })
    await this.persist()
  }

  /**
   * 删除一条本地记忆。
   * @param id 记忆 ID
   * @returns 是否真的删掉了记录；不存在时为 false 而不抛错
   */
  public async remove(id: string): Promise<boolean> {
    if (!this.memories.delete(id)) return false
    await this.persist()
    return true
  }

  /**
   * 按关键词重合度检索本地记忆。
   * @param query 查询文本
   * @param limit 最多返回条数
   * @returns 命中记忆的副本，按命中词数与更新时间倒序
   */
  public search(query: string, limit: number): LocalMemoryRecord[] {
    const terms = tokenizeQuery(query)
    if (terms.length === 0 || limit < 1) return []
    const scored: Array<{ score: number; record: LocalMemoryRecord }> = []
    for (const record of Array.from(this.memories.values())) {
      const normalized = normalizeText(record.content)
      const score = terms.filter((term) => normalized.includes(term)).length
      if (score > 0) scored.push({ score, record })
    }
    return scored
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.record.updatedAt.localeCompare(left.record.updatedAt) ||
          left.record.id.localeCompare(right.record.id)
      )
      .slice(0, limit)
      .map((item) => ({ ...item.record }))
  }

  /** 清空全部本地记忆（注销节点时调用）并删除持久化文件。 */
  public async clear(): Promise<void> {
    this.memories.clear()
    await removeFileQuietly(this.filePath)
  }

  private async persist(): Promise<void> {
    const payload = JSON.stringify({ memories: Array.from(this.memories.values()) })
    await writeEncryptedFile({
      filePath: this.filePath,
      deps: this.deps,
      plainText: payload,
      maxBytes: MAX_LOCAL_MEMORY_BYTES,
    })
  }
}
