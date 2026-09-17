import { describe, expect, it } from 'vitest'

import en from '../locales/en.json'
import zhCN from '../locales/zh-CN.json'

/**
 * 语言包一致性门禁。
 *
 * 移动端的 `enUS: MobileMessages = DeepStringify<typeof zhCN>` 由 TypeScript 保证两份
 * messages 结构一致，但 Web 的语言包是两份独立 JSON，类型系统管不到，只能靠本测试兜底。
 * 桌面端 `apps/desktop/src/renderer/shared/i18n.tsx` 直接复用这两份 JSON，因此这里同时
 * 守住了 Web 与 Desktop。
 */

/** 把嵌套 messages 拍平成 `a.b.c` 形式的键路径。 */
function flattenKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof child === 'object' && child !== null ? flattenKeys(child, path) : [path]
  })
}

/** 收集值为空或纯空白的键路径（占位但未真正翻译）。 */
function blankKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof child === 'object' && child !== null) return blankKeys(child, path)
    return typeof child === 'string' && child.trim() === '' ? [path] : []
  })
}

describe('web 语言包一致性', () => {
  const zhKeys = new Set(flattenKeys(zhCN))
  const enKeys = new Set(flattenKeys(en))

  it('en 不缺 zh-CN 已有的键', () => {
    const missing = [...zhKeys].filter((key) => !enKeys.has(key)).sort()
    expect(missing, `en.json 缺少 ${missing.length} 个键`).toEqual([])
  })

  it('en 不含 zh-CN 没有的多余键', () => {
    const extra = [...enKeys].filter((key) => !zhKeys.has(key)).sort()
    expect(extra, `en.json 多出 ${extra.length} 个键`).toEqual([])
  })

  it('两份语言包都没有空字符串值', () => {
    expect(blankKeys(zhCN), 'zh-CN.json 存在空值').toEqual([])
    expect(blankKeys(en), 'en.json 存在空值').toEqual([])
  })
})
