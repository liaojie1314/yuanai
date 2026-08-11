import { describe, expect, it, vi } from 'vitest'

import type { IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron'

import { createIpcInvocationGuard, createTrustedWebContentsRegistry } from './guards'

function createWebContents(id: number): WebContents {
  return {
    id,
    isDestroyed: () => false,
    once: vi.fn(),
    send: vi.fn(),
  } as unknown as WebContents
}

function createEvent(sender: WebContents, url: string, useSubframe = false): IpcMainInvokeEvent {
  const mainFrame = { url } as WebFrameMain
  Object.assign(sender, { mainFrame })
  return {
    sender,
    senderFrame: useSubframe ? ({ url } as WebFrameMain) : mainFrame,
  } as IpcMainInvokeEvent
}

describe('IPC sender guard', () => {
  it('accepts managed main frames from the exact development origin', () => {
    const registry = createTrustedWebContentsRegistry()
    const sender = createWebContents(1)
    registry.add(sender)
    const guard = createIpcInvocationGuard({
      trustedWebContents: registry,
      developmentRendererUrl: 'http://localhost:5173/',
    })

    expect(() =>
      guard.assertTrusted(createEvent(sender, 'http://localhost:5173/main/index.html'))
    ).not.toThrow()
  })

  it('rejects unmanaged senders, subframes, and non-whitelisted renderer URLs', () => {
    const registry = createTrustedWebContentsRegistry()
    const managedSender = createWebContents(1)
    const unmanagedSender = createWebContents(2)
    registry.add(managedSender)
    const guard = createIpcInvocationGuard({
      trustedWebContents: registry,
      developmentRendererUrl: 'http://localhost:5173/',
    })

    expect(() =>
      guard.assertTrusted(createEvent(unmanagedSender, 'http://localhost:5173/main/index.html'))
    ).toThrow('IPC_UNTRUSTED_SENDER')
    expect(() =>
      guard.assertTrusted(createEvent(managedSender, 'http://localhost:5173/main/index.html', true))
    ).toThrow('IPC_UNTRUSTED_FRAME')
    expect(() =>
      guard.assertTrusted(createEvent(managedSender, 'https://attacker.example/main/index.html'))
    ).toThrow('IPC_UNTRUSTED_ORIGIN')
  })

  it('accepts only known packaged renderer entries', () => {
    const registry = createTrustedWebContentsRegistry()
    const sender = createWebContents(1)
    registry.add(sender)
    const guard = createIpcInvocationGuard({
      trustedWebContents: registry,
      developmentRendererUrl: undefined,
    })

    expect(() =>
      guard.assertTrusted(createEvent(sender, 'yuanai-app://renderer/settings/index.html'))
    ).not.toThrow()
    expect(() =>
      guard.assertTrusted(createEvent(sender, 'yuanai-app://renderer/login/index.html#/register'))
    ).not.toThrow()
    expect(() =>
      guard.assertTrusted(createEvent(sender, 'yuanai-app://renderer/unknown/index.html'))
    ).toThrow('IPC_UNTRUSTED_ORIGIN')
  })
})
