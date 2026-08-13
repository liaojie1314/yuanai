import { describe, expect, it } from 'vitest'

import type { AIModel } from '@yuanai/types'

import { filterChatModels } from './models.js'

const MODELS: AIModel[] = [
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash-0731',
    provider: 'deepseek',
    description: '纯文本聊天模型',
    supportsVision: false,
    supportsFiles: false,
    contextLength: 1_000_000,
    isDefault: true,
  },
  {
    id: 'agnes-2.5-flash',
    name: 'Agnes 2.5 Flash',
    provider: 'agnes',
    description: '支持图像理解的聊天模型',
    supportsVision: true,
    supportsFiles: true,
    contextLength: 128_000,
    isDefault: false,
  },
  {
    id: 'agnes-image-2.1-flash',
    name: 'Agnes Image 2.1 Flash',
    provider: 'agnes',
    description: '图片生成模型',
    supportsVision: true,
    supportsFiles: true,
    contextLength: 0,
    isDefault: false,
    capability: 'image_generation',
  },
  {
    id: 'agnes-video-v2.0',
    name: 'Agnes Video V2.0',
    provider: 'agnes',
    description: '视频生成模型',
    supportsVision: true,
    supportsFiles: true,
    contextLength: 0,
    isDefault: false,
    capability: 'video_generation',
  },
]

describe('filterChatModels', () => {
  it('keeps text and multimodal chat models', () => {
    expect(filterChatModels(MODELS).map((model) => model.id)).toEqual([
      'deepseek-v4-flash',
      'agnes-2.5-flash',
    ])
  })

  it('does not mutate the provider model list', () => {
    const models = filterChatModels(MODELS)

    expect(models).not.toBe(MODELS)
    expect(MODELS).toHaveLength(4)
  })
})
