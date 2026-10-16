import { describe, expect, it } from 'vitest'

import en from '@/i18n/locales/en.json'
import zhCN from '@/i18n/locales/zh-CN.json'
import { KNOWN_API_ERROR_CODES, resolveApiErrorMessage } from '@/lib/apiError'

describe('resolveApiErrorMessage', () => {
  it('把后端 detail 码翻成对应文案', () => {
    const error = {
      isAxiosError: true,
      response: { data: { detail: 'LOCAL_MEMORY_APPROVAL_TIMEOUT' } },
    }
    expect(resolveApiErrorMessage(error, (key) => key)).toBe('errors.LOCAL_MEMORY_APPROVAL_TIMEOUT')
  })

  it('detail 为对象时取其中的 code', () => {
    const error = {
      isAxiosError: true,
      response: { data: { detail: { code: 'MEMORY_SCOPE_DUPLICATE', message: '重复' } } },
    }
    expect(resolveApiErrorMessage(error, (key) => key)).toBe('errors.MEMORY_SCOPE_DUPLICATE')
  })

  it('未知 detail 码退回通用文案而不是把码直接丢给用户', () => {
    const error = { isAxiosError: true, response: { data: { detail: 'SOMETHING_NEW' } } }
    expect(resolveApiErrorMessage(error, (key) => key)).toBe('errors.generic')
  })

  it('非 axios 错误也能退回通用文案', () => {
    expect(resolveApiErrorMessage(new Error('boom'), (key) => key)).toBe('errors.generic')
  })

  it('响应体缺 detail 时退回通用文案', () => {
    expect(resolveApiErrorMessage({ response: { data: {} } }, (key) => key)).toBe('errors.generic')
  })

  it('每个已知码在两份语言包里都有文案，否则用户看到的是键名', () => {
    for (const code of [...KNOWN_API_ERROR_CODES, 'generic']) {
      expect(zhCN.errors, `zh-CN 缺 errors.${code}`).toHaveProperty(code)
      expect(en.errors, `en 缺 errors.${code}`).toHaveProperty(code)
    }
  })
})
