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
