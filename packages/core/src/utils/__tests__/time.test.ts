import { describe, expect, it } from 'vitest'

import { formatMsgTime } from '../time.js'

/** 固定"现在"：2026-07-31 15:30 本地时间 */
const NOW = new Date(2026, 6, 31, 15, 30).getTime()

describe('formatMsgTime', () => {
  it('今天的消息只显示时间（24h）', () => {
    const ts = new Date(2026, 6, 31, 9, 5).getTime()
    expect(formatMsgTime(ts, '24h', 'ymd', { now: NOW })).toBe('09:05')
  })

  it('今天的消息只显示时间（12h 下午）', () => {
    const ts = new Date(2026, 6, 31, 14, 5).getTime()
    expect(formatMsgTime(ts, '12h', 'ymd', { now: NOW })).toBe('2:05 PM')
  })

  it('12h 制正午与午夜边界', () => {
    const noon = new Date(2026, 6, 31, 12, 0).getTime()
    const midnight = new Date(2026, 6, 31, 0, 0).getTime()
    expect(formatMsgTime(noon, '12h', 'ymd', { now: NOW })).toBe('12:00 PM')
    expect(formatMsgTime(midnight, '12h', 'ymd', { now: NOW })).toBe('12:00 AM')
  })

  it('昨天的消息带默认「昨天」前缀', () => {
    const ts = new Date(2026, 6, 30, 22, 10).getTime()
    expect(formatMsgTime(ts, '24h', 'ymd', { now: NOW })).toBe('昨天 22:10')
  })

  it('昨天的消息可用自定义前缀（i18n）', () => {
    const ts = new Date(2026, 6, 30, 22, 10).getTime()
    expect(formatMsgTime(ts, '24h', 'ymd', { now: NOW, yesterdayLabel: 'Yesterday' })).toBe(
      'Yesterday 22:10'
    )
  })

  it('更早的消息按 dateFmt 显示日期', () => {
    const ts = new Date(2026, 6, 28, 8, 0).getTime()
    expect(formatMsgTime(ts, '24h', 'ymd', { now: NOW })).toBe('2026/7/28 08:00')
    expect(formatMsgTime(ts, '24h', 'mdy', { now: NOW })).toBe('7/28/2026 08:00')
    expect(formatMsgTime(ts, '24h', 'dmy', { now: NOW })).toBe('28/7/2026 08:00')
  })

  it('接受 ISO 字符串时间戳（后端 Message.createdAt 形态）', () => {
    const iso = new Date(2026, 6, 31, 9, 5).toISOString()
    expect(formatMsgTime(iso, '24h', 'ymd', { now: NOW })).toBe('09:05')
  })
})
