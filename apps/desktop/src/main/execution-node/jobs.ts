import { open, readdir, stat, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

import { canonicalJsonByteLength } from './protocol'
import type { ExecutionNodeGrantStore } from './grants'
import { MAX_LOCAL_MEMORY_CONTENT_CHARS } from './memory-store'
import type { LocalMemoryStore } from './memory-store'

/** 单个工具结果的最大规范化字节数，必须低于服务端 65536 上限。 */
export const MAX_JOB_RESULT_BYTES = 60_000
/** 读取授权文件的单次最大字节数，与后端 input_schema 一致。 */
export const MAX_READ_BYTES = 24_576
/** 列目录的最大条目数，与后端 input_schema 一致。 */
export const MAX_DIRECTORY_ENTRIES = 200
/** 写入工作区文件的内容最大字符数，与后端 input_schema 一致。 */
export const MAX_WORKSPACE_CONTENT_CHARS = 65_536
/** 剪贴板读取的字符上限，与后端 _MAX_CLIPBOARD_CHARS 一致。 */
export const MAX_CLIPBOARD_CHARS = 10_000
/** 本地记忆检索一次最多返回的条数。 */
export const MAX_MEMORY_SEARCH_LIMIT = 50
/**
 * 记忆检索查询的字符上限，必须与后端 MEMORY_SEARCH_MAX_QUERY_CHARS 相同。
 * 节点声明得比云端严时，超限查询会走到这里才失败，对用户显示成「本地记忆不可用」，
 * 把参数错误伪装成节点故障；改动这个数字必须同时改后端那一个常量。
 */
export const MAX_MEMORY_SEARCH_QUERY_CHARS = 500
/** 本地记忆检索的缺省返回条数。 */
const DEFAULT_MEMORY_SEARCH_LIMIT = 8
/** 记忆 ID 与记忆类型参数的字符上限。 */
const MAX_MEMORY_IDENTIFIER_CHARS = 200

/** 与后端 desktop.py 一致的受限相对路径白名单；\x00 用于显式拒绝 NUL 字节。 */
const SAFE_RELATIVE_PATH_PATTERN =
  // eslint-disable-next-line no-control-regex -- NUL 是协议明确禁止的路径字符
  /^(?!\/)(?!\\)(?![A-Za-z]:)(?!\.\.(?:\/|$))(?!.*?\/\.\.(?:\/|$))[^/\\\x00]+(?:\/[^/\\\x00]+)*$/

/** 工具执行失败；code 必须是后端可理解的稳定错误码。 */
export class ToolExecutionFailure extends Error {
  /** 稳定错误码。 */
  public readonly code: string

  public constructor(code: string, message: string) {
    super(message)
    this.name = 'ToolExecutionFailure'
    this.code = code
  }
}

/** 任务被取消时抛出，客户端据此回传 cancelled 终态。 */
export class JobCancelledError extends Error {
  public constructor() {
    super('JOB_CANCELLED')
    this.name = 'JobCancelledError'
  }
}

/** 任务执行器的系统依赖；fs 通过模块 mock 注入测试，shell 显式注入。 */
export interface DesktopJobsExecutorOptions {
  /** 资源授权表，用于把 resource_id 解析为真实路径。 */
  grants: Pick<ExecutionNodeGrantStore, 'resolvePath'>
  /** 系统默认浏览器调用能力。 */
  shell: { openExternal(url: string): Promise<void> }
  /** 本地加密记忆存储，承接 memory.* 三类作业。 */
  memoryStore: Pick<LocalMemoryStore, 'search' | 'put' | 'remove'>
  /** 系统原生剪贴板的只读能力。 */
  clipboard: { readText(): string }
  /** Agent 工作区根目录；缺省为 userData/agent-workspace。 */
  workspaceRoot?: string
  /** Electron app 依赖，仅用于推导缺省工作区根目录。 */
  app?: { getPath(name: 'userData'): string }
}

/** 一次任务执行的输入。 */
export interface ExecuteJobInput {
  /** 工具名，必须在节点能力白名单内。 */
  toolName: string
  /** 服务端下发的工具参数。 */
  arguments: Record<string, unknown>
  /** 取消信号。 */
  signal: AbortSignal
  /** 进度回调，0-100 整数。 */
  onProgress: (progress: number) => void
  /** 工作区根目录覆盖值。 */
  workdir?: string
}

/** 任务执行结果包装。 */
export interface JobExecutionOutcome {
  /** 可签名的结构化结果。 */
  result: Record<string, unknown>
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new JobCancelledError()
}

function readStringArgument(
  arguments_: Record<string, unknown>,
  key: string,
  maxLength: number
): string {
  const value = arguments_[key]
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new ToolExecutionFailure(
      'TOOL_INVALID_INPUT',
      `参数 ${key} 必须是 1-${maxLength} 字符的字符串`
    )
  }
  return value
}

