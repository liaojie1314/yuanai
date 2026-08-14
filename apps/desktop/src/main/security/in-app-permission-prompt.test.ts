import type { WebContents } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { IPC } from '../../shared/ipc-contract'
import type { DesktopMediaPermissionRequest } from '../../shared/ipc-contract'
import { InAppMediaPermissionPrompt } from './in-app-permission-prompt'

function createWebContents(id: number): WebContents {
  return {
    id,
    isDestroyed: () => false,
    once: vi.fn(),
    send: vi.fn(),
  } as unknown as WebContents
}

afterEach(() => {
  vi.useRealTimers()
})

describe('InAppMediaPermissionPrompt', () => {
  it('sends the request only to its originating renderer and accepts its response', async () => {
    const prompt = new InAppMediaPermissionPrompt()
    const webContents = createWebContents(4)
    const pending = prompt.request(webContents, 'audio')
    const request = (webContents.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as
      DesktopMediaPermissionRequest | undefined

    expect(webContents.send).toHaveBeenCalledWith(
      IPC.events.mediaPermissionRequested,
      expect.objectContaining({ mediaType: 'audio' })
    )
    if (!request) throw new Error('Expected a media permission request')

    expect(prompt.respond(webContents, { requestId: request.requestId, granted: true })).toBe(true)
    await expect(pending).resolves.toBe(true)
  })

  it('rejects a response from another renderer without completing the request', async () => {
    const prompt = new InAppMediaPermissionPrompt()
    const requester = createWebContents(4)
    const otherRenderer = createWebContents(5)
    const pending = prompt.request(requester, 'audio')
    const request = (requester.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as
      DesktopMediaPermissionRequest | undefined

    if (!request) throw new Error('Expected a media permission request')
    expect(prompt.respond(otherRenderer, { requestId: request.requestId, granted: true })).toBe(
      false
    )

    expect(prompt.respond(requester, { requestId: request.requestId, granted: false })).toBe(true)
    await expect(pending).resolves.toBe(false)
  })

  it('denies unanswered requests after the bounded timeout and during disposal', async () => {
    vi.useFakeTimers()
    const prompt = new InAppMediaPermissionPrompt()
    const timeoutRequest = prompt.request(createWebContents(4), 'audio')
    const disposeRequest = prompt.request(createWebContents(5), 'video')

    prompt.dispose()
    await expect(disposeRequest).resolves.toBe(false)

    const timeoutPrompt = new InAppMediaPermissionPrompt()
    const timeoutOnlyRequest = timeoutPrompt.request(createWebContents(6), 'audio')
    await vi.advanceTimersByTimeAsync(30_000)
    await expect(timeoutOnlyRequest).resolves.toBe(false)
    await expect(timeoutRequest).resolves.toBe(false)
  })
})
