/** 主进程校验后提供给所有 renderer 的不可变运行时配置。 */
export interface AppRuntimeConfig {
  /** 后端 API base URL。 */
  apiBaseUrl: string
  /** Web 应用 base URL。 */
  webBaseUrl: string
  /** 可加载的额外资源 origin 白名单。 */
  assetOrigins: readonly string[]
}
