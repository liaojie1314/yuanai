import type { AIModel } from '@yuanai/types'
import { apiClient } from './client.js'

/** 获取可用 AI 模型列表 */
export async function listModels(): Promise<AIModel[]> {
  const res = await apiClient.get<{ models: AIModel[] }>('/models')
  return res.data.models
}
