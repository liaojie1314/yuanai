import type { AppRuntimeConfig } from '../../shared/runtime-config'

/** 从已经校验的运行时配置构建严格且无通配符的 Content Security Policy。 */
export function buildContentSecurityPolicy(
  config: AppRuntimeConfig,
  allowDevelopmentInlineScripts = false,
  allowSandboxedArtifactScripts = false
): string {
  const apiOrigin = new URL(config.apiBaseUrl).origin
  const assetOrigins = config.assetOrigins
  const imageSources = ["'self'", 'data:', 'blob:', 'https:', apiOrigin, ...assetOrigins].join(' ')
  const scriptSources = allowSandboxedArtifactScripts
    ? "'self' 'unsafe-inline' blob: https://esm.sh"
    : allowDevelopmentInlineScripts
      ? "'self' 'unsafe-inline'"
      : "'self'"

  return [
    "default-src 'self'",
    `script-src ${scriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imageSources}`,
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin} yuanai-file:`,
    `media-src 'self' blob: ${apiOrigin} ${assetOrigins.join(' ')}`,
    `frame-src 'self' blob: ${apiOrigin} ${assetOrigins.join(' ')}`,
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ')
}
