import { open, readdir, stat, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

import { canonicalJsonByteLength } from './protocol'
import type { ExecutionNodeGrantStore } from './grants'

/** 单个工具结果的最大规范化字节数，必须低于服务端 65536 上限。 */
export const MAX_JOB_RESULT_BYTES = 60_000
/** 读取授权文件的单次最大字节数，与后端 input_schema 一致。 */
export const MAX_READ_BYTES = 24_576
/** 列目录的最大条目数，与后端 input_schema 一致。 */
export const MAX_DIRECTORY_ENTRIES = 200
/** 写入工作区文件的内容最大字符数，与后端 input_schema 一致。 */
export const MAX_WORKSPACE_CONTENT_CHARS = 65_536

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

/** 受控本地任务执行器；只认识四个 desktop 内置工具。 */
export class DesktopJobsExecutor {
  private readonly grants: Pick<ExecutionNodeGrantStore, 'resolvePath'>
  private readonly shell: { openExternal(url: string): Promise<void> }
  private readonly workspaceRoot: string

  public constructor(options: DesktopJobsExecutorOptions) {
    this.grants = options.grants
    this.shell = options.shell
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
