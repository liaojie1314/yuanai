import { describe, expect, it } from 'vitest'

import type { AppRuntimeConfig } from '../../shared/runtime-config'
import { buildContentSecurityPolicy } from './csp'
import { permissionDecision } from './permissions'

const config: AppRuntimeConfig = {
  apiBaseUrl: 'https://api.example.com/api/v1',
  webBaseUrl: 'https://yuanai.example.com',
  assetOrigins: ['https://cdn.example.com', 'http://127.0.0.1:9000'],
}

describe('renderer security policy', () => {
  it('builds an exact CSP without wildcards or file access', () => {
    const csp = buildContentSecurityPolicy(config)

    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("connect-src 'self' https://api.example.com")
    expect(csp).toContain("img-src 'self' data: blob: https: https://api.example.com")
    expect(csp).toContain('yuanai-file:')
    expect(csp).toContain('http://127.0.0.1:9000')
    expect(csp).not.toMatch(/(?:^|\s)file:/)
    expect(csp).not.toContain('*')
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'")
  })

  it('permits only the Vite development preamble to use inline script', () => {
    expect(buildContentSecurityPolicy(config, true)).toContain("script-src 'self' 'unsafe-inline'")
  })

  it('permits inline scripts only for the isolated Artifact runtime in production', () => {
    expect(buildContentSecurityPolicy(config, false, true)).toContain(
      "script-src 'self' 'unsafe-inline' blob: https://esm.sh"
    )
    expect(buildContentSecurityPolicy(config)).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(buildContentSecurityPolicy(config, false, true)).not.toContain("'unsafe-eval'")
  })

  it('allows video capture only from a trusted renderer and always denies audio', () => {
    expect(permissionDecision(true, 'media', ['video'])).toBe(true)
    expect(permissionDecision(true, 'media', ['audio'])).toBe(false)
    expect(permissionDecision(false, 'media', ['video'])).toBe(false)
    expect(permissionDecision(true, 'notifications', [])).toBe(false)
  })
})
