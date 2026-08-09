import { describe, expect, it } from 'vitest'

import { readRuntimeConfig } from './runtime-config'

describe('readRuntimeConfig', () => {
  it('uses the local development defaults without exposing environment values', () => {
    const config = readRuntimeConfig({})

    expect(config).toEqual({
      apiBaseUrl: 'http://localhost:8000/api/v1',
      webBaseUrl: 'http://localhost:3000',
      assetOrigins: [],
    })
    expect(Object.isFrozen(config)).toBe(true)
    expect(Object.isFrozen(config.assetOrigins)).toBe(true)
  })

  it('normalizes configured addresses and asset origins', () => {
    expect(
      readRuntimeConfig({
        YUANAI_API_URL: 'https://api.example.com/api/v1/',
        YUANAI_WEB_URL: 'https://yuanai.example.com/',
        YUANAI_ASSET_ORIGINS: 'https://cdn.example.com/files, http://127.0.0.1:9000/uploads',
      })
    ).toEqual({
      apiBaseUrl: 'https://api.example.com/api/v1',
      webBaseUrl: 'https://yuanai.example.com',
      assetOrigins: ['https://cdn.example.com', 'http://127.0.0.1:9000'],
    })
  })

  it.each([
    ['YUANAI_API_URL', 'file:///tmp/api'],
    ['YUANAI_API_URL', 'https://user:pass@example.com/api/v1'],
    ['YUANAI_API_URL', 'https://api.example.com/api/v1?token=x'],
    ['YUANAI_WEB_URL', 'http://yuanai.example.com'],
    ['YUANAI_ASSET_ORIGINS', 'http://cdn.example.com'],
  ])('rejects unsafe %s value %s', (key, value) => {
    expect(() => readRuntimeConfig({ [key]: value })).toThrow()
  })
})
