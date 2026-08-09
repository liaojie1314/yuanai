import type { DesktopPreferences } from './ipc-contract'

const PREFERENCE_KEYS: readonly (keyof DesktopPreferences)[] = [
  'closeToTray',
  'globalShortcut',
  'autoLaunch',
  'updateChannel',
  'checkUpdatesAutomatically',
  'nativeNotifications',
  'notificationSound',
  'aiReplyNotifications',
]

const MAX_IPC_STRING_BYTES = 1024 * 1024
const textEncoder = new TextEncoder()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPreferenceValue(key: keyof DesktopPreferences, value: unknown): boolean {
  switch (key) {
    case 'closeToTray':
    case 'autoLaunch':
    case 'checkUpdatesAutomatically':
    case 'nativeNotifications':
    case 'notificationSound':
    case 'aiReplyNotifications':
      return typeof value === 'boolean'
    case 'globalShortcut':
      return typeof value === 'string' || value === null
    case 'updateChannel':
      return value === 'stable' || value === 'beta'
  }
}

/** 校验值是否为完整且仅含受支持字段的桌面偏好。 */
export function isDesktopPreferences(value: unknown): value is DesktopPreferences {
  if (!isRecord(value) || Object.keys(value).length !== PREFERENCE_KEYS.length) return false
  return PREFERENCE_KEYS.every((key) => key in value && isPreferenceValue(key, value[key]))
}

/** 校验 renderer 提交的桌面偏好增量，拒绝未知字段与错误类型。 */
export function isDesktopPreferencesPatch(value: unknown): value is Partial<DesktopPreferences> {
  if (!isRecord(value)) return false
  return Object.entries(value).every(([key, preferenceValue]) => {
    const preferenceKey = PREFERENCE_KEYS.find((candidate) => candidate === key)
    return preferenceKey !== undefined && isPreferenceValue(preferenceKey, preferenceValue)
  })
}

/** 创建可跨 IPC 传递且不共享引用的桌面偏好副本。 */
export function copyDesktopPreferences(preferences: DesktopPreferences): DesktopPreferences {
  return { ...preferences }
}

/** 读取 IPC 参数中的唯一字符串，并限制其 UTF-8 字节数。 */
export function readBoundedIpcString(args: readonly unknown[]): string {
  if (args.length !== 1 || typeof args[0] !== 'string') {
    throw new Error('IPC_PAYLOAD_INVALID')
  }
  const value = args[0]
  if (textEncoder.encode(value).byteLength > MAX_IPC_STRING_BYTES) {
    throw new Error('IPC_PAYLOAD_TOO_LARGE')
  }
  return value
}

/** 读取 IPC 参数中的唯一对象值，保留 unknown 供调用方执行类型守卫。 */
export function readSingleIpcPayload(args: readonly unknown[]): unknown {
  if (args.length !== 1) throw new Error('IPC_PAYLOAD_INVALID')
  return args[0]
}

/** 断言 IPC 调用不携带参数，避免通道语义被扩展。 */
export function assertNoIpcPayload(args: readonly unknown[]): void {
  if (args.length !== 0) throw new Error('IPC_PAYLOAD_INVALID')
}