function readOptionalEncoding(arguments_: Record<string, unknown>): 'utf8' | 'base64' {
  const value = arguments_['encoding']
  if (value === undefined || value === 'utf8' || value === 'base64') return value ?? 'utf8'
  throw new ToolExecutionFailure('TOOL_INVALID_INPUT', '参数 encoding 只允许 utf8 或 base64')
}

function readOptionalInteger(
  arguments_: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  const value = arguments_[key]
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ToolExecutionFailure(
      'TOOL_INVALID_INPUT',
      `参数 ${key} 必须是 ${minimum}-${maximum} 的整数`
    )
  }
  return value
}

/**
 * 校验 URL 只能是干净 HTTPS 地址，与主进程对外链的校验规则一致。
 * @param url 待打开的地址
 * @returns 规范化后的 URL 文本
 */
export function assertSafeHttpsUrl(url: string): string {
  if (url.length < 8 || url.length > 2_048) {
    throw new ToolExecutionFailure('TOOL_INVALID_INPUT', 'URL 长度不合法')
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ToolExecutionFailure('TOOL_INVALID_INPUT', 'URL 无法解析')
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
    throw new ToolExecutionFailure('TOOL_INVALID_INPUT', '只允许不带凭据的 HTTPS URL')
  }
  return parsed.toString()
}

/**
 * 校验受限相对路径并解析到工作区内的绝对路径，双重防御路径穿越。
 * @param relativePath 工具参数中的相对路径
 * @param workspaceRoot 工作区根目录
 * @returns 已解析且必须位于工作区内的绝对路径
 */
export function resolveWorkspacePath(relativePath: string, workspaceRoot: string): string {
  if (relativePath.length > 500 || !SAFE_RELATIVE_PATH_PATTERN.test(relativePath)) {
    throw new ToolExecutionFailure('TOOL_INVALID_INPUT', 'relative_path 不符合安全模式')
  }
  const root = resolve(workspaceRoot)
  const target = resolve(root, relativePath)
  if (target !== root && !target.startsWith(root + sep)) {
    throw new ToolExecutionFailure('TOOL_INVALID_INPUT', 'relative_path 解析后逃逸出工作区')
  }
  return target
}

async function runBrowserOpenUrl(
  input: ExecuteJobInput,
  shell: { openExternal(url: string): Promise<void> }
): Promise<Record<string, unknown>> {
  const url = assertSafeHttpsUrl(readStringArgument(input.arguments, 'url', 2_000))
  assertNotAborted(input.signal)
  input.onProgress(50)
  await shell.openExternal(url)
  assertNotAborted(input.signal)
  input.onProgress(100)
  return { url, opened: true }
}

