import { getApiBaseUrl } from '@yuanai/core'
import type { MessageFile } from '@yuanai/types'
import type { ImageSourcePropType } from 'react-native'

/**
 * 构造移动端经后端代理的文件下载地址。
 *
 * 不能直接复用消息里的对象存储 URL：本地开发时它通常是电脑的 `localhost:9000`，
 * 对真机而言会指向手机自身。后端下载端点同时可保持私有桶不对外暴露。
 */
export function getMobileFileDownloadUrl(fileId: string): string {
  return `${getApiBaseUrl()}/files/${encodeURIComponent(fileId)}/download`
}

/**
 * 返回可由 React Native Image 读取的带鉴权图片源。
 *
 * React Native 网络图片支持请求头，因此 JWT 不会出现在 URL、系统浏览器历史或日志中。
 */
export function getMobileImageSource(
  file: Pick<MessageFile, 'id'>,
  accessToken: string | null
): ImageSourcePropType {
  const source = { uri: getMobileFileDownloadUrl(file.id) }
  return accessToken ? { ...source, headers: { Authorization: `Bearer ${accessToken}` } } : source
}
