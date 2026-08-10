import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesktopOAuthResult } from '../../shared/ipc-contract'

const exchange = vi.hoisted(() => ({
  mutateAsync: vi.fn<(code: string) => Promise<void>>().mockResolvedValue(undefined),
}))

vi.mock('@yuanai/core/hooks', () => ({
  useDesktopOAuthExchange: () => exchange,
}))

import { App } from './App'

let oauthResultListener: ((result: DesktopOAuthResult) => void) | undefined

beforeEach(() => {
  Object.defineProperty(window, 'yuanai', {
    configurable: true,
    value: {
      events: {
        onOAuthResult: (listener: (result: DesktopOAuthResult) => void): (() => void) => {
          oauthResultListener = listener
          return () => {
            oauthResultListener = undefined
          }
        },
      },
    },
  })
})

afterEach(() => {
  cleanup()
  oauthResultListener = undefined
  vi.clearAllMocks()
})

describe('desktop OAuth completion', () => {
  it('exchanges the one-time code received through the controlled preload event', async () => {
    render(<App />)

    await waitFor(() => {
      expect(oauthResultListener).toBeDefined()
    })
    oauthResultListener?.({ type: 'oauth', code: 'a'.repeat(43) })

    await waitFor(() => {
      expect(exchange.mutateAsync).toHaveBeenCalledWith('a'.repeat(43))
    })
  })

  it('shows a provider failure without attempting a token exchange', async () => {
    render(<App />)

    await waitFor(() => {
      expect(oauthResultListener).toBeDefined()
    })
    oauthResultListener?.({
      type: 'oauth-error',
      error: 'OAUTH_PROVIDER_ERROR',
      description: '用户拒绝授权',
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('用户拒绝授权')
    expect(exchange.mutateAsync).not.toHaveBeenCalled()
  })
})
