import { describe, expect, it } from 'vitest'

import { resolveRendererAssetPath } from './app-scheme'

describe('resolveRendererAssetPath', () => {
  it('maps known renderer assets beneath the configured root', () => {
    expect(resolveRendererAssetPath('yuanai-app://renderer/main/index.html', '/app/renderer')).toBe(
      '/app/renderer/main/index.html'
    )
  })

  it('ignores a client-side hash route when resolving a renderer asset', () => {
    expect(
      resolveRendererAssetPath('yuanai-app://renderer/login/index.html#/register', '/app/renderer')
    ).toBe('/app/renderer/login/index.html')
  })

  it.each([
    'yuanai-app://unknown/main/index.html',
    'yuanai-app://renderer/unknown/index.html',
    'yuanai-app://renderer/main/%2e%2e/secret.txt',
    'yuanai-app://renderer/main/%2fsecret.txt',
    'yuanai-app://renderer/main/%00secret.txt',
  ])('rejects unsafe renderer path %s', (url) => {
    expect(resolveRendererAssetPath(url, '/app/renderer')).toBeNull()
  })
})
