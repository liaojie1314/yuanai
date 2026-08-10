import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'

const openExternal = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)

beforeEach(() => {
  Object.defineProperty(window, 'yuanai', {
    configurable: true,
    value: {
      shell: { openExternal },
      system: {
        getInfo: vi.fn().mockResolvedValue({ platform: 'linux', version: '0.0.1' }),
      },
    },
    writable: true,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('desktop about window', () => {
  it('shows the application version and opens fixed support links through preload', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByText(/v0\.0\.1/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '项目仓库' }))

    await waitFor(() => {
      expect(openExternal).toHaveBeenCalledWith('repository')
    })
  })
})
