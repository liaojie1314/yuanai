import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute } from 'node:path'

import type { Protocol } from 'electron'

import type { DesktopSelectedFile } from '../../shared/ipc-contract'

const SELECTED_FILE_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function getContentType(path: string): string {
  const extension = extname(path).toLowerCase()
  const types: Readonly<Record<string, string>> = {
    '.csv': 'text/csv; charset=utf-8',
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.json': 'application/json',
    '.md': 'text/markdown; charset=utf-8',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.webp': 'image/webp',
  }
  return types[extension] ?? 'application/octet-stream'
}

/** 系统选择文件的短时、一读即失效引用表。 */
export interface SelectedFileRegistry {
  /** 将绝对路径登记为不泄露路径的受控文件描述。 */
  register(paths: readonly string[]): DesktopSelectedFile[]
  /** 取走一次性文件令牌对应的本机路径。 */
  take(token: string): string | null
}

/** 创建只保存用户刚刚在原生对话框中选择文件的引用表。 */
export function createSelectedFileRegistry(): SelectedFileRegistry {
  const paths = new Map<string, string>()

  return {
    register(filePaths): DesktopSelectedFile[] {
      return filePaths.flatMap((path) => {
        if (!isAbsolute(path)) return []
        const name = basename(path)
        if (!name) return []
        const token = randomUUID()
        paths.set(token, path)
        return [{ name, url: `yuanai-file://selected/${token}` }]
      })
    },
    take(token): string | null {
      const path = paths.get(token)
      if (!path) return null
      paths.delete(token)
      return path
    },
  }
}

/** 从受控本地文件 URL 中提取一次性令牌，其他 URL 一律拒绝。 */
export function parseSelectedFileUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'yuanai-file:' ||
      url.hostname !== 'selected' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      /%(2f|5c|00)/i.test(url.pathname)
    ) {
      return null
    }
    const token = decodeURIComponent(url.pathname.slice(1))
    return SELECTED_FILE_TOKEN_PATTERN.test(token) ? token : null
  } catch {
    return null
  }
}

/** 注册仅能读取用户刚刚选择过的文件的自定义协议。 */
export function registerSelectedFileScheme(
  protocol: Protocol,
  selectedFiles: SelectedFileRegistry
): () => void {
  protocol.handle('yuanai-file', async (request) => {
    const token = parseSelectedFileUrl(request.url)
    const path = token ? selectedFiles.take(token) : null
    if (!path) return new Response('Not found', { status: 404 })
    try {
      const fileStat = await stat(path)
      if (!fileStat.isFile()) return new Response('Not found', { status: 404 })
      return new Response(await readFile(path), {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': getContentType(path),
        },
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
  return () => protocol.unhandle('yuanai-file')
}
