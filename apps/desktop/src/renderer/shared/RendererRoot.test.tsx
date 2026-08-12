import { cleanup, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const synchronizeDesktopAuthState = vi.hoisted(() =>
  vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
)
const onAuthChanged = vi.hoisted(() => vi.fn())

vi.mock('./auth-client', () => ({ synchronizeDesktopAuthState }))
vi.mock('./AppearanceProvider', () => ({
  AppearanceProvider: ({ children }: { children: ReactNode }) => children,
}))

import { RendererRoot } from './RendererRoot'

beforeEach(() => {
  Object.defineProperty(window, 'yuanai', {
    configurable: true,
    value: { events: { onAuthChanged } },
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RendererRoot', () => {
  it('rehydrates an existing renderer after another window signs in', async () => {
    const unsubscribe = vi.fn()
    onAuthChanged.mockReturnValue(unsubscribe)
    render(
      <RendererRoot>
        <span>renderer</span>
      </RendererRoot>
    )

    const listener = onAuthChanged.mock.calls[0]?.[0] as ((hasSession: boolean) => void) | undefined
    expect(listener).toBeDefined()

    listener?.(true)
    await waitFor(() => expect(synchronizeDesktopAuthState).toHaveBeenCalledOnce())

    listener?.(false)
    expect(synchronizeDesktopAuthState).toHaveBeenCalledOnce()

    cleanup()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
