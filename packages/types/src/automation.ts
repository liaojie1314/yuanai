/** 自动化定义的生命周期状态。 */
export type AutomationStatus = 'active' | 'paused' | 'completed'

/** 已支持的自动化触发方式。 */
export type AutomationTriggerType = 'once' | 'cron'

/** 自动化发生记录同步的标准 Agent Run 状态。 */
export type AutomationRunStatus =
  'queued' | 'running' | 'waiting_approval' | 'waiting_input' | 'succeeded' | 'failed' | 'cancelled'

/** 创建一次性或 cron 自动化时的触发器参数。 */
export interface AutomationTriggerInput {
  triggerType: AutomationTriggerType
  scheduledAt?: string
  cronExpression?: string
}

/** 创建自动化的受限目标和调度参数。 */
export interface AutomationCreateInput {
  assistantId: string
  name: string
  goal: string
  model?: string
  maxSteps?: number
  timezone: string
  trigger: AutomationTriggerInput
}

/** 自动化的可编辑字段。 */
export interface AutomationUpdateInput {
  name?: string
  goal?: string
  model?: string
  maxSteps?: number
  status?: AutomationStatus
}

/** 已持久化的下一次触发规则。 */
export interface AutomationTrigger {
  id: string
  automationId: string
  triggerType: AutomationTriggerType
  cronExpression: string | null
  scheduledAt: string | null
  nextRunAt: string | null
  lastRunAt: string | null
  occurrence: number
}

/** 一次自动化触发与标准 Agent Run 的映射。 */
export interface AutomationRun {
  id: string
  automationId: string
  userId: string
  agentRunId: string | null
  occurrenceKey: string
  scheduledFor: string
  status: AutomationRunStatus
  waitDeadline: string | null
  waitReason: string | null
  waitNotifiedAt: string | null
  createdAt: string
  updatedAt: string
}

/** 自动化控制中心展示的定义与最近触发记录。 */
export interface Automation {
  id: string
  userId: string
  assistantId: string
  name: string
  goal: string
  model: string | null
  maxSteps: number
  timezone: string
  status: AutomationStatus
  trigger: AutomationTrigger
  runs: AutomationRun[]
  createdAt: string
  updatedAt: string
}
