import type { AIModel } from '@yuanai/types'

/**
 * 筛选可用于普通聊天流的模型。
 *
 * 图片和视频生成模型需要通过专用任务 API 调用，不能出现在聊天模型选择器中。
 * 未声明 capability 的历史模型与明确标记为 chat 的模型均保持兼容。
 *
 * @param models 后端返回的完整模型目录
 * @returns 适合文本聊天界面展示的模型新数组
 */
export function filterChatModels(models: readonly AIModel[]): AIModel[] {
  return models.filter((model) => model.capability === undefined || model.capability === 'chat')
}

/**
 * 目录不可用时的兜底聊天模型 ID，取后端目录的默认模型。
 *
 * 这是各端唯一允许硬编码的模型信息：名称、描述、上下文长度一律由 `/models` 提供，
 * 客户端不再保存副本，后端换目录时也就不需要改前端。
 */
export const FALLBACK_CHAT_MODEL_ID = 'agnes-3.0-flash'

/**
 * 由兜底 ID 合成的最小模型，仅用于目录取不到时渲染一条可用的选择项。
 *
 * - `name` 直接用 ID：没有目录就没有可信的展示名，显示原始 ID 好过显示可能过期的副本。
 * - `provider` 取 ID 首段：目录 ID 统一是 `<厂商>-<型号>`，推导出来的厂商随 ID 一起变，
 *   不构成第二份元数据，各端的厂商配色/分组因此仍然正确。
 * - `contextLength` 为 0 表示未知，调用方据此隐藏上下文角标。
 * - 两个 `supports*` 取 false：能力未知时按最保守处理，避免让用户传了必定失败的附件。
 */
export const FALLBACK_CHAT_MODEL: AIModel = {
  id: FALLBACK_CHAT_MODEL_ID,
  name: FALLBACK_CHAT_MODEL_ID,
  provider: FALLBACK_CHAT_MODEL_ID.split('-')[0] ?? FALLBACK_CHAT_MODEL_ID,
  description: '',
  supportsVision: false,
  supportsFiles: false,
  contextLength: 0,
  isDefault: true,
}

/** 模型选择器的渲染状态。 */
export interface ChatModelsState {
  /** 可选聊天模型；加载中为空数组，取不到目录时退化为单条兜底模型 */
  models: AIModel[]
  /** 目录请求仍在进行且还没有可展示的数据 */
  isLoading: boolean
  /** 展示的是兜底模型而非后端目录 */
  isFallback: boolean
}

/**
 * 把 `/models` 的查询结果归一成选择器需要的三种状态。
 *
 * 有目录就用目录；请求还在飞就报加载中；请求已结束仍拿不到（失败、离线、未登录）
 * 才退到单条兜底模型——离线用户始终能看到一个可用的选择项，而不是空列表或转不完的圈。
 *
 * @param catalog `/models` 返回的完整目录，未取到时为 undefined
 * @param isFetching 目录请求是否正在进行
 * @returns 选择器可直接渲染的状态
 */
export function resolveChatModels(
  catalog: readonly AIModel[] | undefined,
  isFetching: boolean
): ChatModelsState {
  const models = filterChatModels(catalog ?? [])
  if (models.length > 0) return { models, isLoading: false, isFallback: false }
  if (isFetching) return { models: [], isLoading: true, isFallback: false }
  return { models: [FALLBACK_CHAT_MODEL], isLoading: false, isFallback: true }
}
