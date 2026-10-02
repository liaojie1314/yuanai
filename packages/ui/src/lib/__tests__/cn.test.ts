import { describe, expect, it } from 'vitest'
import { cn } from '../cn'

describe('cn', () => {
  it('合并多个类名', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('丢弃假值并展开条件对象/数组', () => {
    expect(cn('a', false, null, undefined, ['b', { c: true, d: false }])).toBe('a b c')
  })

  it('后出现的 Tailwind 冲突类胜出', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4')
  })
})