async function runReadGrantedFile(
  input: ExecuteJobInput,
  grants: Pick<ExecutionNodeGrantStore, 'resolvePath'>
): Promise<Record<string, unknown>> {
  const resourceId = readStringArgument(input.arguments, 'resource_id', 200)
  const encoding = readOptionalEncoding(input.arguments)
  const maxBytes = readOptionalInteger(
    input.arguments,
    'max_bytes',
    1,
    MAX_READ_BYTES,
    MAX_READ_BYTES
  )
  assertNotAborted(input.signal)
  input.onProgress(30)
  let resolvedPath: string
  try {
    resolvedPath = grants.resolvePath(resourceId)
  } catch {
    throw new ToolExecutionFailure('TOOL_GRANT_NOT_FOUND', '资源 ID 未在本地授权表中找到')
  }
  let fileStat
  try {
    fileStat = await stat(resolvedPath)
  } catch {
    throw new ToolExecutionFailure('TOOL_GRANT_NOT_FOUND', '授权文件不存在或已不可访问')
  }
  if (!fileStat.isFile()) {
    throw new ToolExecutionFailure('TOOL_GRANT_NOT_FOUND', '授权资源不是普通文件')
  }
  const truncated = fileStat.size > maxBytes
  const readLength = Math.min(fileStat.size, maxBytes)
  const handle = await open(resolvedPath, 'r')
  let content: string
  try {
    const buffer = Buffer.alloc(Math.max(0, readLength))
    if (readLength > 0) {
      const { bytesRead } = await handle.read(buffer, 0, readLength, 0)
      content = buffer.subarray(0, bytesRead).toString(encoding)
    } else {
      content = ''
    }
  } finally {
    await handle.close()
  }
  assertNotAborted(input.signal)
  input.onProgress(100)
  return {
    resource_id: resourceId,
    size_bytes: fileStat.size,
    encoding,
    content,
    truncated,
  }
}

async function runListGrantedDirectory(
  input: ExecuteJobInput,
  grants: Pick<ExecutionNodeGrantStore, 'resolvePath'>
): Promise<Record<string, unknown>> {
  const resourceId = readStringArgument(input.arguments, 'resource_id', 200)
  const maxEntries = readOptionalInteger(
    input.arguments,
    'max_entries',
    1,
    MAX_DIRECTORY_ENTRIES,
    MAX_DIRECTORY_ENTRIES
  )
  assertNotAborted(input.signal)
  input.onProgress(30)
  let resolvedPath: string
  try {
    resolvedPath = grants.resolvePath(resourceId)
  } catch {
    throw new ToolExecutionFailure('TOOL_GRANT_NOT_FOUND', '资源 ID 未在本地授权表中找到')
  }
  let dirents
  try {
    dirents = await readdir(resolvedPath, { withFileTypes: true })
  } catch {
    throw new ToolExecutionFailure('TOOL_GRANT_NOT_FOUND', '授权目录不存在或已不可访问')
  }
  const sorted = dirents
    .filter((dirent) => dirent.isFile() || dirent.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
  const truncated = sorted.length > maxEntries
  const entries: Array<Record<string, unknown>> = []
  for (const dirent of sorted.slice(0, maxEntries)) {
    if (dirent.isFile()) {
      const entry: Record<string, unknown> = { name: dirent.name, kind: 'file' }
      try {
        entry['size_bytes'] = (await stat(resolve(resolvedPath, dirent.name))).size
      } catch {
        // 文件在列出后瞬间消失时跳过大小字段，不影响目录枚举。
      }
      entries.push(entry)
      continue
    }
    entries.push({ name: dirent.name, kind: 'directory' })
  }
  assertNotAborted(input.signal)
  input.onProgress(100)
  return { resource_id: resourceId, entries, truncated }
}

async function runWriteWorkspaceFile(
  input: ExecuteJobInput,
  workspaceRoot: string
): Promise<Record<string, unknown>> {
  const relativePath = readStringArgument(input.arguments, 'relative_path', 500)
  const contentArgument = input.arguments['content']
  if (typeof contentArgument !== 'string' || contentArgument.length > MAX_WORKSPACE_CONTENT_CHARS) {
    throw new ToolExecutionFailure('TOOL_INVALID_INPUT', '参数 content 缺失或超过大小限制')
  }
  const encoding = readOptionalEncoding(input.arguments)
  assertNotAborted(input.signal)
  input.onProgress(20)
  const targetPath = resolveWorkspacePath(relativePath, workspaceRoot)
  const payload =
    encoding === 'base64'
      ? Buffer.from(contentArgument, 'base64')
      : Buffer.from(contentArgument, 'utf8')
  await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 })
  assertNotAborted(input.signal)
  input.onProgress(70)
  await writeFile(targetPath, payload, { mode: 0o600 })
  assertNotAborted(input.signal)
  input.onProgress(100)
  return { relative_path: relativePath, size_bytes: payload.byteLength }
}

