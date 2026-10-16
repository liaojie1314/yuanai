import { readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { AGENT_CENTERS } from '../agentCenters'
import en from '@/i18n/locales/en.json'
import zhCN from '@/i18n/locales/zh-CN.json'

const AGENT_DIR = resolve(process.cwd(), 'src/app/(main)/agent')

/** 按完整键在语言包里取值，取不到返回 undefined。 */
function lookup(messages: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      messages
    )
}

describe('AGENT_CENTERS', () => {
  it('每个入口都指向真实存在的路由', () => {
    for (const entry of AGENT_CENTERS) {
      const segment = entry.href.replace('/agent/', '')
      expect(
        existsSync(resolve(AGENT_DIR, segment, 'page.tsx')),
        `${entry.href} 没有对应页面，菜单点进去就是 404`
      ).toBe(true)
    }
  })

  it('每个 Agent 页面都挂在菜单里，否则只能靠敲 URL 进去', () => {
    // 本仓反复踩的坑：控制面建完即记为交付，没人确认界面上进不进得去。
    // 新增 /agent/<段>/page.tsx 却忘了挂入口，这条用例直接挂。
    const routed = readdirSync(AGENT_DIR, { withFileTypes: true })
      .filter((item) => item.isDirectory())
      .map((item) => item.name)
      .filter((name) => existsSync(resolve(AGENT_DIR, name, 'page.tsx')))
    const linked = AGENT_CENTERS.map((entry) => entry.href.replace('/agent/', ''))
    expect(routed.slice().sort()).toEqual(linked.slice().sort())
  })

  it('入口文案两种语言都有，不留硬编码或缺键', () => {
    for (const entry of AGENT_CENTERS) {
      expect(lookup(zhCN, entry.labelKey), `zh-CN 缺 ${entry.labelKey}`).toBeTypeOf('string')
      expect(lookup(en, entry.labelKey), `en 缺 ${entry.labelKey}`).toBeTypeOf('string')
    }
  })
})
