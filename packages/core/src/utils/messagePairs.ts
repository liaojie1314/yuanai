import type { Message } from '@yuanai/types'

/**
 * 消息对：一条用户消息 + 它对应的若干条 AI 回复。
 *
 * 「重新生成」在后端表现为**再发一次同样的用户消息**（`/chat/stream` 每轮都会新建
 * user + assistant 两条记录），所以同一个问题的多个回答在消息流里是
 * `user A / ai 1 / user A / ai 2` 的形态。配对时把内容相同的相邻用户消息合并，
 * 多个 assistant 就成了同一问题的「多版本」，供 UI 做 `‹ 2/3 ›` 切换。
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

  for (const msg of msgs) {
    if (msg.role === 'user') {
      pairs.push({ pairKey: msg.id, userMsg: msg, assistants: [] })
      continue
    }
    const last = pairs[pairs.length - 1]
    if (last) {
      last.assistants.push(msg)
    } else {
      // 开头就是 assistant：建一个无用户消息的孤儿对，避免丢内容
      pairs.push({ pairKey: msg.id, userMsg: null, assistants: [msg] })
    }
  }

  // 相邻且用户内容相同 → 判定为「重新生成」，合并成同一对的多个版本
  const merged: MessagePair[] = []
  for (const pair of pairs) {
    const last = merged[merged.length - 1]
    if (last?.userMsg && pair.userMsg && last.userMsg.content === pair.userMsg.content) {
      last.assistants.push(...pair.assistants)
    } else {
      merged.push(pair)
    }
  }
  return merged
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
