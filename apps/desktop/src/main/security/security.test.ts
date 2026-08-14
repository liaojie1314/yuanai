import { describe, expect, it, vi } from 'vitest'

import type { Session, WebContents } from 'electron'

import type { AppRuntimeConfig } from '../../shared/runtime-config'
import { buildContentSecurityPolicy } from './csp'
import { createTrustedWebContentsRegistry } from '../ipc/guards'
import {
  installPermissionHandler,
  permissionDecision,
  requestTrustedMediaPermission,
  type MediaPermissionPrompt,
} from './permissions'

const config: AppRuntimeConfig = {
  apiBaseUrl: 'https://api.example.com/api/v1',
  webBaseUrl: 'https://yuanai.example.com',
  assetOrigins: ['https://cdn.example.com', 'http://127.0.0.1:9000'],
}

function createWebContents(id: number): WebContents {
  return {
    id,
    isDestroyed: () => false,
    once: vi.fn(),
  } as unknown as WebContents
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

  it('allows microphone and camera capture only from a trusted renderer', () => {
    expect(permissionDecision(true, 'media', ['video'])).toBe(true)
    expect(permissionDecision(true, 'media', ['audio'])).toBe(true)
    expect(permissionDecision(false, 'media', ['video'])).toBe(false)
    expect(permissionDecision(true, 'notifications', [])).toBe(false)
  })

  it('requires explicit confirmation before granting trusted microphone access', async () => {
    const confirm = vi.fn<() => Promise<boolean>>().mockResolvedValue(true)

    await expect(requestTrustedMediaPermission(true, 'media', ['audio'], confirm)).resolves.toBe(
      true
    )
    expect(confirm).toHaveBeenCalledOnce()

    await expect(requestTrustedMediaPermission(false, 'media', ['audio'], confirm)).resolves.toBe(
      false
    )
    expect(confirm).toHaveBeenCalledOnce()
  })

  it('caches an accepted microphone grant for the current trusted renderer session', async () => {
    type PermissionHandler = (webContents: WebContents, ...args: unknown[]) => void
    let handler: PermissionHandler | null = null
    const session = {
      setPermissionRequestHandler(candidate: unknown): void {
        handler = candidate as PermissionHandler
      },
    } as unknown as Session
    const trustedWebContents = createTrustedWebContentsRegistry()
    const webContents = createWebContents(7)
    trustedWebContents.add(webContents)
    const prompt = vi.fn<MediaPermissionPrompt>().mockResolvedValue(true)
    const initialCallback = vi.fn()

    installPermissionHandler(session, trustedWebContents, prompt)
    const installedHandler = handler as PermissionHandler | null
    if (!installedHandler) throw new Error('Expected permission handler')

    installedHandler(webContents, 'media', initialCallback, { mediaTypes: ['audio'] })
    await vi.waitFor(() => expect(initialCallback).toHaveBeenCalledWith(true))
    expect(prompt).toHaveBeenCalledOnce()

    const repeatedCallback = vi.fn()
    installedHandler(webContents, 'media', repeatedCallback, { mediaTypes: ['audio'] })

    expect(repeatedCallback).toHaveBeenCalledWith(true)
    expect(prompt).toHaveBeenCalledOnce()
  })
})
