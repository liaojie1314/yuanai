import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { DEFAULT_DESKTOP_PREFERENCES, type DesktopPreferences } from '../../shared/ipc-contract'

const PREFERENCES_PATH = join(app.getPath('userData'), 'desktop-prefs.json')
const MAX_PREFERENCES_BYTES = 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDesktopPreferences(value: unknown): value is DesktopPreferences {
  if (!isRecord(value)) return false
  const keys = Object.keys(DEFAULT_DESKTOP_PREFERENCES)
  if (Object.keys(value).some((key) => !keys.includes(key))) return false
  return (
    typeof value['closeToTray'] === 'boolean' &&
    (typeof value['globalShortcut'] === 'string' || value['globalShortcut'] === null) &&
    typeof value['autoLaunch'] === 'boolean' &&
    (value['updateChannel'] === 'stable' || value['updateChannel'] === 'beta') &&
    typeof value['checkUpdatesAutomatically'] === 'boolean' &&
    typeof value['nativeNotifications'] === 'boolean' &&
    typeof value['notificationSound'] === 'boolean' &&
    typeof value['aiReplyNotifications'] === 'boolean'
  )
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

async function writePreferences(preferences: DesktopPreferences): Promise<void> {
  const temporaryPath = `${PREFERENCES_PATH}.${Date.now().toString()}.tmp`
  await mkdir(dirname(PREFERENCES_PATH), { recursive: true, mode: 0o700 })
  await writeFile(temporaryPath, JSON.stringify(preferences, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  })
  await rename(temporaryPath, PREFERENCES_PATH)
}

/** 读取和更新经过白名单校验的桌面偏好。 */
export const preferencesStorage = {
  async get(): Promise<DesktopPreferences> {
    try {
      const content = await readFile(PREFERENCES_PATH)
      if (content.byteLength > MAX_PREFERENCES_BYTES) return { ...DEFAULT_DESKTOP_PREFERENCES }
      const parsed: unknown = JSON.parse(content.toString('utf8'))
      return isDesktopPreferences(parsed) ? parsed : { ...DEFAULT_DESKTOP_PREFERENCES }
    } catch (error: unknown) {
      if (isMissingFile(error)) return { ...DEFAULT_DESKTOP_PREFERENCES }
      return { ...DEFAULT_DESKTOP_PREFERENCES }
    }
  },

  async update(value: unknown): Promise<DesktopPreferences> {
    if (!isRecord(value) || !isDesktopPreferences({ ...DEFAULT_DESKTOP_PREFERENCES, ...value })) {
      throw new Error('PREFERENCES_INVALID')
    }
    const next = { ...DEFAULT_DESKTOP_PREFERENCES, ...value }
    await writePreferences(next)
    return next
  },
}
