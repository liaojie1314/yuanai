import { app, safeStorage } from 'electron'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { StateStorage } from 'zustand/middleware'

const AUTH_STORAGE_KEY = 'yuanai-auth'
const MAX_AUTH_STORAGE_BYTES = 1024 * 1024
const AUTH_STORAGE_PATH = join(app.getPath('userData'), 'session.enc')

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

async function quarantineCorruptAuthFile(): Promise<void> {
  const corruptPath = `${AUTH_STORAGE_PATH}.corrupt-${Date.now().toString()}`
  try {
    await rename(AUTH_STORAGE_PATH, corruptPath)
  } catch {
    // 原文件可能已被其他实例清理，继续返回空值而不是泄露解密错误。
  }
}

/** 基于 Electron safeStorage 的加密认证状态存储。 */
export const authStorage: StateStorage = {
  async getItem(key: string): Promise<string | null> {
    assertAuthStorageKey(key)
    assertEncryptionAvailable()
    try {
      const encrypted = await readFile(AUTH_STORAGE_PATH)
      if (encrypted.byteLength > MAX_AUTH_STORAGE_BYTES) {
        await quarantineCorruptAuthFile()
        return null
      }
      const value = safeStorage.decryptString(encrypted)
      if (Buffer.byteLength(value) > MAX_AUTH_STORAGE_BYTES) {
        await quarantineCorruptAuthFile()
        return null
      }
      return value
    } catch (error: unknown) {
      if (isMissingFile(error)) return null
      await quarantineCorruptAuthFile()
      return null
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    assertAuthStorageKey(key)
    assertEncryptionAvailable()
    if (Buffer.byteLength(value) > MAX_AUTH_STORAGE_BYTES) {
      throw new Error('AUTH_STORAGE_VALUE_TOO_LARGE')
    }
    const temporaryPath = `${AUTH_STORAGE_PATH}.${Date.now().toString()}.tmp`
    const encrypted = safeStorage.encryptString(value)
    await mkdir(dirname(AUTH_STORAGE_PATH), { recursive: true, mode: 0o700 })
    await writeFile(temporaryPath, encrypted, { mode: 0o600 })
    await rename(temporaryPath, AUTH_STORAGE_PATH)
  },

  async removeItem(key: string): Promise<void> {
    assertAuthStorageKey(key)
    try {
      await unlink(AUTH_STORAGE_PATH)
    } catch (error: unknown) {
      if (!isMissingFile(error)) throw error
    }
  },
}
