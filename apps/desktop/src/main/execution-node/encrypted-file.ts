import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** 执行节点加密持久化所需的 Electron safeStorage 最小能力。 */
export interface SafeStorageLike {
  /** 判断当前平台是否具备加解密能力。 */
  isEncryptionAvailable(): boolean
  /** 返回当前使用的后端标识；Linux 上可能是 basic_text 等降级值。 */
  getSelectedStorageBackend(): string | null
  /** 加密明文并返回密文字节。 */
  encryptString(plainText: string): Buffer
  /** 解密密文字节并返回明文。 */
  decryptString(encrypted: Buffer): string
}

/** 加密文件读写所需的显式依赖。 */
export interface EncryptedFileDeps {
  /** Electron safeStorage 能力。 */
  safeStorage: SafeStorageLike
  /** 当前平台；Linux basic_text 后端被视为不可用。 */
  platform: NodeJS.Platform
}

/** 加密文件读取结果；文件缺失或不可信时返回 null。 */
export type EncryptedFileRead = string | null

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

/**
 * 断言 safeStorage 可用且未降级为明文后端；否则拒绝持久化。
 * @param deps 平台与 safeStorage 依赖
 * @throws SAFE_STORAGE_UNAVAILABLE 当加密不可用或 Linux 使用 basic_text
 */
export function assertEncryptionAvailable(deps: EncryptedFileDeps): void {
  const isLinuxBasicText =
    deps.platform === 'linux' && deps.safeStorage.getSelectedStorageBackend() === 'basic_text'
  if (!deps.safeStorage.isEncryptionAvailable() || isLinuxBasicText) {
    throw new Error('SAFE_STORAGE_UNAVAILABLE')
  }
}

/** 把无法解密或超限的损坏文件隔离重命名，避免阻塞后续写入。 */
export async function quarantineCorruptFile(filePath: string): Promise<void> {
  try {
    await rename(filePath, `${filePath}.corrupt-${Date.now().toString()}`)
  } catch {
    // 原文件可能已被其他实例清理，继续按空数据处理。
  }
}

/**
 * 读取 safeStorage 加密的 JSON 明文文件。
 * @param options 文件路径、加密依赖与明文大小上限
 * @returns 解密后的明文；缺失、超限或损坏（已隔离）时为 null
 */
export async function readEncryptedFile(options: {
  filePath: string
  deps: EncryptedFileDeps
  maxBytes: number
}): Promise<EncryptedFileRead> {
  assertEncryptionAvailable(options.deps)
  let encrypted: Buffer
  try {
    encrypted = await readFile(options.filePath)
  } catch (error: unknown) {
    if (isMissingFile(error)) return null
    await quarantineCorruptFile(options.filePath)
    return null
  }
  if (encrypted.byteLength > options.maxBytes) {
    await quarantineCorruptFile(options.filePath)
    return null
  }
  try {
    const plainText = options.deps.safeStorage.decryptString(encrypted)
    if (Buffer.byteLength(plainText) > options.maxBytes) {
      await quarantineCorruptFile(options.filePath)
      return null
    }
    return plainText
  } catch {
    await quarantineCorruptFile(options.filePath)
    return null
  }
}

/**
 * 以 0600 权限原子写入 safeStorage 加密文件。
 * @param options 文件路径、加密依赖、明文与大小上限
 * @throws SAFE_STORAGE_UNAVAILABLE 当加密不可用
 * @throws EXECUTION_NODE_STORE_VALUE_TOO_LARGE 当明文超过大小上限
 */
export async function writeEncryptedFile(options: {
  filePath: string
  deps: EncryptedFileDeps
  plainText: string
  maxBytes: number
}): Promise<void> {
  assertEncryptionAvailable(options.deps)
  if (Buffer.byteLength(options.plainText) > options.maxBytes) {
    throw new Error('EXECUTION_NODE_STORE_VALUE_TOO_LARGE')
  }
  const encrypted = options.deps.safeStorage.encryptString(options.plainText)
  const temporaryPath = `${options.filePath}.${Date.now().toString()}.tmp`
  await mkdir(dirname(options.filePath), { recursive: true, mode: 0o700 })
  await writeFile(temporaryPath, encrypted, { mode: 0o600 })
  await rename(temporaryPath, options.filePath)
}

/** 删除文件；文件不存在视为已完成。 */
export async function removeFileQuietly(filePath: string): Promise<void> {
  try {
    await unlink(filePath)
  } catch (error: unknown) {
    if (!isMissingFile(error)) throw error
  }
}
