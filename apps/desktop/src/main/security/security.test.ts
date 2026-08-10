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
    expect(csp).toContain('http://127.0.0.1:9000')
    expect(csp).not.toContain('file:')
    expect(csp).not.toContain('*')
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'")
  })

  it('permits only the Vite development preamble to use inline script', () => {
    expect(buildContentSecurityPolicy(config, true)).toContain("script-src 'self' 'unsafe-inline'")
  })

  it('allows video capture only from a trusted renderer and always denies audio', () => {
    expect(permissionDecision(true, 'media', ['video'])).toBe(true)
    expect(permissionDecision(true, 'media', ['audio'])).toBe(false)
    expect(permissionDecision(false, 'media', ['video'])).toBe(false)
    expect(permissionDecision(true, 'notifications', [])).toBe(false)
  })
})
