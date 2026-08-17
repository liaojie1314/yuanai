import type { ConversationSummary } from '@yuanai/core'
import type { ConvGroup } from '@yuanai/core/stores'

/** 会话侧栏的扁平化行，供 FlashList 按组标题和会话项虚拟渲染。 */
export type ConversationListRow =
  | { kind: 'group'; id: string; label: string }
  | { kind: 'conversation'; id: string; conversation: ConversationSummary }

/**
 * 将按时间分组的会话转换为 FlashList 行。
 * 空分组不会生成标题，避免搜索后出现孤立的分组空白。
 */
export function flattenConversationGroups(
  groups: Record<ConvGroup, ConversationSummary[]>,
  order: readonly ConvGroup[],
  labels: Readonly<Record<ConvGroup, string>>
): ConversationListRow[] {
  const rows: ConversationListRow[] = []
  for (const group of order) {
    const conversations = groups[group]
    if (conversations.length === 0) continue
    rows.push({ kind: 'group', id: `group-${group}`, label: labels[group] })
    for (const conversation of conversations) {
      rows.push({ kind: 'conversation', id: conversation.id, conversation })
    }
  }
  return rows
}
