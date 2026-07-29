/** 对外分享链接的 Web 站点 origin（与后端 WEB_APP_URL 对齐）。 */
export function getPublicWebOrigin(): string {
  const raw = process.env.EXPO_PUBLIC_WEB_APP_URL?.trim()
  if (raw) return raw.replace(/\/$/, '')
  return 'http://localhost:3000'
}

export function buildShareWebUrl(shareToken: string): string {
  return `${getPublicWebOrigin()}/share/${shareToken}`
}
