import type { PlatformAdapter } from './types.js'
import { webAdapter } from './web.js'

/**
 * 当前注册的平台适配器。默认使用 Web 实现，使得 `apps/web` 无需显式初始化；
 * `apps/mobile` 应在入口调用 `setPlatformAdapter(mobileAdapter)` 覆盖为原生实现。
 */
let current: PlatformAdapter = webAdapter

/**
 * 注册平台适配器。必须在任何 `useStream` 调用或 store persist 触发之前完成。
 *
 * @param adapter - 平台适配器实现
 */
export function setPlatformAdapter(adapter: PlatformAdapter): void {
  current = adapter
}

/**
 * 获取当前平台适配器。若尚未显式注册则返回 Web 默认实现，
 * 允许 Web 端不主动调用 `setPlatformAdapter` 也能正常运行。
 */
export function getPlatformAdapter(): PlatformAdapter {
  return current
}

/**
 * 重置回默认 Web 适配器。仅测试使用，避免用例间平台污染。
 */
export function resetPlatformAdapter(): void {
  current = webAdapter
}

export { webAdapter } from './web.js'
export type {
  PlatformAdapter,
  SseMessage,
  StreamHandle,
  StreamHandlers,
  StreamRequest,
} from './types.js'
