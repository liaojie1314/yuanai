import type { Conversation, ConversationTitleSource } from '@yuanai/types'

import type { ConvGroup } from '../stores/chat.store.js'

/**
 * 会话分组逻辑：置顶 / 今日 / 昨日 / 本周。
 *
 * 与 web 端 `apps/web/src/components/chat/utils.ts` 保持行为一致，
 * 供两端共用。`ConvGroup` 类型复用 `stores/chat.store` 里已声明的版本，
 * 避免重复导出。
 */
export function convGroup(conv: Conversation, now: number = 0): ConvGroup {
  if (conv.isPinned) return 'pinned'
  const ts = conv.lastMessageAt ?? conv.createdAt
  const reference = now > 0 ? now : Number(new Date().valueOf())
  const age = reference - new Date(ts).getTime()
  if (age < 86_400_000) return 'today'
  if (age < 172_800_000) return 'yesterday'
  return 'week'
}

export interface ConversationSummary {
  id: string
  title: string
  /** 标题生成进度，供平台侧边栏在首问期间显示非阻塞状态。 */
  titleSource: ConversationTitleSource
  group: ConvGroup
  isPinned: boolean
  updatedAt: number
}

export function conversationToSummary(conv: Conversation, now: number = 0): ConversationSummary {
  const ts = conv.lastMessageAt ?? conv.createdAt
  return {
    id: conv.id,
    title: conv.title,
    titleSource: conv.titleSource,
    group: convGroup(conv, now),
    isPinned: conv.isPinned,
    updatedAt: new Date(ts).getTime(),
  }
}

/** 按 group 分桶，同桶内按 updatedAt 倒序 */
export function groupConversations(
  convs: readonly Conversation[]
): Record<ConvGroup, ConversationSummary[]> {
  const now = Number(new Date().valueOf())
  const summaries = convs.map((c) => conversationToSummary(c, now))
  const sorted = [...summaries].sort((a, b) => b.updatedAt - a.updatedAt)
  return {
    pinned: sorted.filter((c) => c.group === 'pinned'),
    today: sorted.filter((c) => c.group === 'today'),
    yesterday: sorted.filter((c) => c.group === 'yesterday'),
    week: sorted.filter((c) => c.group === 'week'),
  }
}
