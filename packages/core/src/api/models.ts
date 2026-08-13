import type { AIModel } from '@yuanai/types'
import { apiClient } from './client.js'

/**
 * 后端返回的原始模型条目（Pydantic 直接序列化 → snake_case）。
 * 单独定义以便在此处做 snake→camel 转换，types 层保持 camelCase 单一约定。
 */
interface RawModel {
  id: string
  name: string
  provider: string
  description: string
  supports_vision: boolean
  supports_files: boolean
  context_length: number
  is_default: boolean
  capability?: 'chat' | 'image_generation' | 'video_generation'
  pricing?: {
    input_cached_cny_per_million?: number
    input_uncached_cny_per_million?: number
    output_cny_per_million?: number
  }
}

function toAIModel(raw: RawModel): AIModel {
  const pricing = raw.pricing
    ? {
        ...(typeof raw.pricing.input_cached_cny_per_million === 'number'
          ? { inputCachedCnyPerMillion: raw.pricing.input_cached_cny_per_million }
          : {}),
        ...(typeof raw.pricing.input_uncached_cny_per_million === 'number'
          ? { inputUncachedCnyPerMillion: raw.pricing.input_uncached_cny_per_million }
          : {}),
        ...(typeof raw.pricing.output_cny_per_million === 'number'
          ? { outputCnyPerMillion: raw.pricing.output_cny_per_million }
          : {}),
      }
    : {}
  return {
    id: raw.id,
    name: raw.name,
    provider: raw.provider,
    description: raw.description,
    supportsVision: raw.supports_vision,
    supportsFiles: raw.supports_files,
    contextLength: raw.context_length,
    isDefault: raw.is_default,
    ...(raw.capability ? { capability: raw.capability } : {}),
    ...(Object.keys(pricing).length > 0 ? { pricing } : {}),
  }
}

/** 获取可用 AI 模型列表 */
export async function listModels(): Promise<AIModel[]> {
  const res = await apiClient.get<{ models: RawModel[] }>('/models')
  return res.data.models.map(toAIModel)
}
