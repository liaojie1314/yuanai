import type { CreateMediaGenerationTaskInput, MediaGenerationTask } from '@yuanai/types'

import { apiClient } from './client.js'

/** 创建一张会话内可恢复的 Agnes 图片或视频生成任务。 */
export async function createMediaTask(
  input: CreateMediaGenerationTaskInput
): Promise<MediaGenerationTask> {
  const response = await apiClient.post<MediaGenerationTask>('/media/tasks', input)
  return response.data
}

/** 获取指定会话的全部媒体生成任务，用于页面重载和跨设备恢复。 */
export async function listMediaTasks(conversationId: string): Promise<MediaGenerationTask[]> {
  const response = await apiClient.get<{ tasks: MediaGenerationTask[] }>(
    `/chat/conversations/${conversationId}/media-tasks`
  )
  return response.data.tasks
}

/** 读取一个媒体任务的最新状态。 */
export async function getMediaTask(taskId: string): Promise<MediaGenerationTask> {
  const response = await apiClient.get<MediaGenerationTask>(`/media/tasks/${taskId}`)
  return response.data
}

/** 取消仍在等待或执行中的媒体任务。 */
export async function cancelMediaTask(taskId: string): Promise<MediaGenerationTask> {
  const response = await apiClient.post<MediaGenerationTask>(`/media/tasks/${taskId}/cancel`)
  return response.data
}
