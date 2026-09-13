/** 知识库成员拥有的最小空间权限。 */
export type KnowledgeBaseMemberRole = 'viewer' | 'editor'

/** 来源版本在构建和公开过程中的状态。 */
export type KnowledgeDocumentStatus = 'staged' | 'published' | 'superseded' | 'failed'

/** 知识库的可共享元数据。 */
export interface KnowledgeBase {
  id: string
  ownerId: string
  name: string
  spaceId: string | null
  createdAt: string
  updatedAt: string
}

/** 纯文本来源的首个待发布版本输入。 */
export interface CreateKnowledgeTextSourceInput {
  name: string
  content: string
  sourceUri?: string
}

/** 来源文档的可审计版本。 */
export interface KnowledgeDocument {
  id: string
  sourceId: string
  version: number
  contentHash: string
  status: KnowledgeDocumentStatus
  createdAt: string
  publishedAt: string | null
}

/** 可访问来源及其可管理的文档版本。 */
export interface KnowledgeSource {
  id: string
  knowledgeBaseId: string
  name: string
  sourceType: string
  sourceUri: string | null
  createdAt: string
  documents: KnowledgeDocument[]
}

/** 检索后可回溯到原始来源片段的引用。 */
export interface KnowledgeCitation {
  knowledgeBaseId: string
  sourceId: string
  documentId: string
  sourceName: string
  sourceUri: string | null
  documentVersion: number
  chunkIndex: number
  section: string | null
  charStart: number
  charEnd: number
  content: string
  score: number
}
