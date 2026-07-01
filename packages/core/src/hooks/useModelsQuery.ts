import { useQuery } from '@tanstack/react-query'
import { listModels } from '../api/models.js'
import { useAuthStore } from '../stores/auth.store.js'

/** 获取可用 AI 模型列表（已登录时自动触发，结果缓存 5 分钟） */
export function useModels() {
  const accessToken = useAuthStore((s) => s.accessToken)
  return useQuery({
    queryKey: ['models'],
    queryFn: listModels,
    enabled: !!accessToken,
    staleTime: 5 * 60 * 1000,
  })
}
