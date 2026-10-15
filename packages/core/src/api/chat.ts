import type { Conversation, Message, SearchCapability } from '@yuanai/types'
import { apiClient } from './client.js'

/** 获取会话列表（最多 50 条） */
export async function listConversations(): Promise<Conversation[]> {
  const res = await apiClient.get<{
    conversations: Conversation[]
    nextCursor: null
    hasMore: boolean
  }>('/chat/conversations')
  return res.data.conversations
}

/**
 * 创建新会话。
 *
 * `assistantId` 省略时由后端绑定默认助理；传值表示用户在空态屏先挑了助理
 * —— 新会话还不存在，没法走 `updateConversation`，所以必须在创建时带上。
 */
export async function createConversation(
  model: string,
  title?: string,
  assistantId?: string
): Promise<Conversation> {
  const res = await apiClient.post<Conversation>('/chat/conversations', {
    model,
    title,
    ...(assistantId !== undefined ? { assistantId } : {}),
  })
  return res.data
}

/**
 * 更新会话（标题、模型、置顶状态、绑定助理）。
 *
 * `assistantId` 传 `null` 表示解绑，下一次聊天由后端重新解析默认助理；
 * 这里是三端助理切换器共用的唯一出口，不要在各端自己发请求。
 */
export async function updateConversation(
  id: string,
  data: { title?: string; model?: string; isPinned?: boolean; assistantId?: string | null }
): Promise<Conversation> {
  const res = await apiClient.patch<Conversation>(`/chat/conversations/${id}`, data)
  return res.data
}

/** 删除会话 */
export async function deleteConversation(id: string): Promise<void> {
  await apiClient.delete(`/chat/conversations/${id}`)
}

/** 获取指定会话的消息列表 */
export async function listMessages(convId: string): Promise<Message[]> {
  const res = await apiClient.get<{
    messages: Message[]
    nextCursor: null
    hasMore: boolean
  }>(`/chat/conversations/${convId}/messages`)
  return res.data.messages
}

/** 获取当前账户的聊天扩展能力。 */
export async function getChatCapabilities(): Promise<{ webSearch: SearchCapability }> {
  const res = await apiClient.get<{ webSearch: SearchCapability }>('/chat/capabilities')
  return res.data
}
