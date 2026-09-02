import { app, safeStorage } from 'electron'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const AUTH_STORAGE_KEY = 'yuanai-auth'
const MAX_AUTH_STORAGE_BYTES = 1024 * 1024

function authStoragePath(): string {
  return join(app.getPath('userData'), 'session.enc')
}

function assertAuthStorageKey(key: string): void {
  if (key !== AUTH_STORAGE_KEY) {
    throw new Error('AUTH_STORAGE_KEY_INVALID')
  }
}

function assertEncryptionAvailable(): void {
  const isLinuxBasicText =
    process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'
  if (!safeStorage.isEncryptionAvailable() || isLinuxBasicText) {
    throw new Error('SAFE_STORAGE_UNAVAILABLE')
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

async function quarantineCorruptAuthFile(storagePath: string): Promise<void> {
  const corruptPath = `${storagePath}.corrupt-${Date.now().toString()}`
  try {
    await rename(storagePath, corruptPath)
  } catch {
    // 原文件可能已被其他实例清理，继续返回空值而不是泄露解密错误。
  }
}

/** 基于 Electron safeStorage 的加密认证状态存储接口。 */
export interface DesktopAuthStorage {
  /** 读取加密后的认证状态。 */
  getItem(key: string): Promise<string | null>
  /** 加密并持久化认证状态。 */
  setItem(key: string, value: string): Promise<void>
  /** 删除加密认证状态。 */
  removeItem(key: string): Promise<void>
}

/** 基于 Electron safeStorage 的加密认证状态存储。 */
export const authStorage: DesktopAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    assertAuthStorageKey(key)
    assertEncryptionAvailable()
    const storagePath = authStoragePath()
    try {
      const encrypted = await readFile(storagePath)
      if (encrypted.byteLength > MAX_AUTH_STORAGE_BYTES) {
        await quarantineCorruptAuthFile(storagePath)
        return null
      }
      const value = safeStorage.decryptString(encrypted)
      if (Buffer.byteLength(value) > MAX_AUTH_STORAGE_BYTES) {
        await quarantineCorruptAuthFile(storagePath)
        return null
      }
      return value
    } catch (error: unknown) {
      if (isMissingFile(error)) return null
      await quarantineCorruptAuthFile(storagePath)
      return null
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    assertAuthStorageKey(key)
    assertEncryptionAvailable()
    const storagePath = authStoragePath()
    if (Buffer.byteLength(value) > MAX_AUTH_STORAGE_BYTES) {
      throw new Error('AUTH_STORAGE_VALUE_TOO_LARGE')
    }
    const temporaryPath = `${storagePath}.${Date.now().toString()}.tmp`
    const encrypted = safeStorage.encryptString(value)
    await mkdir(dirname(storagePath), { recursive: true, mode: 0o700 })
    await writeFile(temporaryPath, encrypted, { mode: 0o600 })
    await rename(temporaryPath, storagePath)
  },

  async removeItem(key: string): Promise<void> {
    assertAuthStorageKey(key)
    const storagePath = authStoragePath()
    try {
      await unlink(storagePath)
    } catch (error: unknown) {
      if (!isMissingFile(error)) throw error
    }
  },
}
