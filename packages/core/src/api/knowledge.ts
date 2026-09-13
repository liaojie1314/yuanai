import type {
  CreateKnowledgeTextSourceInput,
  KnowledgeBase,
  KnowledgeCitation,
  KnowledgeDocument,
  KnowledgeSource,
} from '@yuanai/types'

import { apiClient } from './client.js'

/** 创建知识库所需的基础元数据。 */
export interface CreateKnowledgeBaseInput {
  name: string
  spaceId?: string
}

/** 对知识库执行测试检索的输入。 */
export interface KnowledgeSearchInput {
  query: string
  limit?: number
}

/** 列出当前用户可访问的知识库。 */
export async function listKnowledgeBases(): Promise<KnowledgeBase[]> {
  return (await apiClient.get<KnowledgeBase[]>('/knowledge-bases')).data
}

/** 创建一个当前用户拥有的知识库。 */
export async function createKnowledgeBase(input: CreateKnowledgeBaseInput): Promise<KnowledgeBase> {
  return (await apiClient.post<KnowledgeBase>('/knowledge-bases', input)).data
}

/** 为知识库创建带有首个暂存版本的纯文本来源。 */
export async function createKnowledgeTextSource(
  knowledgeBaseId: string,
  input: CreateKnowledgeTextSourceInput
): Promise<KnowledgeDocument> {
  return (
    await apiClient.post<KnowledgeDocument>(
      `/knowledge-bases/${knowledgeBaseId}/sources/text`,
      input
    )
  ).data
}

/** 列出一个知识库现有来源及其版本。 */
export async function listKnowledgeSources(knowledgeBaseId: string): Promise<KnowledgeSource[]> {
  return (await apiClient.get<KnowledgeSource[]>(`/knowledge-bases/${knowledgeBaseId}/sources`))
    .data
}

/** 原子发布一个已构建的知识库来源版本。 */
export async function publishKnowledgeDocument(
  knowledgeBaseId: string,
  sourceId: string,
  documentId: string
): Promise<KnowledgeDocument> {
  return (
    await apiClient.post<KnowledgeDocument>(
      `/knowledge-bases/${knowledgeBaseId}/sources/${sourceId}/documents/${documentId}/publish`
    )
  ).data
}

/** 检索当前用户可访问的已发布知识库片段。 */
export async function searchKnowledgeBase(
  knowledgeBaseId: string,
  input: KnowledgeSearchInput
): Promise<KnowledgeCitation[]> {
  return (
    await apiClient.post<KnowledgeCitation[]>(`/knowledge-bases/${knowledgeBaseId}/search`, input)
  ).data
}
