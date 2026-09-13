import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateKnowledgeTextSourceInput } from '@yuanai/types'

import {
  createKnowledgeBase,
  createKnowledgeTextSource,
  listKnowledgeBases,
  listKnowledgeSources,
  publishKnowledgeDocument,
  searchKnowledgeBase,
  type CreateKnowledgeBaseInput,
  type KnowledgeSearchInput,
} from '../api/knowledge.js'
import { useAuthStore } from '../stores/auth.store.js'

/** 获取当前用户可访问的知识库。 */
export function useKnowledgeBases() {
  const accessToken = useAuthStore((state) => state.accessToken)
  return useQuery({
    queryKey: ['knowledge-bases'],
    queryFn: listKnowledgeBases,
    enabled: Boolean(accessToken),
  })
}

/** 获取选定知识库已有来源及其版本。 */
export function useKnowledgeSources(knowledgeBaseId: string) {
  const accessToken = useAuthStore((state) => state.accessToken)
  return useQuery({
    queryKey: ['knowledge-sources', knowledgeBaseId],
    queryFn: () => listKnowledgeSources(knowledgeBaseId),
    enabled: Boolean(accessToken) && Boolean(knowledgeBaseId),
  })
}

/** 创建知识库并刷新可访问列表。 */
export function useCreateKnowledgeBase() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateKnowledgeBaseInput) => createKnowledgeBase(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] }),
  })
}

/** 创建知识库纯文本来源的初始暂存版本。 */
export function useCreateKnowledgeTextSource() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      knowledgeBaseId,
      input,
    }: {
      knowledgeBaseId: string
      input: CreateKnowledgeTextSourceInput
    }) => createKnowledgeTextSource(knowledgeBaseId, input),
    onSuccess: (_document, variables) =>
      queryClient.invalidateQueries({ queryKey: ['knowledge-sources', variables.knowledgeBaseId] }),
  })
}

/** 发布知识库来源的一个暂存版本。 */
export function usePublishKnowledgeDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      knowledgeBaseId,
      sourceId,
      documentId,
    }: {
      knowledgeBaseId: string
      sourceId: string
      documentId: string
    }) => publishKnowledgeDocument(knowledgeBaseId, sourceId, documentId),
    onSuccess: (_document, variables) =>
      queryClient.invalidateQueries({ queryKey: ['knowledge-sources', variables.knowledgeBaseId] }),
  })
}

/** 对选定知识库执行用户发起的测试检索。 */
export function useKnowledgeSearch(knowledgeBaseId: string, input: KnowledgeSearchInput | null) {
  const accessToken = useAuthStore((state) => state.accessToken)
  return useQuery({
    queryKey: ['knowledge-search', knowledgeBaseId, input?.query, input?.limit],
    queryFn: () => searchKnowledgeBase(knowledgeBaseId, input ?? { query: '' }),
    enabled: Boolean(accessToken) && Boolean(knowledgeBaseId) && Boolean(input?.query.trim()),
  })
}
