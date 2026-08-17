import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type {
  DesktopPreferences,
  DesktopUpdateInfo,
  DesktopUpdateStatus,
} from '../../shared/ipc-contract'
import type { PreferencesIpcStorage } from '../ipc/prefs'

/** 只接受常见的 semver 数字部分，忽略 provider 附加的 prerelease/build 元数据。 */
export interface ParsedVersion {
  major: number
  minor: number
  patch: number
}

/** 解析供更新策略使用的版本号。 */
export function parseVersion(value: string): ParsedVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

/** 比较两个版本号，无法解析的版本按相等处理以避免错误强制更新。 */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return 0
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

/** 根据当前和目标版本决定是否必须更新以及是否允许跳过。 */
export function getUpdatePolicy(
  currentVersion: string,
  latestVersion: string
): Pick<DesktopUpdateInfo, 'mandatory' | 'canSkip'> {
  const current = parseVersion(currentVersion)
  const latest = parseVersion(latestVersion)
  const mandatory = Boolean(current && latest && latest.major > current.major)
  return { mandatory, canSkip: !mandatory }
}

/** electron-updater 提供的最小接口，便于主进程和单测隔离 Electron。 */
export interface DesktopAutoUpdater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  channel?: string | null
  on(event: string, listener: (...args: unknown[]) => void): void
  removeListener?(event: string, listener: (...args: unknown[]) => void): void
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
}

/** 更新服务所需的 Electron app 最小能力。 */
export interface DesktopUpdaterApp {
  isPackaged: boolean
  getVersion(): string
  getPath(name: 'userData'): string
}

/** 跳过版本存储接口。 */
export interface UpdateSkipStore {
  get(): Promise<string | null>
  set(version: string): Promise<void>
}

/** 使用用户数据目录保存可跳过的小版本。 */
export function createUpdateSkipStore(filePath: string): UpdateSkipStore {
  async function read(): Promise<string | null> {
    try {
      const content = await readFile(filePath, 'utf8')
      const parsed: unknown = JSON.parse(content)
      return typeof parsed === 'object' && parsed !== null && 'version' in parsed
        ? typeof (parsed as { version?: unknown }).version === 'string'
          ? (parsed as { version: string }).version
          : null
        : null
    } catch {
      return null
    }
  }

  return {
    get: read,
    async set(version: string): Promise<void> {
      const temporaryPath = `${filePath}.${Date.now().toString()}.tmp`
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
      await writeFile(temporaryPath, JSON.stringify({ version }), {
        encoding: 'utf8',
        mode: 0o600,
      })
      await rename(temporaryPath, filePath)
    },
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 240)
  return 'UPDATE_CHECK_FAILED'
}

function getVersionFromUpdateInfo(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('version' in value)) return null
  const version = (value as { version?: unknown }).version
  return typeof version === 'string' && parseVersion(version) ? version : null
}

function getReleaseDate(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('releaseDate' in value)) return undefined
  const releaseDate = (value as { releaseDate?: unknown }).releaseDate
  if (releaseDate instanceof Date) return releaseDate.toISOString()
  return typeof releaseDate === 'string' ? releaseDate : undefined
}

function getPercent(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null || !('percent' in value)) return undefined
  const percent = Number((value as { percent?: unknown }).percent)
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : undefined
}

/**
 * Electron 更新编排：仅正式安装包访问发布源，且通过状态回调同步到所有 renderer。
 * 小版本可以记录跳过，大版本永远要求用户安装。
 */
export class DesktopUpdaterService {
  private readonly currentVersion: string
  private latestInfo: DesktopUpdateInfo | undefined
  private status: DesktopUpdateStatus
  private attached = false

  public constructor(
    private readonly options: {
      app: DesktopUpdaterApp
      updater: DesktopAutoUpdater
      preferencesStorage: PreferencesIpcStorage
      onStatus(status: DesktopUpdateStatus): void
      skipStore?: UpdateSkipStore
    }
  ) {
    this.currentVersion = options.app.getVersion()
    this.status = { state: 'idle', currentVersion: this.currentVersion }
    this.options.updater.autoDownload = false
    this.options.updater.autoInstallOnAppQuit = false
    this.options.skipStore ??= createUpdateSkipStore(
      join(options.app.getPath('userData'), 'desktop-update-skips.json')
    )
  }

  /** 启动事件监听并按用户偏好延迟检查更新。 */
  public async start(): Promise<void> {
    this.attachListeners()
    if (!this.options.app.isPackaged) return
    const preferences = await this.options.preferencesStorage.get()
    this.configure(preferences)
    if (!preferences.checkUpdatesAutomatically) return
    setTimeout(() => {
      void this.check()
    }, 5_000)
  }