/** memory.* 三类作业所依赖的本地记忆存储能力。 */
type MemoryStoreLike = Pick<LocalMemoryStore, 'search' | 'put' | 'remove'>

/**
 * 读取系统剪贴板纯文本。
 *
 * 剪贴板为空是真实状态，必须如实返回空串加 char_count=0；读取本身失败才是
 * 执行错误。把两者混成同一种结果会让「剪贴板没有内容」和「读不到剪贴板」
 * 无法区分，用户会以为自己的复制丢了。
 */
async function runReadClipboard(
  input: ExecuteJobInput,
  clipboard: { readText(): string }
): Promise<Record<string, unknown>> {
  const maxChars = readOptionalInteger(
    input.arguments,
    'max_chars',
    1,
    MAX_CLIPBOARD_CHARS,
    MAX_CLIPBOARD_CHARS
  )
  assertNotAborted(input.signal)
  input.onProgress(50)
  let raw: string
  try {
    raw = clipboard.readText()
  } catch {
    throw new ToolExecutionFailure('TOOL_EXECUTION_FAILED', '读取系统剪贴板失败')
  }
  if (typeof raw !== 'string') {
    throw new ToolExecutionFailure('TOOL_EXECUTION_FAILED', '读取系统剪贴板失败')
  }
  assertNotAborted(input.signal)
  input.onProgress(100)
  const truncated = raw.length > maxChars
  const text = truncated ? raw.slice(0, maxChars) : raw
  return { text, char_count: text.length, truncated }
}

async function runMemorySearch(
  input: ExecuteJobInput,
  memoryStore: MemoryStoreLike
): Promise<Record<string, unknown>> {
  const query = readStringArgument(input.arguments, 'query', MAX_MEMORY_SEARCH_QUERY_CHARS)
  const limit = readOptionalInteger(
    input.arguments,
    'limit',
    1,
    MAX_MEMORY_SEARCH_LIMIT,
    DEFAULT_MEMORY_SEARCH_LIMIT
  )
  assertNotAborted(input.signal)
  input.onProgress(50)
  // 节点没有向量臂，分数只能由名次导出；云端按名次与元数据再做融合排序。
  const memories = memoryStore.search(query, limit).map((record, index) => ({
    id: record.id,
    content: record.content,
    score: 1 / (index + 1),
  }))
  assertNotAborted(input.signal)
  input.onProgress(100)
  return { memories }
}

async function runMemoryWrite(
  input: ExecuteJobInput,
  memoryStore: MemoryStoreLike
): Promise<Record<string, unknown>> {
  const memoryId = readStringArgument(input.arguments, 'memoryId', MAX_MEMORY_IDENTIFIER_CHARS)
  const content = readStringArgument(input.arguments, 'content', MAX_LOCAL_MEMORY_CONTENT_CHARS)
  const memoryType = readStringArgument(input.arguments, 'memoryType', MAX_MEMORY_IDENTIFIER_CHARS)
  assertNotAborted(input.signal)
  input.onProgress(50)
  await memoryStore.put({
    id: memoryId,
    content,
    memoryType,
    updatedAt: new Date().toISOString(),
  })
  assertNotAborted(input.signal)
  input.onProgress(100)
  return { stored: true }
}

