import type {
  Automation,
  AutomationCreateInput,
  AutomationRun,
  AutomationUpdateInput,
} from '@yuanai/types'

import { apiClient } from './client.js'

/** 列出当前用户的自动化及最近触发历史。 */
export async function listAutomations(): Promise<Automation[]> {
  return (await apiClient.get<Automation[]>('/automations')).data
}

/** 创建一个由标准 Agent Run 执行的自动化。 */
export async function createAutomation(input: AutomationCreateInput): Promise<Automation> {
  return (await apiClient.post<Automation>('/automations', input)).data
}

/** 修改自动化定义或暂停状态。 */
export async function updateAutomation(
  id: string,
  input: AutomationUpdateInput
): Promise<Automation> {
  return (await apiClient.patch<Automation>(`/automations/${id}`, input)).data
}

/** 暂停自动化，保留既有历史与下一次时间。 */
export async function pauseAutomation(id: string): Promise<Automation> {
  return (await apiClient.post<Automation>(`/automations/${id}/pause`)).data
}

/** 恢复未完成的自动化。 */
export async function resumeAutomation(id: string): Promise<Automation> {
  return (await apiClient.post<Automation>(`/automations/${id}/resume`)).data
}

/** 立即创建一次普通 Agent Run，不改变原调度。 */
export async function runAutomationNow(id: string): Promise<AutomationRun> {
  return (await apiClient.post<AutomationRun>(`/automations/${id}/run-now`)).data
}

/** 删除自动化定义及其已持久化触发历史。 */
export async function deleteAutomation(id: string): Promise<void> {
  await apiClient.delete(`/automations/${id}`)
}
