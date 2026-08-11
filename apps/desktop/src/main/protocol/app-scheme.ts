import { readFile, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

import type { Protocol } from 'electron'

import { RENDERER_ENTRIES } from '../../shared/window-entry'

function contentType(path: string): string {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8'
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (path.endsWith('.css')) return 'text/css; charset=utf-8'
  if (path.endsWith('.json')) return 'application/json; charset=utf-8'
  if (path.endsWith('.svg')) return 'image/svg+xml'
  if (path.endsWith('.png')) return 'image/png'
  return 'application/octet-stream'
}

/** 将可信 yuanai-app 请求解析为 renderer 根目录内的只读文件路径。 */
export function resolveRendererAssetPath(requestUrl: string, rendererRoot: string): string | null {
  try {
    const url = new URL(requestUrl)
    if (
      url.protocol !== 'yuanai-app:' ||
      url.hostname !== 'renderer' ||
      url.username ||
      url.password ||
      url.search ||
      /%(2f|5c|00)/i.test(url.pathname)
    ) {
      return null
    }
    const segments = decodeURIComponent(url.pathname)
      .split('/')
      .filter((segment) => segment.length > 0)
    if (
      segments.length < 2 ||
      !RENDERER_ENTRIES.includes(segments[0] as (typeof RENDERER_ENTRIES)[number]) ||
      segments.some(
        (segment) =>
          segment === '.' || segment === '..' || segment.includes('\\') || segment.includes('\0')
      )
    ) {
      return null
    }
    const resolvedRoot = resolve(rendererRoot)
    const assetPath = resolve(resolvedRoot, ...segments)
    const assetRelativePath = relative(resolvedRoot, assetPath)
    if (assetRelativePath === '' || assetRelativePath.startsWith('..')) return null
    return assetPath
  } catch {
    return null
  }
}

/** 注册只读的 yuanai-app renderer 资源协议，并返回清理函数。 */
export function registerAppScheme(protocol: Protocol, rendererRoot: string): () => void {
  protocol.handle('yuanai-app', async (request) => {
    const assetPath = resolveRendererAssetPath(request.url, rendererRoot)
    if (!assetPath) return new Response('Not found', { status: 404 })
    try {
      const fileStat = await stat(assetPath)
      if (!fileStat.isFile()) return new Response('Not found', { status: 404 })
      return new Response(await readFile(assetPath), {
        headers: { 'Content-Type': contentType(assetPath) },
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
  return () => protocol.unhandle('yuanai-app')
}
