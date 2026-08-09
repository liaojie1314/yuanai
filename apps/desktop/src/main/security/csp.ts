import type { AppRuntimeConfig } from '../../shared/runtime-config'

function isLoopbackOrigin(origin: string): boolean {
  const hostname = new URL(origin).hostname
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

/** 从已经校验的运行时配置构建严格且无通配符的 Content Security Policy。 */
export function buildContentSecurityPolicy(config: AppRuntimeConfig): string {
  const apiOrigin = new URL(config.apiBaseUrl).origin
  const loopbackAssetOrigins = config.assetOrigins.filter(isLoopbackOrigin)
  const imageSources = ["'self'", 'data:', 'blob:', 'https:', ...loopbackAssetOrigins].join(' ')

  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imageSources}`,
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin}`,
    "media-src 'self' blob:",
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ')
}
