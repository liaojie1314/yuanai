'use client'

import { useEffect, useMemo, useState, type JSX, type RefObject } from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'
import type { MsgPair } from './utils'
import { getMsgText } from './utils'

export interface MessageOutlineProps {
  pairs: MsgPair[]
  virtuosoRef: RefObject<VirtuosoHandle | null>
}

/**
 * 右侧消息定位（minimap 缩略条）。
 *
 * 每个 pair 显示一个小色块，块高按用户消息长度归一化到 8~24px；
 * hover 展示标题 tooltip；点击调用 `virtuosoRef.scrollToIndex` 平滑跳转。
 *
 * < 768px 视口通过 CSS 隐藏（避免遮盖消息）。
 */
export function MessageOutline({ pairs, virtuosoRef }: MessageOutlineProps): JSX.Element | null {
  const [active, setActive] = useState(0)

  const items = useMemo(
    () =>
      pairs.map((pair) => {
        const text = getMsgText(pair.userMsg)
        const summary = text.slice(0, 40) + (text.length > 40 ? '…' : '')
        // 8~24px：正比于消息字符数，限幅
        const height = Math.min(24, Math.max(8, Math.ceil(text.length / 12) + 8))
        return { key: pair.pairKey, summary, height }
      }),
    [pairs]
  )

  useEffect(() => {
    // 新消息到来时把 active 定位到末尾
    if (items.length > 0) setActive(items.length - 1)
  }, [items.length])

  if (items.length < 3) return null

  return (
    <nav className="ch-outline" aria-label="消息导航">
      {items.map((item, idx) => (
        <button
          key={item.key}
          className={`ch-outline-item ${idx === active ? 'active' : ''}`}
          style={{ height: item.height }}
          title={item.summary}
          onClick={() => {
            // pair 在虚拟列表里的实际 index 需要按 rows 顺序推导：
            // 简化处理——按 pair 顺序找到第一条 user row 的 index
            // MessageList 按 [user, ai, user, ai, ...] 排列，因此 user 在偶数位
            const userRowIndex = idx * 2
            virtuosoRef.current?.scrollToIndex({
              index: userRowIndex,
              align: 'start',
              behavior: 'smooth',
            })
            setActive(idx)
          }}
          aria-label={item.summary}
        >
          <span className="ch-outline-dot" />
        </button>
      ))}
    </nav>
  )
}
