import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateMediaGenerationTaskInput, MediaGenerationTask, Message } from '@yuanai/types'
import { Role } from '@yuanai/types'
import { useEffect } from 'react'

import { cancelMediaTask, createMediaTask, listMediaTasks } from '../api/media.js'
import { useAuthStore } from '../stores/auth.store.js'

const ACTIVE_MEDIA_STATUSES = new Set<MediaGenerationTask['status']>(['queued', 'running'])

/** 将任务当前状态翻译为消息时间线中的稳定占位文案。 */
export function mediaTaskContent(task: MediaGenerationTask): string {
  const label = task.type === 'image' ? '图片' : task.type === 'music' ? '音乐' : '视频'
  if (task.status === 'succeeded') return `${label}生成完成`
  if (task.status === 'failed') return `${label}生成失败`
  if (task.status === 'canceled') return `已取消${label}生成`
  return `正在生成${label}`
}

/** 把服务端任务状态回写到对应 assistant 消息，避免等待完整消息查询后才更新任务卡。 */
function mergeTaskIntoMessages(
  messages: Message[] | undefined,
  task: MediaGenerationTask
): Message[] | undefined {
  return messages?.map((message) =>
    message.mediaTask?.id === task.id
      ? { ...message, content: mediaTaskContent(task), mediaTask: task }
      : message
  )
}

/** 查询会话的媒体任务，并在任务未结束时按受限频率轮询。 */
export function useMediaTasks(conversationId: string | undefined) {
  const accessToken = useAuthStore((state) => state.accessToken)
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['media-tasks', conversationId],
    queryFn: () => listMediaTasks(conversationId ?? ''),
    enabled: Boolean(accessToken && conversationId),
    staleTime: 1_000,
    refetchInterval: (query) =>
      query.state.data?.some((task) => ACTIVE_MEDIA_STATUSES.has(task.status)) ? 2_500 : false,
  })
  const tasks = query.data
  useEffect(() => {
    tasks?.forEach((task) => {
      queryClient.setQueryData<Message[]>(['messages', task.conversationId], (messages) =>
        mergeTaskIntoMessages(messages, task)
      )
    })
  }, [queryClient, tasks])
  return query
}

/** 创建媒体任务，并立刻向对应会话的消息缓存投影 assistant 任务卡。 */
export function useCreateMediaTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createMediaTask,
    onSuccess: (task) => {
      queryClient.setQueryData<MediaGenerationTask[]>(
        ['media-tasks', task.conversationId],
        (tasks) => {
          const previous = tasks ?? []
          return previous.some((item) => item.id === task.id) ? previous : [...previous, task]
        }
      )
      queryClient.setQueryData<Message[]>(['messages', task.conversationId], (messages) => {
        const previous = messages ?? []
        const next = [...previous]
        const assistantIndex = next.findIndex((message) => message.id === task.messageId)
        if (
          task.sourceMessageId !== null &&
          !next.some((message) => message.id === task.sourceMessageId)
        ) {
          const userMessage: Message = {
            id: task.sourceMessageId,
            role: Role.User,
            content: task.prompt,
            files: [],
            createdAt: task.createdAt,
          }
          if (assistantIndex === -1) next.push(userMessage)
          else next.splice(assistantIndex, 0, userMessage)
        }
        if (assistantIndex === -1) {
          next.push({
            id: task.messageId,
            role: Role.Assistant,
            content: mediaTaskContent(task),
            model: task.model,
            mediaTask: task,
            files: [],
            createdAt: task.createdAt,
          })
        }
        return next
      })
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
      void queryClient.invalidateQueries({ queryKey: ['messages', task.conversationId] })
    },
  })
}

/** 取消媒体任务，并同步任务列表和它在消息时间线中的投影。 */
export function useCancelMediaTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: cancelMediaTask,
    onSuccess: (task) => {
      queryClient.setQueryData<MediaGenerationTask[]>(
        ['media-tasks', task.conversationId],
        (tasks) => tasks?.map((item) => (item.id === task.id ? task : item))
      )
      queryClient.setQueryData<Message[]>(['messages', task.conversationId], (messages) =>
        mergeTaskIntoMessages(messages, task)
      )
    },
  })
}

/** 创建媒体任务时使用的显式跨端 mutation 输入。 */
export type CreateMediaTaskInput = CreateMediaGenerationTaskInput
