import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AutomationUpdateInput } from '@yuanai/types'

import {
  createAutomation,
  deleteAutomation,
  listAutomations,
  pauseAutomation,
  resumeAutomation,
  runAutomationNow,
  updateAutomation,
} from '../api/automations.js'
import { useAuthStore } from '../stores/auth.store.js'

/** 获取当前用户的自动化控制列表。 */
export function useAutomations() {
  const accessToken = useAuthStore((state) => state.accessToken)
  return useQuery({
    queryKey: ['automations'],
    queryFn: listAutomations,
    enabled: Boolean(accessToken),
  })
}

/** 创建自动化并刷新控制列表。 */
export function useCreateAutomation() {
  return useAutomationMutation(createAutomation)
}

/** 更新自动化定义并刷新控制列表。 */
export function useUpdateAutomation() {
  return useAutomationMutation(({ id, input }: { id: string; input: AutomationUpdateInput }) =>
    updateAutomation(id, input)
  )
}

/** 暂停或恢复自动化并刷新控制列表。 */
export function useAutomationStatus() {
  return useAutomationMutation(({ id, active }: { id: string; active: boolean }) =>
    active ? resumeAutomation(id) : pauseAutomation(id)
  )
}

/** 立即运行一次自动化并刷新控制列表。 */
export function useRunAutomationNow() {
  return useAutomationMutation(runAutomationNow)
}

/** 删除自动化并刷新控制列表。 */
export function useDeleteAutomation() {
  return useAutomationMutation(deleteAutomation)
}

/** 统一处理使自动化快照失效的写操作。 */
function useAutomationMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['automations'] }),
  })
}
