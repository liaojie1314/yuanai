import { describe, expect, it } from 'vitest'

import type { AIModel } from '@yuanai/types'

import { FALLBACK_CHAT_MODEL_ID, filterChatModels, resolveChatModels } from './models.js'

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

describe('resolveChatModels', () => {
  it('目录到达后直接用后端数据，并滤掉媒体模型', () => {
    const state = resolveChatModels(MODELS, false)

    expect(state).toMatchObject({ isLoading: false, isFallback: false })
    expect(state.models.map((model) => model.id)).toEqual(['deepseek-v4-flash', 'agnes-2.5-flash'])
  })

  it('目录请求进行中时报加载态，不给出任何模型', () => {
    const state = resolveChatModels(undefined, true)

    expect(state).toEqual({ models: [], isLoading: true, isFallback: false })
  })

  it('请求结束仍无目录（失败或离线）时退回单条兜底模型', () => {
    const state = resolveChatModels(undefined, false)

    expect(state.isLoading).toBe(false)
    expect(state.isFallback).toBe(true)
    expect(state.models).toHaveLength(1)
    expect(state.models[0]).toMatchObject({
      id: FALLBACK_CHAT_MODEL_ID,
      name: FALLBACK_CHAT_MODEL_ID,
      provider: 'agnes',
      contextLength: 0,
      supportsVision: false,
      supportsFiles: false,
    })
  })

  it('刷新目录时沿用已有数据，不闪回加载态', () => {
    const state = resolveChatModels(MODELS, true)

    expect(state.isLoading).toBe(false)
    expect(state.models).toHaveLength(2)
  })

  it('目录里只剩媒体模型时也保证选择器有一条可用项', () => {
    const state = resolveChatModels(
      MODELS.filter((model) => model.capability !== undefined),
      false
    )

    expect(state.isFallback).toBe(true)
    expect(state.models.map((model) => model.id)).toEqual([FALLBACK_CHAT_MODEL_ID])
  })
})