async function runMemoryDelete(
  input: ExecuteJobInput,
  memoryStore: MemoryStoreLike
): Promise<Record<string, unknown>> {
  const memoryId = readStringArgument(input.arguments, 'memoryId', MAX_MEMORY_IDENTIFIER_CHARS)
  assertNotAborted(input.signal)
  input.onProgress(50)
  // 删除是幂等的：本地本来就没有该记忆时同样算成功，否则云端永远删不掉这条元数据。
  await memoryStore.remove(memoryId)
  assertNotAborted(input.signal)
  input.onProgress(100)
  return { deleted: true }
}

/**
 * 校验任务结果的规范化字节数不超过发送上限。
 * @param result 待检查的结构化结果
 * @throws ToolExecutionFailure 当结果超过 60000 字节
 */
export function assertResultSize(result: Record<string, unknown>): void {
  if (canonicalJsonByteLength(result) > MAX_JOB_RESULT_BYTES) {
    throw new ToolExecutionFailure('TOOL_OUTPUT_TOO_LARGE', '工具结果超过发送限制')
  }
}

/** 受控本地任务执行器；只认识 desktop 内置工具白名单。 */
export class DesktopJobsExecutor {
  private readonly grants: Pick<ExecutionNodeGrantStore, 'resolvePath'>
  private readonly shell: { openExternal(url: string): Promise<void> }
  private readonly memoryStore: MemoryStoreLike
  private readonly clipboard: { readText(): string }
  private readonly workspaceRoot: string

  public constructor(options: DesktopJobsExecutorOptions) {
    this.grants = options.grants
    this.shell = options.shell
    this.memoryStore = options.memoryStore
    this.clipboard = options.clipboard
    this.workspaceRoot =
      options.workspaceRoot ??
      (options.app ? join(options.app.getPath('userData'), 'agent-workspace') : '')
  }

  /**
   * 执行一个本地任务；未知工具直接抛错。
   * @param input 工具名、参数、取消信号与进度回调
   * @returns 可签名的结构化结果，规范化字节数不超过 60000
   * @throws ToolExecutionFailure 当输入非法、资源缺失或结果超限
   * @throws JobCancelledError 当任务被取消
   */
  public async executeJob(input: ExecuteJobInput): Promise<JobExecutionOutcome> {
    let result: Record<string, unknown>
    switch (input.toolName) {
      case 'browser_open_url':
        result = await runBrowserOpenUrl(input, this.shell)
        break
      case 'read_granted_file':
        result = await runReadGrantedFile(input, this.grants)
        break
      case 'list_granted_directory':
        result = await runListGrantedDirectory(input, this.grants)
        break
      case 'write_workspace_file':
        result = await runWriteWorkspaceFile(input, this.resolveWorkspaceRoot(input))
        break
      case 'read_clipboard':
        result = await runReadClipboard(input, this.clipboard)
        break
      case 'memory.search':
        result = await runMemorySearch(input, this.memoryStore)
        break
      case 'memory.write':
        result = await runMemoryWrite(input, this.memoryStore)
        break
      case 'memory.delete':
        result = await runMemoryDelete(input, this.memoryStore)
        break
      default:
        throw new ToolExecutionFailure('TOOL_NOT_SUPPORTED', `节点不支持工具 ${input.toolName}`)
    }
    assertResultSize(result)
    return { result }
  }

  private resolveWorkspaceRoot(input: ExecuteJobInput): string {
    const configured = input.workdir ?? this.workspaceRoot
    if (configured.length === 0) {
      throw new ToolExecutionFailure('TOOL_EXECUTION_FAILED', '工作区根目录未配置')
    }
    return configured
  }
}
