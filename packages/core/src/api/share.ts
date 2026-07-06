import type { Message } from '@yuanai/types'
import { apiClient } from './client.js'

/** 会话分享链接信息（分享者视角） */
export interface ShareLink {
  shareToken: string
  titleSnapshot: string
  createdAt: string
  expiresAt: string | null
  hasPassword: boolean
}

/** 通过分享 token 匿名访问到的只读会话内容 */
export interface SharedConversation {
  title: string
  model: string
  messages: Message[]
  sharedAt: string
  authorUsername: string
  expiresAt: string | null
}

/** 分享链接元信息（未解锁前只暴露标题/作者/需要密码等） */
export interface SharedConversationMeta {
  title: string
  authorUsername: string
  requiresPassword: boolean
  expiresAt: string | null
  sharedAt: string
}

/** 创建分享链接的可选参数 */
export interface CreateShareOptions {
  /** 有效期天数，0 或未传表示永久 */
  expiresInDays?: number | null
  /** 访问密码，为空字符串表示"取消密码" */
  password?: string | null
}

/** 为指定会话创建（或复用）公开分享链接；可设置有效期与访问密码 */
export async function createShareLink(
  convId: string,
  opts: CreateShareOptions = {}
): Promise<ShareLink> {
  const body: Record<string, unknown> = {}
  if (opts.expiresInDays !== undefined) body.expiresInDays = opts.expiresInDays
  if (opts.password !== undefined) body.password = opts.password
  const res = await apiClient.post<ShareLink>(`/chat/conversations/${convId}/share`, body)
  return res.data
}

/** 获取会话当前的分享链接；不存在时抛 404 */
export async function getShareLink(convId: string): Promise<ShareLink> {
  const res = await apiClient.get<ShareLink>(`/chat/conversations/${convId}/share`)
  return res.data
}

/** 撤销会话的所有分享链接 */
export async function revokeShareLink(convId: string): Promise<void> {
  await apiClient.delete(`/chat/conversations/${convId}/share`)
}

/** 匿名访问分享内容 —— 无需登录；若需密码，此接口返回 403 */
export async function getSharedConversation(shareToken: string): Promise<SharedConversation> {
  const res = await apiClient.get<SharedConversation>(`/share/${shareToken}`)
  return res.data
}

/** 获取分享链接的元信息（用于首屏渲染标题+判断是否要密码） */
export async function getSharedMeta(shareToken: string): Promise<SharedConversationMeta> {
  const res = await apiClient.get<SharedConversationMeta>(`/share/${shareToken}/meta`)
  return res.data
}

/** 使用访问密码解锁并读取分享内容 */
export async function unlockSharedConversation(
  shareToken: string,
  password: string
): Promise<SharedConversation> {
  const res = await apiClient.post<SharedConversation>(`/share/${shareToken}/unlock`, {
    password,
  })
  return res.data
}
