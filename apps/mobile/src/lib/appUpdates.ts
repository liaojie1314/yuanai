import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import * as Application from 'expo-application'
import * as Updates from 'expo-updates'

/** 移动端更新状态。 */
export type MobileUpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'skipped'
  | 'error'

/** 移动端更新版本信息。 */
export interface MobileUpdateInfo {
  currentVersion: string
  version: string
  mandatory: boolean
  canSkip: boolean
}

/** 移动端更新状态快照。 */
export interface MobileUpdateStatus {
  state: MobileUpdateState
  currentVersion: string
  info?: MobileUpdateInfo
  percent?: number
  message?: string
}

/** 可注入的 Expo 更新能力，便于单测与 Expo Go 降级。 */
export interface MobileUpdatesApi {
  isEnabled: boolean
  checkForUpdateAsync(): Promise<{ isAvailable: boolean; manifest?: unknown }>
  fetchUpdateAsync(): Promise<{ isNew: boolean }>
  reloadAsync(): Promise<void>
}

/** 可注入的跳过版本存储。 */
export interface MobileUpdateSkipStore {
  get(): Promise<string | null>
  set(version: string): Promise<void>
}

const SKIPPED_UPDATE_KEY = 'yuanai.mobile.skipped-update'

/** 解析比较用的三段版本号。 */
export function parseMobileVersion(value: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** 返回大版本强制、小版本和补丁版本可跳过的策略。 */
export function getMobileUpdatePolicy(
  currentVersion: string,
  latestVersion: string
): Pick<MobileUpdateInfo, 'mandatory' | 'canSkip'> {
  const current = parseMobileVersion(currentVersion)
  const latest = parseMobileVersion(latestVersion)
  const mandatory = Boolean(current && latest && latest[0] > current[0])
  return { mandatory, canSkip: !mandatory }
}

/** 默认的用户目录更新跳过记录。 */
export function createMobileUpdateSkipStore(): MobileUpdateSkipStore {
  return {
    async get(): Promise<string | null> {
      return AsyncStorage.getItem(SKIPPED_UPDATE_KEY)
    },
    async set(version: string): Promise<void> {
      await AsyncStorage.setItem(SKIPPED_UPDATE_KEY, version)
    },
  }
}

function currentVersion(): string {
  return Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '0.0.0'
}

function configuredProjectId(): string | null {
  const projectId = Constants.expoConfig?.extra?.['eas']?.['projectId']
  return typeof projectId === 'string' && projectId !== 'PROJECT_ID_PLACEHOLDER' ? projectId : null
}

function manifestVersion(manifest: unknown, fallback: string): string {
  if (typeof manifest !== 'object' || manifest === null) return fallback
  const value = manifest as { version?: unknown; extra?: { expoClient?: { version?: unknown } } }
  if (typeof value.version === 'string' && parseMobileVersion(value.version)) return value.version
  const expoVersion = value.extra?.expoClient?.version
  return typeof expoVersion === 'string' && parseMobileVersion(expoVersion) ? expoVersion : fallback
}

/** 统一 Expo Go、开发模式和未配置 EAS 时的检查行为。 */
export class MobileUpdateService {
  private readonly version: string
  private readonly api: MobileUpdatesApi
  private readonly skipStore: MobileUpdateSkipStore
  private readonly projectConfigured: boolean
  private status: MobileUpdateStatus
  private latestInfo: MobileUpdateInfo | undefined

  public constructor(options: {
    api: MobileUpdatesApi
    skipStore: MobileUpdateSkipStore
    currentVersion?: string
    enabled?: boolean
    projectConfigured?: boolean
  }) {
    this.version = options.currentVersion ?? currentVersion()
    this.api = options.api
    this.skipStore = options.skipStore
    this.projectConfigured = options.projectConfigured ?? Boolean(configuredProjectId())
    this.status = { state: 'idle', currentVersion: this.version }
    if (options.enabled === false) this.api.isEnabled = false
  }

  /** 检查 OTA 更新；无 EAS 项目或 Expo Go 时不发起网络请求。 */
  public async check(): Promise<MobileUpdateStatus> {
    if (!this.api.isEnabled) {
      return this.publish({
        state: 'not-available',
        currentVersion: this.version,
        message: 'DEV_BUILD',
      })
    }
    if (!this.projectConfigured) {
      return this.publish({
        state: 'not-available',
        currentVersion: this.version,
        message: 'EAS_NOT_CONFIGURED',
      })
    }
    try {
      this.publish({ state: 'checking', currentVersion: this.version })
      const result = await this.api.checkForUpdateAsync()
      if (!result.isAvailable) {
        return this.publish({ state: 'not-available', currentVersion: this.version })
      }
      const version = manifestVersion(result.manifest, this.version)
      const info = {
        currentVersion: this.version,
        version,
        ...getMobileUpdatePolicy(this.version, version),
      }
      this.latestInfo = info
      if ((await this.skipStore.get()) === version && info.canSkip) {
        return this.publish({ state: 'skipped', currentVersion: this.version, info })
      }
      return this.publish({ state: 'available', currentVersion: this.version, info })
    } catch (error: unknown) {
      return this.publish({
        state: 'error',
        currentVersion: this.version,
        message: error instanceof Error ? error.message.slice(0, 240) : 'UPDATE_CHECK_FAILED',
      })
    }
  }

  /** 下载已检查到的 OTA 更新，不自动重启。 */
  public async download(): Promise<MobileUpdateStatus> {
    if (this.status.state !== 'available' || !this.latestInfo) return this.status
    try {
      this.publish({ state: 'downloading', currentVersion: this.version, info: this.latestInfo })
      await this.api.fetchUpdateAsync()
      return this.publish({
        state: 'downloaded',
        currentVersion: this.version,
        info: this.latestInfo,
      })
    } catch (error: unknown) {
      return this.publish({
        state: 'error',
        currentVersion: this.version,
        info: this.latestInfo,
        message: error instanceof Error ? error.message.slice(0, 240) : 'UPDATE_DOWNLOAD_FAILED',
      })
    }
  }

  /** 重启应用并加载已经下载的 OTA。 */
  public async install(): Promise<MobileUpdateStatus> {
    if (this.status.state === 'downloaded') await this.api.reloadAsync()
    return this.status
  }

  /** 记录可跳过的小版本；大版本不会写入跳过记录。 */
  public async skip(): Promise<MobileUpdateStatus> {
    if (!this.latestInfo?.canSkip) return this.status
    try {
      await this.skipStore.set(this.latestInfo.version)
      return this.publish({ state: 'skipped', currentVersion: this.version, info: this.latestInfo })
    } catch (error: unknown) {
      return this.publish({
        state: 'error',
        currentVersion: this.version,
        info: this.latestInfo,
        message: error instanceof Error ? error.message.slice(0, 240) : 'UPDATE_SKIP_FAILED',
      })
    }
  }

  private publish(next: MobileUpdateStatus): MobileUpdateStatus {
    this.status = next
    return next
  }
}

/** 创建使用真实 Expo Updates 的移动端更新服务。 */
export function createMobileUpdateService(): MobileUpdateService {
  return new MobileUpdateService({
    api: Updates,
    skipStore: createMobileUpdateSkipStore(),
    enabled: Updates.isEnabled,
    projectConfigured: Boolean(configuredProjectId()),
  })
}
