import type { PlatformAdapter } from '@yuanai/core/platform'

import type { AppRuntimeConfig } from '../../shared/runtime-config'

/** 运行时配置读取所需的最小 preload 接口。 */
export interface RuntimeConfigApi {
  /** 从主进程读取已校验的运行时配置。 */
  runtime: { getConfig(): Promise<AppRuntimeConfig> }
}

/** renderer 启动依赖，便于固定初始化顺序的单元测试。 */
export interface DesktopBootstrapOptions {
  /** 受限 preload API。 */
  api: RuntimeConfigApi
  /** 已创建的桌面平台适配器。 */
  adapter: PlatformAdapter
  /** 注册平台适配器。 */
  setAdapter(adapter: PlatformAdapter): void
  /** 注册实时 API base URL。 */
  setApiUrl(value: string): void
  /** 在平台初始化后延迟导入 Core stores。 */
  importStores(): Promise<void>
  /** 执行 React 挂载。 */
  mount(): void | Promise<void>
}

/** 在导入 Core stores 与挂载 React 前完成桌面端运行时初始化。 */
export async function bootstrapDesktop(
  options: DesktopBootstrapOptions
): Promise<AppRuntimeConfig> {
  const runtimeConfig = await options.api.runtime.getConfig()
  options.setAdapter(options.adapter)
  options.setApiUrl(runtimeConfig.apiBaseUrl)
  await options.importStores()
  await options.mount()
  return runtimeConfig
}
