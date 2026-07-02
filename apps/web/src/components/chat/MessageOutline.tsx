'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type RefObject } from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'
import type { MsgPair } from './utils'
import { getMsgText } from './utils'

export interface MessageOutlineProps {
  pairs: MsgPair[]
  virtuosoRef: RefObject<VirtuosoHandle | null>
}

/** 默认折叠态最多展示的色块数量，超出部分仅在悬浮浮层中可见 */
const COMPACT_MAX = 10
/** 浮层每页展示的历史条目数，滚动到顶部时增量加载上一页 */
const PAGE_SIZE = 20
/** 折叠态色块与浮层之间存在视觉间隙，鼠标划过间隙时延迟收起，避免浮层过早消失 */
const CLOSE_DELAY_MS = 200

/**
 * 右侧消息定位（minimap）。
 *
 * 折叠态：固定在视口垂直居中，仅展示围绕当前项的少量色块，避免长对话铺满整条右侧；
 * 悬浮态：展开浮层，按时间顺序列出历史消息标题，默认停在最新一条，
 * 向上滚动到顶部时增量加载更早的消息（数据已在内存中，纯前端分页展示，不发起请求）。
 */
export function MessageOutline({ pairs, virtuosoRef }: MessageOutlineProps): JSX.Element | null {
  const [active, setActive] = useState(0)
  const [hovering, setHovering] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const flyoutRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const items = useMemo(
    () =>
      pairs.map((pair) => {
        const text = getMsgText(pair.userMsg)
        const summary = text.slice(0, 30) + (text.length > 30 ? '…' : '')
        // 8~24px：正比于消息字符数，限幅
        const height = Math.min(24, Math.max(8, Math.ceil(text.length / 12) + 8))
        return { key: pair.pairKey, summary, full: text, height }
      }),
    [pairs]
  )

  useEffect(() => {
    // 新消息到来时把 active 定位到末尾
    if (items.length > 0) setActive(items.length - 1)
  }, [items.length])

  useEffect(() => {
    if (!hovering) return
    setVisibleCount(PAGE_SIZE)
    // 展开时默认滚动到底部，展示最新（当前）一条
    requestAnimationFrame(() => {
      const el = flyoutRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }, [hovering])

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    },
    []
  )

  // 折叠态色块与浮层之间隔着一段间隙，鼠标划过间隙时会短暂离开两者的可命中区域；
  // 收起前等待 CLOSE_DELAY_MS，若鼠标在此期间重新进入（哪怕命中的是间隙对侧的浮层），
  // 收起会被取消，从而避免"还没移到浮层上浮层就已经消失"的问题。
  const openFlyout = useCallback((): void => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setHovering(true)
  }, [])

  const scheduleCloseFlyout = useCallback((): void => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => {
      setHovering(false)
      closeTimerRef.current = null
    }, CLOSE_DELAY_MS)
  }, [])

  if (items.length < 3) return null

  const jump = (idx: number): void => {
    // pair 在虚拟列表里的实际 index 需要按 rows 顺序推导：
    // MessageList 按 [user, ai, user, ai, ...] 排列，因此 user 在偶数位
    virtuosoRef.current?.scrollToIndex({ index: idx * 2, align: 'start', behavior: 'smooth' })
    setActive(idx)
  }

  const compactStart = Math.max(
    0,
    Math.min(active - Math.floor(COMPACT_MAX / 2), items.length - COMPACT_MAX)
  )
  const compactItems = items
    .slice(compactStart, compactStart + COMPACT_MAX)
    .map((item, i) => ({ ...item, idx: compactStart + i }))

  const flyoutStart = Math.max(0, items.length - visibleCount)
  const flyoutItems = items.slice(flyoutStart).map((item, i) => ({ ...item, idx: flyoutStart + i }))

  const onFlyoutScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    if (flyoutStart === 0) return
    const el = e.currentTarget
    if (el.scrollTop > 40) return
    const prevHeight = el.scrollHeight
    setVisibleCount((c) => Math.min(items.length, c + PAGE_SIZE))
    // 顶部增量插入更早条目后，保持视觉滚动位置不跳动
    requestAnimationFrame(() => {
      el.scrollTop += el.scrollHeight - prevHeight
    })
  }

  return (
    <div className="ch-outline-wrap" onMouseEnter={openFlyout} onMouseLeave={scheduleCloseFlyout}>
      <nav className="ch-outline" aria-label="消息导航">
        {compactItems.map((item) => (
          <button
            key={item.key}
            className={`ch-outline-item ${item.idx === active ? 'active' : ''}`}
            style={{ height: item.height }}
            title={item.full}
            onClick={() => jump(item.idx)}
            aria-label={item.summary}
          >
            <span className="ch-outline-dot" />
          </button>
        ))}
      </nav>
      {hovering && (
        <div className="ch-outline-flyout" ref={flyoutRef} onScroll={onFlyoutScroll}>
          {flyoutItems.map((item) => (
            <button
              key={item.key}
              className={`ch-outline-flyout-row ${item.idx === active ? 'active' : ''}`}
              title={item.full}
              onClick={() => jump(item.idx)}
            >
              <span className="ch-outline-flyout-text">{item.summary}</span>
              <span className="ch-outline-flyout-mark" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
