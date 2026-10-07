import type {
  Memory,
  MemoryCreateCandidate,
  MemoryExport,
  MemoryPage,
  MemorySearchOutcome,
  MemoryUpdate,
} from '@yuanai/types'

import { apiClient } from './client.js'

/** 列出当前用户可见的记忆分页，`cursor` 只能原样回传后端返回的值。 */
export async function listMemories(params?: {
  status?: Memory['status'] | undefined
  cursor?: string | undefined
  limit?: number | undefined
}): Promise<MemoryPage> {
  return (await apiClient.get<MemoryPage>('/memories', { params })).data
}

/** 导出当前用户的全部记忆。 */
export async function exportMemories(): Promise<MemoryExport> {
  return (await apiClient.get<MemoryExport>('/memories/export')).data
}

/** 创建一条待确认的记忆候选。 */
export async function createMemory(input: MemoryCreateCandidate): Promise<Memory> {
  return (await apiClient.post<Memory>('/memories', input)).data
}

/** 更新记忆内容或生命周期状态。 */
export async function updateMemory(id: string, input: MemoryUpdate): Promise<Memory> {
  return (await apiClient.patch<Memory>(`/memories/${id}`, input)).data
}

/** 删除记忆及其派生检索数据。 */
export async function deleteMemory(id: string): Promise<void> {
  await apiClient.delete(`/memories/${id}`)
}

/** 按当前任务检索可注入上下文的记忆，并带出本地节点可用性。 */
export async function searchMemories(
  assistantId: string,
  query: string,
  limit = 8
): Promise<MemorySearchOutcome> {
  return (
    await apiClient.get<MemorySearchOutcome>('/memories/search', {
      params: { assistantId, query, limit },
    })
  ).data
}