  /** 手动检查更新。开发模式明确返回不可用，不访问 GitHub。 */
  public async check(): Promise<DesktopUpdateStatus> {
    if (!this.options.app.isPackaged) {
      return this.publish({
        state: 'not-available',
        currentVersion: this.currentVersion,
        message: 'DEV_BUILD',
      })
    }
    try {
      this.configure(await this.options.preferencesStorage.get())
      this.publish({ state: 'checking', currentVersion: this.currentVersion })
      await this.options.updater.checkForUpdates()
    } catch (error: unknown) {
      this.publish({
        state: 'error',
        currentVersion: this.currentVersion,
        message: getErrorMessage(error),
      })
    }
    return this.status
  }

  /** 下载已经检查到的更新。 */
  public async download(): Promise<DesktopUpdateStatus> {
    if (this.status.state !== 'available' || !this.latestInfo) return this.status
    try {
      this.publish({
        state: 'downloading',
        currentVersion: this.currentVersion,
        info: this.latestInfo,
      })
      await this.options.updater.downloadUpdate()
    } catch (error: unknown) {
      this.publish({
        state: 'error',
        currentVersion: this.currentVersion,
        info: this.latestInfo,
        message: getErrorMessage(error),
      })
    }
    return this.status
  }

  /** 退出并安装已下载的更新。 */
  public install(): DesktopUpdateStatus {
    if (this.status.state === 'downloaded') this.options.updater.quitAndInstall()
    return this.status
  }

  /** 记录非大版本更新的跳过决定。 */
  public async skip(): Promise<DesktopUpdateStatus> {
    if (!this.latestInfo || !this.latestInfo.canSkip) return this.status
    await this.options.skipStore?.set(this.latestInfo.version)
    return this.publish({
      state: 'skipped',
      currentVersion: this.currentVersion,
      info: this.latestInfo,
    })
  }

  /** 更新渠道变化后应用到 electron-updater。 */
  public configure(preferences: Pick<DesktopPreferences, 'updateChannel'>): void {
    this.options.updater.channel = preferences.updateChannel
  }

  private attachListeners(): void {
    if (this.attached) return
    this.attached = true
    this.options.updater.on('checking-for-update', () => {
      this.publish({ state: 'checking', currentVersion: this.currentVersion })
    })
    this.options.updater.on('update-available', (value: unknown) => {
      void this.handleAvailable(value)
    })
    this.options.updater.on('update-not-available', () => {
      this.publish({ state: 'not-available', currentVersion: this.currentVersion })
    })
    this.options.updater.on('download-progress', (value: unknown) => {
      const info = this.latestInfo
      const percent = getPercent(value)
      this.publish({
        state: 'downloading',
        currentVersion: this.currentVersion,
        ...(info ? { info } : {}),
        ...(percent === undefined ? {} : { percent }),
      })
    })
    this.options.updater.on('update-downloaded', (value: unknown) => {
      const info = this.latestInfo ?? this.toUpdateInfo(value)
      this.publish({
        state: 'downloaded',
        currentVersion: this.currentVersion,
        ...(info ? { info } : {}),
      })
    })
    this.options.updater.on('error', (error: unknown) => {
      const info = this.latestInfo
      this.publish({
        state: 'error',
        currentVersion: this.currentVersion,
        message: getErrorMessage(error),
        ...(info ? { info } : {}),
      })
    })
  }

  private async handleAvailable(value: unknown): Promise<void> {
    const info = this.toUpdateInfo(value)
    if (!info) {
      this.publish({
        state: 'error',
        currentVersion: this.currentVersion,
        message: 'UPDATE_VERSION_INVALID',
      })
      return
    }
    this.latestInfo = info
    const skipped = await this.options.skipStore?.get()
    if (skipped === info.version && info.canSkip) {
      this.publish({ state: 'skipped', currentVersion: this.currentVersion, info })
      return
    }
    this.publish({ state: 'available', currentVersion: this.currentVersion, info })
  }

  private toUpdateInfo(value: unknown): DesktopUpdateInfo | undefined {
    const version = getVersionFromUpdateInfo(value)
    if (!version) return undefined
    const policy = getUpdatePolicy(this.currentVersion, version)
    const releaseDate = getReleaseDate(value)
    return {
      currentVersion: this.currentVersion,
      version,
      ...policy,
      ...(releaseDate ? { releaseDate } : {}),
    }
  }

  private publish(next: DesktopUpdateStatus): DesktopUpdateStatus {
    this.status = next
    this.options.onStatus(next)
    return next
  }
}
