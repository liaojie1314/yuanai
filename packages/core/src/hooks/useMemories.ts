import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Memory, MemoryCreateCandidate, MemoryUpdate } from '@yuanai/types'
import { useAuthStore } from '../stores/auth.store.js'
import {
  createMemory,
  deleteMemory,
  listMemories,
  searchMemories,
  updateMemory,
} from '../api/memories.js'

/** 获取当前用户的记忆列表。 */
export function useMemories(status?: Memory['status']) {
  const accessToken = useAuthStore((state) => state.accessToken)
  return useQuery({
    queryKey: ['memories', status],
    queryFn: () => listMemories(status),
    enabled: Boolean(accessToken),
  })
}

/** 创建记忆候选并刷新记忆列表。 */
export function useCreateMemory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: MemoryCreateCandidate) => createMemory(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['memories'] }),
  })
}

/** 更新记忆并刷新记忆列表。 */
export function useUpdateMemory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: MemoryUpdate }) => updateMemory(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['memories'] }),
  })
}

/** 删除记忆并刷新记忆列表。 */
export function useDeleteMemory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteMemory(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['memories'] }),
  })
}

/** 搜索可注入上下文的记忆。 */
export function useSearchMemories(assistantId: string, query: string, limit = 8) {
  const accessToken = useAuthStore((state) => state.accessToken)
  return useQuery({
    queryKey: ['memory-search', assistantId, query, limit],
    queryFn: () => searchMemories(assistantId, query, limit),
    enabled: Boolean(accessToken) && Boolean(assistantId) && query.trim().length > 0,
  })
}
