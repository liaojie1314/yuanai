const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const AUTHORIZATION_CODE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/
const FORBIDDEN_OAUTH_KEYS = new Set(['access_token', 'refresh_token', 'code_verifier'])

/** 已校验的桌面自定义协议跳转。 */
export type ParsedDeepLink =
  | { type: 'chat'; conversationId: string }
  | { type: 'oauth'; code: string }
  | { type: 'oauth-error'; error: string; description: string | null }

function hasUniqueQueryKeys(url: URL): boolean {
  const keys = new Set<string>()
  for (const [key] of Array.from(url.searchParams.entries())) {
    if (keys.has(key)) return false
    keys.add(key)
  }
  return true
}

/** 解析并校验不包含长期令牌的 yuanai:// 深链接。 */
export function parseDeepLink(value: string): ParsedDeepLink | null {
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'yuanai:' ||
      url.username ||
      url.password ||
      url.hash ||
      !hasUniqueQueryKeys(url) ||
      Array.from(url.searchParams.keys()).some((key) => FORBIDDEN_OAUTH_KEYS.has(key))
    ) {
      return null
    }
    if (url.hostname === 'chat' && url.search === '') {
      const conversationId = url.pathname.slice(1)
      return UUID_PATTERN.test(conversationId) ? { type: 'chat', conversationId } : null
    }
    if (url.hostname !== 'oauth' || url.pathname !== '/callback') return null
    const code = url.searchParams.get('code')
    if (code && url.searchParams.size === 1 && AUTHORIZATION_CODE_PATTERN.test(code)) {
      return { type: 'oauth', code }
    }
    const error = url.searchParams.get('error')
    const description = url.searchParams.get('error_description')
    if (error && url.searchParams.size <= 2) {
      return { type: 'oauth-error', error, description }
    }
    return null
  } catch {
    return null
  }
}
