import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const bootstrapDesktop = vi.hoisted(() => vi.fn())
const createDesktopAdapter = vi.hoisted(() => vi.fn())
const configureDesktopAuthClient = vi.hoisted(() => vi.fn())
const synchronizeDesktopAuthState = vi.hoisted(() => vi.fn<() => Promise<void>>())

vi.mock('@yuanai/core/api', () => ({ setApiBaseUrl: vi.fn() }))
vi.mock('@yuanai/core/platform', () => ({ setPlatformAdapter: vi.fn() }))
vi.mock('@yuanai/core/stores', () => ({}))
vi.mock('./auth-client', () => ({ configureDesktopAuthClient, synchronizeDesktopAuthState }))
vi.mock('./bootstrap', () => ({ bootstrapDesktop }))
vi.mock('./desktop-adapter', () => ({ createDesktopAdapter }))

import { startDesktopRenderer } from './start-renderer'

beforeEach(() => {
  bootstrapDesktop.mockReset()
  createDesktopAdapter.mockReset()
  configureDesktopAuthClient.mockReset()
  synchronizeDesktopAuthState.mockReset().mockResolvedValue(undefined)
  createDesktopAdapter.mockReturnValue({})
  bootstrapDesktop.mockResolvedValue(undefined)
})

describe('startDesktopRenderer', () => {
  it('hydrates encrypted auth before mounting a newly opened main window', async () => {
    startDesktopRenderer(vi.fn())

    await waitFor(() => expect(bootstrapDesktop).toHaveBeenCalledOnce())
    const options = bootstrapDesktop.mock.calls[0]?.[0]
    if (!options) throw new Error('Desktop bootstrap options were not provided')

    await options.importStores()

    expect(configureDesktopAuthClient).toHaveBeenCalledOnce()
    expect(synchronizeDesktopAuthState).toHaveBeenCalledOnce()
  })
})
