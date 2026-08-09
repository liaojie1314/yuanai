import type { AppRuntimeConfig } from '../../shared/runtime-config'

const DEFAULT_API_BASE_URL = 'http://localhost:8000/api/v1'
const DEFAULT_WEB_BASE_URL = 'http://localhost:3000'

/** 运行时环境变量的最小只读视图。 */
export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function validateUrl(value: string, name: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must use http or https`)
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must not contain credentials, query, or fragment`)
  }
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    throw new Error(`${name} must use https outside loopback development`)
  }
  return url
}

function normalizeBaseUrl(value: string, name: string): string {
  return validateUrl(value, name).toString().replace(/\/$/, '')
}

function parseAssetOrigins(value: string | undefined): readonly string[] {
  if (!value) return Object.freeze([])
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
    .map((origin) => validateUrl(origin, 'YUANAI_ASSET_ORIGINS').origin)
  return Object.freeze(Array.from(new Set(origins)))
}

/**
 * 读取并校验主进程运行时配置，绝不将原始环境变量返回给 renderer。
 * @param environment 待解析的环境变量，默认读取当前 Node 进程环境
 * @returns 已冻结且可安全传递给 preload 的配置
 */
export function readRuntimeConfig(environment: RuntimeEnvironment = process.env): AppRuntimeConfig {
  const config: AppRuntimeConfig = {
    apiBaseUrl: normalizeBaseUrl(
      environment['YUANAI_API_URL'] ?? DEFAULT_API_BASE_URL,
      'YUANAI_API_URL'
    ),
    webBaseUrl: normalizeBaseUrl(
      environment['YUANAI_WEB_URL'] ?? DEFAULT_WEB_BASE_URL,
      'YUANAI_WEB_URL'
    ),
    assetOrigins: parseAssetOrigins(environment['YUANAI_ASSET_ORIGINS']),
  }
  return Object.freeze(config)
}
