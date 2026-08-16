import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Conversation, Message, SearchCapability } from '@yuanai/types'
import {
  createConversation,
  deleteConversation,
  getChatCapabilities,
  listConversations,
  listMessages,
  updateConversation,
} from '../api/chat.js'
import { useAuthStore } from '../stores/auth.store.js'

/** 会话列表查询（已登录时自动触发） */
export function useConversations() {
  const accessToken = useAuthStore((s) => s.accessToken)
  return useQuery({
    queryKey: ['conversations'],
    queryFn: listConversations,
    enabled: !!accessToken,
    staleTime: 30 * 1000,
  })
}

/** 指定会话的消息列表查询 */
export function useMessages(convId: string) {
  return useQuery({
    queryKey: ['messages', convId],
    queryFn: () => listMessages(convId),
    enabled: !!convId,
    staleTime: 10 * 1000,
  })
}

/** 已登录用户的聊天能力查询，供联网搜索等开关决定可用状态。 */
export function useChatCapabilities() {
  const accessToken = useAuthStore((s) => s.accessToken)
  return useQuery<{ webSearch: SearchCapability }>({
    queryKey: ['chat-capabilities'],
    queryFn: getChatCapabilities,
    enabled: !!accessToken,
    staleTime: 30 * 1000,
  })
}

/** 创建会话 mutation */
export function useCreateConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ model, title }: { model: string; title?: string }) =>
      createConversation(model, title),
    onSuccess: (newConv: Conversation) => {
      qc.setQueryData<Conversation[]>(['conversations'], (prev) =>
        prev ? [newConv, ...prev] : [newConv]
      )
      // 新会话必然没有历史消息，预填缓存避免 useMessages 出现一次多余的 loading 态
      qc.setQueryData<Message[]>(['messages', newConv.id], [])
    },
  })
}

/** 更新会话（标题、置顶等）mutation */
export function useUpdateConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string
      title?: string
      model?: string
      isPinned?: boolean
    }) => updateConversation(id, data),
    onSuccess: (updated: Conversation) => {
      qc.setQueryData<Conversation[]>(['conversations'], (prev) =>
        prev?.map((c) => (c.id === updated.id ? updated : c))
      )
    },
  })
}

/** 删除会话 mutation。会话数变化会影响用户统计卡片，需同步失效 ``['me','stats']``。 */
export function useDeleteConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteConversation(id),
    onSuccess: (_data, id) => {
      qc.setQueryData<Conversation[]>(['conversations'], (prev) => prev?.filter((c) => c.id !== id))
      qc.removeQueries({ queryKey: ['messages', id] })
      void qc.invalidateQueries({ queryKey: ['me', 'stats'] })
    },
  })
}

/** 批量删除会话 mutation。同 ``useDeleteConversation``，需失效统计。 */
export function useDeleteConversations() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => deleteConversation(id)))
    },
    onSuccess: (_data, ids) => {
      const idSet = new Set(ids)
      qc.setQueryData<Conversation[]>(['conversations'], (prev) =>
        prev?.filter((c) => !idSet.has(c.id))
      )
      ids.forEach((id) => qc.removeQueries({ queryKey: ['messages', id] }))
      void qc.invalidateQueries({ queryKey: ['me', 'stats'] })
    },
  })
}

/** 失效并重新加载指定会话消息 */
export function useInvalidateMessages() {
  const qc = useQueryClient()
  return (convId: string) => qc.invalidateQueries({ queryKey: ['messages', convId] })
}

/** 在消息查询缓存中追加一条消息（乐观更新用） */
export function useAppendMessage() {
  const qc = useQueryClient()
  return (convId: string, msg: Message) => {
    qc.setQueryData<Message[]>(['messages', convId], (prev) => (prev ? [...prev, msg] : [msg]))
  }
}
