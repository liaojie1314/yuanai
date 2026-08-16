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

/** 创建新会话 */
export async function createConversation(model: string, title?: string): Promise<Conversation> {
  const res = await apiClient.post<Conversation>('/chat/conversations', { model, title })
  return res.data
}

/** 更新会话（标题、模型、置顶状态） */
export async function updateConversation(
  id: string,
  data: { title?: string; model?: string; isPinned?: boolean }
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
