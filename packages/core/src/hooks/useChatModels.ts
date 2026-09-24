import { useMemo } from 'react'

import { resolveChatModels, type ChatModelsState } from '../utils/models.js'
import { useModels } from './useModelsQuery.js'

/**
 * 模型选择器的数据源：后端目录是唯一真相，客户端不再保存模型元数据副本。
 *
 * 返回值必须保持引用稳定——调用方普遍拿 `models` 做 useMemo 依赖，
 * 每次渲染换新数组会让派生状态反复重算甚至触发同步 effect 循环。
 *
 * @returns 可直接渲染的模型列表与加载/兜底标记
 */
export function useChatModels(): ChatModelsState {
  const { data, isFetching } = useModels()
  return useMemo(() => resolveChatModels(data, isFetching), [data, isFetching])
}
