import type { Message } from '@yuanai/types'

/**
 * 消息对：一条用户消息 + 它对应的若干条 AI 回复。
 *
 * 「重新生成」在后端表现为新增一条用户消息和一条 assistant 消息；新用户消息会显式
 * 保存 `regeneratedFromMessageId`。只有这个来源关系才能折叠为同一个问题的多个版本，
 * 因为用户连续发送相同文本本身仍是两轮独立对话。
 */
export interface MessagePair {
  /** 配对键 = 首条用户消息 ID（多版本合并后保持稳定，可作 React key / 版本态索引） */
  pairKey: string
  /**
   * 该轮的用户消息。
   * 为 `null` 表示消息流以 assistant 开头（理论上不会发生，但不静默丢弃数据）。
   */
  userMsg: Message | null
  /** 该轮的 AI 回复，按时间正序；长度 > 1 即存在多版本 */
  assistants: Message[]
}

/**
 * 把线性消息流折叠成「问 → 多个答」的消息对列表。
 *
 * 与 web 端 `apps/web/src/components/chat/utils.ts#buildPairs` 行为一致，
 * 区别是这里直接吃后端 `Message` 类型，两端共用同一份分组语义。
 *
 * @param msgs - 按时间正序的消息列表
 * @returns 折叠后的消息对列表，顺序与输入一致
 */
export function buildMessagePairs(msgs: readonly Message[]): MessagePair[] {
  const pairs: MessagePair[] = []
  const pairsByUserMessageId = new Map<string, MessagePair>()
  let activePair: MessagePair | null = null

  for (const msg of msgs) {
    if (msg.role === 'user') {
      const sourcePair = msg.regeneratedFromMessageId
        ? pairsByUserMessageId.get(msg.regeneratedFromMessageId)
        : undefined
      if (sourcePair) {
        // 新的 regenerated user 行只是某个已展示问题的版本载体，不再重复渲染问题气泡。
        activePair = sourcePair
        pairsByUserMessageId.set(msg.id, sourcePair)
      } else {
        activePair = { pairKey: msg.id, userMsg: msg, assistants: [] }
        pairs.push(activePair)
        pairsByUserMessageId.set(msg.id, activePair)
      }
      continue
    }
    if (activePair) {
      activePair.assistants.push(msg)
    } else {
      // 开头就是 assistant：建一个无用户消息的孤儿对，避免丢内容
      activePair = { pairKey: msg.id, userMsg: null, assistants: [msg] }
      pairs.push(activePair)
    }
  }
  return pairs
}

/**
 * 把用户选择的版本下标夹到合法区间。
 *
 * 版本态由 UI 层按 `pairKey` 记住，而消息列表会因为流式结束 refetch 而增删版本；
 * 渲染前统一夹一次，避免拿到越界下标渲染出空白。
 *
 * @param versionCount - 当前可选版本总数
 * @param idx - 用户选择的下标；`undefined` 表示未选过 → 落到最新一版
 * @returns 合法下标；无任何版本时返回 0
 */
export function clampVersionIdx(versionCount: number, idx: number | undefined): number {
  const lastIdx = Math.max(0, versionCount - 1)
  if (idx === undefined) return lastIdx
  if (Number.isNaN(idx)) return lastIdx
  return Math.max(0, Math.min(idx, lastIdx))
}
