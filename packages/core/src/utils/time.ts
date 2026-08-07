/**
 * 消息时间戳格式化（依据用户 timeFmt / dateFmt 偏好）。
 *
 * 从 web `apps/web/src/components/chat/utils.ts` 下沉，供 web / mobile 共用：
 * - 今天 → 只显示时间；昨天 → 前缀 + 时间；更早 → 日期 + 时间
 * - `yesterdayLabel` 供移动端注入 i18n 文案，默认与 web 一致为「昨天」
 * - `now` 供测试固定基准时间
 */

import type { DateFmt, TimeFmt } from '../stores/prefs.store.js'

export interface FormatMsgTimeOptions {
  /** 基准"现在"时间戳（毫秒）；缺省取系统时间 */
  now?: number
  /** 「昨天」前缀文案（i18n 注入点） */
  yesterdayLabel?: string
}

export function formatMsgTime(
  ts: number | string,
  timeFmt: TimeFmt,
  dateFmt: DateFmt,
  opts?: FormatMsgTimeOptions
): string {
  const d = new Date(ts)
  const now = new Date(opts?.now ?? Date.now())
  const todayStr = now.toDateString()
  const yd = new Date(now)
  yd.setDate(now.getDate() - 1)

  const h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  const timeStr =
    timeFmt === '24h'
      ? `${String(h).padStart(2, '0')}:${m}`
      : `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`

  if (d.toDateString() === todayStr) return timeStr
  if (d.toDateString() === yd.toDateString()) return `${opts?.yesterdayLabel ?? '昨天'} ${timeStr}`

  const y = d.getFullYear()
  const mo = d.getMonth() + 1
  const day = d.getDate()
  const dateStr =
    dateFmt === 'ymd'
      ? `${y}/${mo}/${day}`
      : dateFmt === 'mdy'
        ? `${mo}/${day}/${y}`
        : `${day}/${mo}/${y}`
  return `${dateStr} ${timeStr}`
}
