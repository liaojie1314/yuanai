import {
  BookOpen,
  Bot,
  Brain,
  ListChecks,
  Repeat,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/** 用户面板里的一个 Agent 中心入口。 */
export interface AgentCenterEntry {
  /** 目标路由，必须对应 `app/(main)/agent/<段>/page.tsx` */
  readonly href: string
  /** 完整 i18n 键，复用各中心页自己的标题，不另造一套文案 */
  readonly labelKey: string
  readonly icon: LucideIcon
}

/**
 * Agent 各中心的入口清单。
 *
 * `/agent/*` 的页面原来只能直接敲 URL 才进得去：控制面全建完了，界面上一个入口都没有，
 * 对真实用户等于不存在。清单单独成文件是为了能被测试直接读 ——
 * `agentCenters.test.ts` 双向比对路由目录与这份清单，新加中心忘了挂入口会直接挂测试。
 */
export const AGENT_CENTERS: readonly AgentCenterEntry[] = [
  { href: '/agent/assistants', labelKey: 'assistants.title', icon: Bot },
  { href: '/agent/memories', labelKey: 'memories.title', icon: Brain },
  { href: '/agent/knowledge', labelKey: 'knowledge.title', icon: BookOpen },
  { href: '/agent/tools', labelKey: 'tools.title', icon: Wrench },
  { href: '/agent/skills', labelKey: 'skills.title', icon: Sparkles },
  { href: '/agent/automations', labelKey: 'automations.title', icon: Repeat },
  { href: '/agent/runs', labelKey: 'chat.sidebar.agentRuns', icon: ListChecks },
  { href: '/agent/approvals', labelKey: 'chat.sidebar.agentApprovals', icon: ShieldCheck },
]
